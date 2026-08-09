/**
 * The utility panels, as data.
 *
 * ── Why this is a second layer and not three more tabs ────────────────────────────────────────
 *
 * `surfaces.ts` holds a product law: there are exactly three surfaces, each named by the question it
 * answers. Activity, Library, Settings, Simulations, Imagine and Companion answer no such question —
 * they are *utilities you reach for while on* a surface. Promoting any of them to a tab would put
 * "Settings" beside "What do I actually know?" and the discipline would be gone in one commit.
 *
 * So they live here, in a parallel registry, and the type system keeps them apart: a `PanelId` is not
 * a `SurfaceId` and there is no function that converts one to the other. The three-surface assertion
 * in `surfaces.test.ts` keeps passing precisely because this file exists.
 *
 * ── Why the geometry is data, not CSS ─────────────────────────────────────────────────────────
 *
 * Every panel is a real floating window (`ui/Surface`) that the user can move, resize, minimize and
 * close. Its opening size is a property of its *content* — the Imagine board needs room for four flip
 * cards side by side, Activity is a single column — so the size lives next to the panel's identity
 * rather than in a stylesheet that cannot see the viewport. `initialGeometry` then does the one thing
 * CSS genuinely cannot: guarantee the thing lands fully on screen at 480px as well as at 1900px.
 *
 * No React in this file. It is imported by a `node`-environment test, and keeping the lazy component
 * map next door in `panelComponents.ts` is what lets that test stay honest about the data without
 * dragging a renderer in behind it.
 */

export type PanelId =
  | 'activity'
  | 'library'
  | 'settings'
  | 'sims'
  | 'imagine'
  | 'companion';

export interface PanelDef {
  id: PanelId;
  /** The URL token. Kept separate from `id` so a rename of one is not silently a broken deep link. */
  slug: string;
  label: string;
  /**
   * One honest line, shown in the summon menu. This is the panel's equivalent of a surface's
   * question: if a panel cannot say what it does without overclaiming, it should not ship. Panels
   * that are not fully built say so here, in the menu, before the user spends a click.
   */
  purpose: string;
  /** Opening size, in px, before clamping. Sized to the panel's content. */
  width: number;
  height: number;
}

/**
 * Order is the order in the menu, and it is deliberate: the two panels a student touches during a
 * study session come first, the two that are about the session's output come next, and configuration
 * comes last. Settings at the top of a menu is a tell that nobody thought about the order.
 */
export const PANELS: readonly PanelDef[] = [
  {
    id: 'activity',
    slug: 'activity',
    label: 'Activity',
    purpose: 'Recent evidence, a 25-minute focus timer, and what your retention actually looks like.',
    width: 400,
    height: 560,
  },
  {
    id: 'imagine',
    slug: 'imagine',
    label: 'Imagine',
    purpose: 'Lateral pivots from what you are studying, as four cards you flip and pin.',
    /**
     * 1060, not 920 — and the width is the lever, not the height.
     *
     * Four cards share this row, so the panel's width sets each card's column width, and the column
     * width sets how many times the text wraps, which sets how TALL the row has to be. Measured on the
     * running panel (`probeCardFit.cjs`), the tallest of the eight card faces needs:
     *
     *     panel 920 -> 209px columns -> 326px of card   (interior 529 vs a 487px body: 42 over)
     *     panel 1000 -> 229px         -> 304px          (507: 20 over)
     *     panel 1060 -> 244px         -> 282px          (485: FITS)
     *     panel 1180 -> 274px         -> 260px          (463: fits, but the panel is then 93% of the
     *                                                    viewport and stops reading as a floating
     *                                                    utility at all)
     *
     * 1060 is the first width at which the whole interior fits with no scrolling, and it still leaves
     * the panel clearly floating rather than filling the screen.
     */
    width: 1060,
    /**
     * 700 is what this asks for; ~543 is what it gets, and that is the point.
     *
     * `initialGeometry` clamps height to `vh - TOP_INSET - MARGIN`. This machine's display is 1280x800
     * DIP, giving a 689px viewport and a 543px ceiling — so the earlier 620 and this 700 both land at
     * exactly 543 and raising the number changed nothing on screen (which is why two captures at
     * different window heights came out pixel-identical). The number is kept honest at the height the
     * content genuinely wants, so that on a display with room the panel does open uncropped; the fit on
     * a small display is solved by the width above and by the footnote being sticky, not by this.
     */
    height: 700,
  },
  {
    id: 'library',
    slug: 'library',
    label: 'Library',
    purpose: 'Everything you pinned or flagged, with your notes on it.',
    width: 460,
    height: 620,
  },
  {
    id: 'sims',
    slug: 'simulations',
    label: 'Simulations',
    purpose: 'Three high-fidelity simulations. None are built yet, and the catalog says so.',
    width: 500,
    height: 600,
  },
  {
    id: 'companion',
    slug: 'companion',
    label: 'Companion',
    purpose: 'Choose your companion, or bring your own model.',
    width: 800,
    height: 460,
  },
  {
    id: 'settings',
    slug: 'settings',
    label: 'Settings',
    purpose: 'Evidence sources and their reliability, companion, and your data.',
    width: 460,
    height: 640,
  },
] as const;

