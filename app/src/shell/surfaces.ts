/**
 * The three surfaces, as data.
 *
 * NORTH-STAR is explicit that there are exactly three — Today, Map, Together — and that the Map is
 * only one of them: *"The killer product is not the board."* Keeping them in a list rather than in
 * a switch statement is what makes that constraint enforceable: a fourth surface has to be added
 * here, in the open, instead of appearing as one more branch somewhere.
 *
 * Each surface carries the *question it answers*. That is not flavour text — it is the eyebrow the
 * UI renders, and it is the check on whether a surface deserves to exist. A surface that cannot
 * state its question is a tab, not a surface.
 */

export type SurfaceId = 'today' | 'map' | 'together';

/** The companion window is not a surface — it is the always-on-top overlay, routed separately. */
export type Route = SurfaceId | 'companion';

export interface SurfaceDef {
  id: SurfaceId;
  label: string;
  /** The question this surface answers, rendered as its eyebrow. */
  question: string;
  hash: string;
}

export const SURFACES: readonly SurfaceDef[] = [
  { id: 'today',    label: 'Today',    question: 'What should I do next?', hash: '#/today' },
  { id: 'map',      label: 'Map',      question: 'What do I actually know?', hash: '#/map' },
  { id: 'together', label: 'Together', question: 'Who am I learning with?', hash: '#/together' },
] as const;

export const DEFAULT_SURFACE: SurfaceId = 'today';

/**
 * ── The panel segment ──────────────────────────────────────────────────────────────────────────
 *
 * A utility panel is not a fourth surface. It is a dismissible thing *overlaid on* whichever
 * surface you are already on, so it is expressed as a suffix of that surface's hash rather than as
 * a sibling of it:
 *
 *     #/today                    Today, nothing overlaid
 *     #/today/panel/library      Today, with the Library panel open on top of it
 *     #/map/panel/settings       the Map, with Settings open on top of it
 *
 * Encoding it as a *suffix* is what keeps the three-surface law enforceable in the URL itself: a
 * panel can never be reached without naming the surface it sits on, so there is no hash that means
 * "the Library instead of a surface". It also means there is exactly one routing mechanism — the
 * hash — rather than a second, invisible one for panels.
 *
 * These four helpers are string mechanics only. Which slugs are *real* is the panel registry's
 * business (see panels.ts), which is why nothing here validates the slug: this file must not grow a
 * dependency on the registry, or the two would import each other.
 */
export const PANEL_SEGMENT = '/panel/';

/** The surface part of a hash, with any panel suffix stripped. */
export function baseHash(hash: string): string {
  const i = hash.indexOf(PANEL_SEGMENT);
  return i === -1 ? hash : hash.slice(0, i);
}

/** The raw panel slug in a hash, or null. Unvalidated by design — see the note above. */
export function panelSlugOf(hash: string): string | null {
  const i = hash.indexOf(PANEL_SEGMENT);
  if (i === -1) return null;
  const slug = hash.slice(i + PANEL_SEGMENT.length);
  // A trailing `/panel/` with nothing after it is a truncated link, not a request for a panel.
  return slug.length > 0 ? slug : null;
}

/** Compose a deep link: a surface hash plus an optional panel overlaid on it. */
export function withPanel(surfaceHash: string, slug: string | null): string {
  const base = baseHash(surfaceHash);
  return slug ? `${base}${PANEL_SEGMENT}${slug}` : base;
}

/**
 * Resolve a location hash to a route.
 *
 * `#/companion` is matched by prefix because the companion window appends state to its own hash;
 * the surfaces are matched exactly — after the panel suffix is stripped — so that a typo lands on
 * the default rather than silently rendering the wrong screen. Unknown hashes resolve to Today, not
 * to the Map: an unrecognised deep link should open the surface that tells you what to do, not the
 * one that costs the most to render.
 *
 * Stripping the panel suffix *before* the exact match is the whole reason a panel deep link still
 * lands on the right surface instead of falling through to the default.
 */
export function resolveRoute(hash: string): Route {
  if (hash.startsWith('#/companion')) return 'companion';
  const surfaceHash = baseHash(hash);
  if (surfaceHash === '#/world') return 'map';
  const found = SURFACES.find(s => s.hash === surfaceHash);
  return found ? found.id : DEFAULT_SURFACE;
}

export function isSurface(route: Route): route is SurfaceId {
  return route !== 'companion';
}

export function surfaceDef(id: SurfaceId): SurfaceDef {
  const found = SURFACES.find(s => s.id === id);
  // Unreachable while SurfaceId and SURFACES agree, and this throw is what keeps them agreeing.
  if (!found) throw new Error(`no surface definition for '${id}'`);
  return found;
}

/**
 * Step through the surfaces for keyboard navigation, wrapping at both ends.
 *
 * Wrapping rather than clamping because three items in a segmented control read as a ring: pressing
 * right on the last one and getting nothing feels broken, whereas wrapping is what every OS
 * segmented control does.
 */
export function cycleSurface(current: SurfaceId, delta: number): SurfaceId {
  const i = SURFACES.findIndex(s => s.id === current);
  const from = i === -1 ? 0 : i;
  const n = SURFACES.length;
  // `% n` twice, because JS `%` keeps the sign of the dividend and delta can be negative.
  const next = (((from + delta) % n) + n) % n;
  return SURFACES[next]!.id;
}
