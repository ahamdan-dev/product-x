/**
 * The window shell: surface switcher, the active surface, and the utility panel layer.
 *
 * Decisions worth defending:
 *
 * 1. **The shell paints nothing.** This is a transparent always-on-top overlay; the pixels between
 *    surfaces are the user's real desktop. `.x-ambient` is kept on the root but is inert there (see
 *    shell.css) — the wash belongs to surfaces, not to the window.
 *
 * 2. **The Map is lazy.** It pulls three.js, @react-three/fiber and drei — ~1 MB of the bundle, and by
 *    far the most expensive thing here to boot. Loading it eagerly means Today (the surface that
 *    actually answers "what should I do next?") waits on a WebGL stack it does not use.
 *
 * 3. **Surfaces are mounted, not swapped.** Once visited, a surface stays mounted and is hidden with
 *    `hidden` rather than unmounted. Remounting the Map would rebuild the whole scene graph on every tab
 *    switch — visibly janky — and would throw away camera state. `hidden` keeps the DOM but removes it
 *    from the accessibility tree and from hit-testing, which is the behaviour we want.
 *
 * 4. **Panels are a second layer, not a fourth tab.** There are exactly three surfaces. The six utility
 *    panels overlay whichever surface is active and are addressed as a *suffix* of its hash
 *    (`#/today/panel/library`), so a panel can never be reached without naming the surface it sits on.
 *    One routing mechanism — the hash — for both layers. See `surfaces.ts` and `panels.ts`.
 *
 * ── Why the hash carries one panel but the screen can hold several ──────────────────────────────
 *
 * These panels are floating windows: a student comparing the Library against Activity wants both open,
 * so the open set is genuinely a set. A hash is a single address, though, and encoding six slugs into it
 * would produce unreadable links that break the moment one panel is renamed. So the hash names the
 * *last panel summoned* — the one a deep link should restore and the one a shared link means — while the
 * store holds the full set. Every panel is still individually closeable, and closing the one named in
 * the hash promotes whichever is left, so the URL never points at a panel that is no longer there.
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { SurfaceNav } from './SurfaceNav';
import { PanelDock } from './PanelDock';
import { PanelHost } from './PanelHost';
import { useApp } from '../state/store';
import {
  resolveRoute, surfaceDef, panelSlugOf, withPanel, type SurfaceId,
} from './surfaces';
import { initialGeometry, panelById, panelBySlug, panelSurfaceId, type PanelId } from './panels';
import { hashPanel, reconcileOpenPanels } from './openPanels';
import { usePassthrough } from './usePassthrough';
import './shell.css';

const MapSurface = lazy(() => import('./MapSurface'));
const TodaySurface = lazy(() => import('../today/TodaySurface'));
const TogetherSurface = lazy(() => import('./TogetherSurface'));

/** A calm placeholder. Not a spinner: a spinner on a 200 ms load reads as slower than nothing. */
function Settling() {
  return <div className="x-shell__settling" aria-hidden="true" />;
}

