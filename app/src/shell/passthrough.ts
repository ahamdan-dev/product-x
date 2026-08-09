/**
 * Which pixels belong to us, and which belong to the desktop.
 *
 * Making the window transparent was half of "CAND OBSCURE THE USERS SCREEN OR FUNCTION". The view half
 * is done — the desktop reads through. The function half is this file: a transparent window still
 * swallows every click that lands on it, so the empty pixels between our cards would eat clicks meant
 * for the UWorld tab underneath. An overlay that looks see-through while stealing clicks obscures the
 * user's function even though it no longer obscures their view.
 *
 * The decision is per-pointer-position, so it needs a rule for "is there anything of ours here?"
 *
 * ── Why painted-background, and not an opt-in attribute on every card ────────────────────────────
 * The obvious design is `data-x-interactive` on each surface and a walk up from the hit element. It
 * fails in the way that matters: it is a second, parallel description of where the UI is, maintained by
 * hand. Every new card is a chance to forget the attribute, and the symptom — a click landing on the app
 * instead of the user's work — is invisible in review and only shows up as "the overlay is in the way".
 *
 * So the rule is derived from what is actually on screen: **a stack of elements under the cursor claims
 * the click if any of them paints.** A card with a fill, or frosted glass with a `backdrop-filter`, is
 * something the user can see and therefore something they can plausibly be aiming at. A layout container
 * with no background is air. This needs no bookkeeping and stays correct as the UI changes, because it
 * reads the same property that makes a surface visible in the first place.
 *
 * Two escape hatches, because two cases genuinely cannot be read off a background:
 *   - `data-x-interactive` — a WebGL canvas paints its pixels in a drawing buffer, not in CSS, so the
 *     3D Map has no computed background at all and would read as air.
 *   - `data-x-passthrough` — for something that paints but should not claim clicks (a full-bleed
 *     decorative wash). None exists today; it is here so the answer to one is not "abandon the rule".
 *
 * The DOM read and the decision are separate on purpose: `decidePassthrough` is pure and unit-tested
 * against hand-built stacks, so the interesting logic is not stuck behind a live pointer.
 */

/** One element under the cursor, reduced to only what the decision depends on. */
export interface HitLayer {
  /** `data-x-interactive` — claims the click regardless of what it paints. */
  interactive: boolean;
  /** `data-x-passthrough` — never claims the click, whatever it paints. */
  passthrough: boolean;
  /** Structural: `html`, `body`, and anything that only positions children. Ignored when painted. */
  structural: boolean;
  /** Computed `background-color`, verbatim. */
  backgroundColor: string;
  /** Computed `background-image`. A gradient is paint too. */
  backgroundImage: string;
  /** Computed `backdrop-filter`. Frosted glass over the desktop paints without a solid fill. */
  backdropFilter: string;
}

/**
 * Below this, a fill is decoration rather than a surface.
 *
 * Not zero: `color-mix()` and inherited washes routinely land at a percent or two of alpha, and a fill
 * the user cannot see is a fill they cannot be aiming at. Deliberately far below the lowest real
 * surface in the app (58% on `--x-today-fill-pane`), so this cannot silently disqualify content.
 */
const MIN_VISIBLE_ALPHA = 0.02;

/**
 * Alpha of a computed color string, or 1 when it has none.
 *
 * Chromium hands back several shapes depending on how the value was authored, and all of them appear in
 * this app: `rgba(r, g, b, a)` from a literal, `rgb(r g b / a)` from the modern syntax, and
 * `color(srgb r g b / a)` or `oklab(l a b / a)` from `color-mix()`, which the surfaces use throughout.
 * Rather than parse each, take the alpha as whatever follows the last `/` or the fourth comma.
 */