/**
 * The store id for a panel's floating surface.
 *
 * Namespaced under `panel:` because the store keys its default geometry on the segment before the
 * colon (`card:cardio` -> `card`), and an un-namespaced `settings` would be one collision away from
 * inheriting some unrelated panel's size. It also makes panel surfaces distinguishable from the
 * subject cards Today opens, which matters the moment anything wants to count open panels.
 */
export function panelSurfaceId(id: PanelId): string {
  return `panel:${id}`;
}

export function panelBySlug(slug: string): PanelDef | undefined {
  return PANELS.find(p => p.slug === slug);
}

export function panelById(id: PanelId): PanelDef {
  const found = PANELS.find(p => p.id === id);
  // Unreachable while PanelId and PANELS agree, and this throw is what keeps them agreeing.
  if (!found) throw new Error(`no panel definition for '${id}'`);
  return found;
}

/** Keep this much of a panel reachable no matter how small the window is. Matches ui/Surface. */
const MARGIN = 16;
/**
 * Room for the surface nav *and* the summon dock beneath it, so a panel never opens on top of its own
 * controls. Measured from a real capture, not guessed: nav rail + its question line is ~76px, the dock
 * bar is ~46px, and 8px of air below that puts the panel clear of both. At 76 the dock bar landed
 * inside the panel's title bar and the "Close all" button appeared to belong to the panel.
 */
const TOP_INSET = 130;

export interface PanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a panel opens, given the window it has to fit in.
 *
 * Three properties this has to hold, all of which were bugs in something before they were rules:
 *
 *   1. It fits. A 920px-wide Imagine board opened in a 480px window must shrink, not overflow — an
 *      overlay that extends past the viewport has no reachable close button on the side that is off
 *      screen, which is the one failure this product cannot ship.
 *   2. It is fully on screen. Not "mostly": `x` and `y` are both clamped to a margin, so there is no
 *      window size at which the title bar (and therefore the drag handle and the close button) is
 *      outside the viewport.
 *   3. It is below the chrome. Panels open under the surface nav rather than over it, so the user can
 *      always still see which surface they are on and can still switch.
 *
 * Horizontally centred, vertically top-biased: centring vertically as well pushes short panels into
 * the middle of the screen where they cover the content they are annotating.
 */
export function initialGeometry(def: PanelDef, vw: number, vh: number): PanelGeometry {
  const width = Math.max(240, Math.min(def.width, vw - MARGIN * 2));
  const height = Math.max(160, Math.min(def.height, vh - TOP_INSET - MARGIN));

  const x = Math.max(MARGIN, Math.round((vw - width) / 2));
  const y = Math.max(MARGIN, Math.min(TOP_INSET, vh - height - MARGIN));

  return { x, y, width, height };
}