export function Shell() {
  /**
   * The window claims the pointer only where it actually paints.
   *
   * Point 1 above — the shell paints nothing — is what makes this necessary rather than optional. Once
   * the space between surfaces is the user's real desktop, a window that still intercepts clicks there is
   * obscuring their *function* while no longer obscuring their view, and the rule names both.
   */
  usePassthrough();

  const [active, setActive] = useState<SurfaceId>(() => {
    const r = resolveRoute(window.location.hash);
    return r === 'companion' ? 'today' : r;
  });

  // Which surfaces have ever been shown. Mounting on first visit, then keeping them, is what makes
  // switching back instant — and it means the Map's WebGL context is created exactly once.
  const [visited, setVisited] = useState<Set<SurfaceId>>(() => new Set([active]));

  /**
   * Open panels, oldest first. An array rather than a Set so the order a user opened them survives.
   *
   * This is the shell's *ordering memory*, not its source of truth: the store decides what is open (see
   * `openPanels.ts`). A panel can close itself without telling the shell, so this list is reconciled
   * against the store below rather than trusted on its own.
   */
  const [openPanels, setOpenPanels] = useState<readonly PanelId[]>([]);

  const openSurfaceIn = useApp(st => st.openSurface);
  const closeSurfaceIn = useApp(st => st.closeSurface);
  const surfaces = useApp(st => st.surfaces);

  /**
   * Write the hash without listening to our own write.
   *
   * `replaceState` rather than assigning `location.hash`: assignment stacks a history entry per tab
   * click and per panel toggle, which turns the back button into an undo log of every glance.
   */
  const writeHash = useCallback((surface: SurfaceId, panel: PanelId | null) => {
    const slug = panel ? panelById(panel).slug : null;
    window.history.replaceState(null, '', withPanel(surfaceDef(surface).hash, slug));
  }, []);

  /**
   * Open a panel: seed its floating-surface geometry on first open, then add it to the open set.
   *
   * Geometry is computed here, against the live viewport, because `initialGeometry` is the only thing
   * guaranteeing the panel lands fully on screen — the store's own defaults are fixed pixel sizes that
   * know nothing about a 480px window.
   *
   * But only on *first* open. The store's contract is that reopening restores where the user last
   * dragged the panel to, and passing geometry every time would override that and yank the panel back
   * to centre on every summon. So the seed is supplied only when the store has never seen this id.
   */
  const openPanel = useCallback((id: PanelId) => {
    const sid = panelSurfaceId(id);
    const seen = useApp.getState().surfaces[sid];
    openSurfaceIn(
      sid,
      seen ? undefined : initialGeometry(panelById(id), window.innerWidth, window.innerHeight),
    );
    setOpenPanels(prev => (prev.includes(id) ? prev : [...prev, id]));
  }, [openSurfaceIn]);

  const closePanel = useCallback((id: PanelId) => {
    closeSurfaceIn(panelSurfaceId(id));
    setOpenPanels(prev => prev.filter(p => p !== id));
  }, [closeSurfaceIn]);

  const closeAllPanels = useCallback(() => {
    setOpenPanels(prev => {
      for (const p of prev) closeSurfaceIn(panelSurfaceId(p));
      return [];
    });
  }, [closeSurfaceIn]);

  const togglePanel = useCallback((id: PanelId) => {
    if (openPanels.includes(id)) closePanel(id); else openPanel(id);
  }, [openPanels, openPanel, closePanel]);

  const select = useCallback((id: SurfaceId) => {
    setActive(id);
    setVisited(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  /**
   * Restore a panel named in the initial hash, once, on mount.
   *
   * Separate from the `hashchange` listener because that only fires on *changes* — a window opened
   * directly at `#/map/panel/settings` (the Electron menu, or a link) never fires one, and the panel
   * would silently not appear. An unknown slug is ignored rather than treated as an error: a stale link
   * should land you on a working surface, not on a dead end.
   */
  useEffect(() => {
    const slug = panelSlugOf(window.location.hash);
    const def = slug ? panelBySlug(slug) : undefined;
    if (def) openPanel(def.id);
    // Mount-only by design; `openPanel` is stable and re-running this would re-open a closed panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Respond to external hash changes (deep links, the Electron menu) without fighting our own.
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash;
      const r = resolveRoute(hash);
      if (r !== 'companion') {
        setActive(r);
        setVisited(prev => (prev.has(r) ? prev : new Set(prev).add(r)));
      }
      const slug = panelSlugOf(hash);
      const def = slug ? panelBySlug(slug) : undefined;
      if (def) openPanel(def.id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [openPanel]);

  /**
   * Adopt closures the shell did not perform.
   *
   * `ui/Surface` closes itself — its X and its Escape handler call the store directly, which is right:
   * a window should not need its host's permission to shut. But then this list still names it, and three
   * things break at once (measured, all three real before this effect existed): the dock's badge kept
   * counting a panel that was gone, `togglePanel` read a phantom "open" and spent the next dock click
   * closing nothing so the panel needed two clicks to return, and the hash went on naming a dismissed
   * panel so a reload resurrected it.
   *
   * `reconcileOpenPanels` returns the same array when nothing changed, which is what keeps this from
   * looping — it runs on every store change, and a fresh array each time would set state forever.
   *
   * `surfaces` is the *trigger*, but the verdict is read fresh from `getState()`, and that distinction is
   * the difference between working and broken. Effects run in declaration order, so on a cold load at
   * `#/today/panel/companion` the mount effect above opens the panel in the store and then THIS effect
   * runs — still holding the `surfaces` object from the render that happened *before* that write. Judging
   * against the closure therefore concluded the panel was not open and deleted it on the spot: the deep
   * link rendered a bare surface with no panel and no dock badge. Reading the live store instead sees the
   * write that just happened.
   */
  useEffect(() => {
    const live = useApp.getState().surfaces;
    setOpenPanels(prev =>
      reconcileOpenPanels(prev, id => live[panelSurfaceId(id)]?.open === true),
    );
  }, [surfaces]);

  /**
   * Keep the hash in step with the surface and the most recently summoned panel.
   *
   * Derived in an effect rather than written inside every handler, so there is exactly one place the
   * URL is produced and no handler can forget. When the last panel closes the suffix goes away, so the
   * hash never names a panel that is not on screen.
   */
  useEffect(() => {
    writeHash(active, hashPanel(openPanels));
  }, [active, openPanels, writeHash]);

  return (
    <div className="x-shell x-ambient">
      <SurfaceNav active={active} onSelect={select} />

      <PanelDock
        openPanels={openPanels}
        onToggle={togglePanel}
        onCloseAll={closeAllPanels}
      />

      <main className="x-shell__stage">
        {visited.has('today') && (
          <section className="x-shell__surface" hidden={active !== 'today'} aria-label="Today">
            <Suspense fallback={<Settling />}><TodaySurface /></Suspense>
          </section>
        )}
        {visited.has('map') && (
          <section className="x-shell__surface" hidden={active !== 'map'} aria-label="Map">
            <Suspense fallback={<Settling />}><MapSurface /></Suspense>
          </section>
        )}
        {visited.has('together') && (
          <section className="x-shell__surface" hidden={active !== 'together'} aria-label="Together">
            <Suspense fallback={<Settling />}><TogetherSurface /></Suspense>
          </section>
        )}
      </main>

      {/* Above every surface, and outside the stage so a surface's `hidden` can never hide a panel. */}
      <PanelHost openPanels={openPanels} onClose={closePanel} />
    </div>
  );
}