export function colorAlpha(value: string): number {
  const v = value.trim();
  if (!v || v === 'transparent' || v === 'none') return 0;

  // Modern slash syntax: rgb(0 0 0 / 50%), color(srgb .1 .1 .1 / .5), oklab(… / .68)
  const slash = /\/\s*([0-9.]+)(%?)\s*\)/.exec(v);
  if (slash) {
    const n = Number(slash[1]);
    if (!Number.isNaN(n)) return slash[2] ? n / 100 : n;
  }

  // Legacy comma syntax: rgba(0, 0, 0, 0.5)
  const comma = /^rgba?\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9.]+)(%?)\s*\)$/.exec(v);
  if (comma) {
    const n = Number(comma[1]);
    if (!Number.isNaN(n)) return comma[2] ? n / 100 : n;
  }

  // A keyword, a hex, or `rgb()` with no alpha channel — fully opaque.
  return 1;
}

/** True when this layer puts visible pixels on screen. */
export function layerPaints(l: HitLayer): boolean {
  if (l.backdropFilter && l.backdropFilter !== 'none') return true;
  if (l.backgroundImage && l.backgroundImage !== 'none') return true;
  return colorAlpha(l.backgroundColor) > MIN_VISIBLE_ALPHA;
}

/**
 * Should the window claim the pointer at this position?
 *
 * `layers` is the stack under the cursor, topmost first — what `document.elementsFromPoint` returns.
 *
 * An explicit `data-x-interactive` anywhere in the stack wins outright, including over a `passthrough`
 * ancestor: the attribute exists precisely for content whose paint is invisible to CSS, and it would be
 * useless if a decorative wrapper could veto it. Otherwise a layer claims the click when it paints, is
 * not marked passthrough, and is not structural.
 */
export function decidePassthrough(layers: readonly HitLayer[]): boolean {
  for (const l of layers) {
    if (l.interactive) return true;
  }
  for (const l of layers) {
    if (l.passthrough || l.structural) continue;
    if (layerPaints(l)) return true;
  }
  return false;
}

export const INTERACTIVE_ATTR = 'data-x-interactive';
export const PASSTHROUGH_ATTR = 'data-x-passthrough';

/**
 * Elements that exist to position other elements.
 *
 * Listed by class rather than inferred, because "paints nothing" is already the test — this list only
 * has to cover containers that *do* paint yet are still air. `.x-shell__settling` is the live case: a
 * full-bleed load placeholder washed with `--x-ambient-calm`, which would otherwise claim the entire
 * window for the few hundred milliseconds a lazy surface takes to arrive.
 */
const STRUCTURAL_CLASSES = new Set([
  'x-shell', 'x-shell__stage', 'x-shell__surface', 'x-shell__settling',
]);

function isStructural(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'HTML' || tag === 'BODY') return true;
  for (const c of Array.from(el.classList)) {
    if (STRUCTURAL_CLASSES.has(c)) return true;
  }
  return false;
}

/** Read one element into the shape the decision needs. */
export function readLayer(el: Element, style: CSSStyleDeclaration): HitLayer {
  return {
    interactive: el.hasAttribute(INTERACTIVE_ATTR),
    passthrough: el.hasAttribute(PASSTHROUGH_ATTR),
    structural: isStructural(el),
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    // Chromium still reports this on the prefixed property in some builds; take whichever is set.
    backdropFilter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
  };
}

/**
 * The live DOM read: what is under this point, and does the app own it?
 *
 * Walks at most `MAX_LAYERS` deep. Any real surface is within two or three layers of the cursor, and an
 * unbounded walk would run the whole ancestor chain to `<html>` on every pointer move for no new
 * information.
 */
const MAX_LAYERS = 8;

export function ownsPoint(doc: Document, x: number, y: number): boolean {
  const hit = doc.elementsFromPoint(x, y);
  const layers: HitLayer[] = [];
  for (let i = 0; i < hit.length && i < MAX_LAYERS; i++) {
    const el = hit[i]!;
    layers.push(readLayer(el, getComputedStyle(el)));
  }
  return decidePassthrough(layers);
}
