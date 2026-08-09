/**
 * The panel layer: mounts whichever utility panels are open, above the active surface.
 *
 * ── Escape, and why it is here rather than only in `ui/Surface` ─────────────────────────────────
 *
 * `ui/Surface` already closes itself on Escape — but only when focus is inside it. On a transparent
 * always-on-top overlay that is not enough: a user who clicks the desktop behind the window, or opens a
 * panel by deep link and never clicks it, has focus nowhere near the panel and Escape would do nothing.
 * A panel stuck over the student's real screen with no keyboard way out is the exact failure the
 * always-dismissible rule exists to prevent. So this listens at the window and closes the top-most
 * panel — one press, one panel, most-recently-raised first, which is what every stacking window manager
 * does. The per-surface handler stops propagation, so the two never both fire.
 *
 * ── Suspense boundaries are per panel, not shared ──────────────────────────────────────────────
 *
 * Each panel gets its own `<Suspense>`. One shared boundary would mean opening the Companion picker
 * (which pulls three.js) blanks the already-loaded Library sitting next to it while the chunk arrives.
 *
 * The fallback is a sized frosted rectangle rather than a spinner: it holds the panel's real geometry,
 * so nothing jumps when the content lands.
 */

import { Suspense, useEffect } from 'react';
import { useApp } from '../state/store';
import { panelComponent } from './panelComponents';
import { panelSurfaceId, type PanelId } from './panels';
import './panelHost.css';

interface Props {
  /** Open panels, in the order they were opened. */
  openPanels: readonly PanelId[];
  onClose: (id: PanelId) => void;
}

export function PanelHost({ openPanels, onClose }: Props) {
  const surfaces = useApp(st => st.surfaces);

  /**
   * Window-level Escape closes the top-most panel.
   *
   * "Top-most" is by the store's `order`, which `raiseSurface` bumps on focus — so it is the panel the
   * user last touched, not the one that happens to be last in the array.
   */
  useEffect(() => {
    if (openPanels.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      let top: PanelId | null = null;
      let topOrder = -Infinity;
      for (const id of openPanels) {
        const order = surfaces[panelSurfaceId(id)]?.order ?? 0;
        if (order >= topOrder) { topOrder = order; top = id; }
      }
      if (top) { e.preventDefault(); onClose(top); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPanels, surfaces, onClose]);

  if (openPanels.length === 0) return null;

  return (
    <>
      {openPanels.map(id => {
        const Panel = panelComponent(id);
        const sid = panelSurfaceId(id);
        const geo = surfaces[sid];
        return (
          <Suspense
            key={id}
            fallback={
              <div
                className="x-panelHost__settling x-glass x-glass--thick"
                style={geo ? { left: geo.x, top: geo.y, width: geo.width, height: geo.height } : undefined}
                aria-hidden="true"
              />
            }
          >
            {/* A styling hook, not a layout box (`display: contents`). `ui/Surface` takes no
                className, and a panel needs thinner glass than the small chrome pills do — a base
                tuned for a 200px control reads as a solid sheet at 460x620. Scoping it here keeps the
                override with the panels instead of changing every `.x-glass` in the product. */}
            <div className="x-panelHost__panel">
              <Panel id={sid} />
            </div>
          </Suspense>
        );
      })}
    </>
  );
}
