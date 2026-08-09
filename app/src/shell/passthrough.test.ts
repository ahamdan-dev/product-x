/**
 * Tests for the click-through rule.
 *
 * This is the kind of logic that is invisible in code review and obvious in use: the failure mode is a
 * click landing on the app instead of on the user's actual work, which nobody notices until the overlay
 * feels "in the way". So the decision is pure and the stacks are hand-built here, including the exact
 * computed-color shapes Chromium hands back for the surfaces this app really uses.
 */

import { describe, expect, it } from 'vitest';
import { colorAlpha, decidePassthrough, layerPaints, type HitLayer } from './passthrough';

/** A layer that paints nothing and claims nothing. */
function layer(over: Partial<HitLayer> = {}): HitLayer {
  return {
    interactive: false,
    passthrough: false,
    structural: false,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    backdropFilter: 'none',
    ...over,
  };
}

describe('colorAlpha', () => {
  it('reads the legacy comma form', () => {
    expect(colorAlpha('rgba(241, 240, 237, 0.9)')).toBeCloseTo(0.9);
    expect(colorAlpha('rgba(0, 0, 0, 0)')).toBe(0);
  });

  it('reads the modern slash form', () => {
    expect(colorAlpha('rgb(241 240 237 / 0.58)')).toBeCloseTo(0.58);
    expect(colorAlpha('rgb(241 240 237 / 58%)')).toBeCloseTo(0.58);
  });

  /**
   * The surfaces compose their fills with `color-mix(in oklab, … transparent)`, and Chromium serializes
   * the result in whichever space the mix happened. This is the form the real Today panes produce, so a
   * parser that only knew `rgba()` would read every glass surface as fully opaque.
   */
  it('reads the color-mix output forms', () => {
    expect(colorAlpha('color(srgb 0.945 0.941 0.929 / 0.68)')).toBeCloseTo(0.68);
    expect(colorAlpha('oklab(0.96 0.001 0.004 / 0.58)')).toBeCloseTo(0.58);
  });

  it('treats a channel-less color as opaque', () => {
    expect(colorAlpha('rgb(241, 240, 237)')).toBe(1);
    expect(colorAlpha('white')).toBe(1);
  });

  it('treats transparent and empty as nothing', () => {
    expect(colorAlpha('transparent')).toBe(0);
    expect(colorAlpha('')).toBe(0);
    expect(colorAlpha('none')).toBe(0);
  });
});

describe('layerPaints', () => {
  it('counts a visible fill', () => {
    expect(layerPaints(layer({ backgroundColor: 'rgba(241, 240, 237, 0.58)' }))).toBe(true);
  });

  it('counts frosted glass with no fill of its own', () => {
    // The whole point of the material: it is visible because of what it does to the pixels behind it.
    expect(layerPaints(layer({ backdropFilter: 'blur(32px) saturate(200%)' }))).toBe(true);
  });

  it('counts a gradient', () => {
    expect(layerPaints(layer({ backgroundImage: 'linear-gradient(rgb(1 1 1 / 0.2), transparent)' })))
      .toBe(true);
  });

  it('ignores a fill too faint to see', () => {
    expect(layerPaints(layer({ backgroundColor: 'rgba(0, 0, 0, 0.01)' }))).toBe(false);
  });

  it('ignores a layout box', () => {
    expect(layerPaints(layer())).toBe(false);
  });
});

describe('decidePassthrough', () => {
  it('gives the desktop the click when nothing under the cursor paints', () => {
    // The governing case: the gap between two cards on a transparent overlay is the user's screen.
    expect(decidePassthrough([layer(), layer({ structural: true }), layer({ structural: true })]))
      .toBe(false);
  });

  it('claims the click over a glass pane', () => {
    expect(decidePassthrough([
      layer({ backgroundColor: 'color(srgb 0.945 0.941 0.929 / 0.58)' }),
      layer({ structural: true }),
    ])).toBe(true);
  });

  it('claims the click when the paint is on an ancestor, not the hit element', () => {
    // Normal case, not an edge case: the pointer lands on a word of text or an SVG path, and the fill
    // belongs to the card two levels up.
    expect(decidePassthrough([
      layer(),                                                    // the text node's span
      layer({ backgroundColor: 'rgba(241, 240, 237, 0.68)' }),     // the card
      layer({ structural: true }),
    ])).toBe(true);
  });

  it('claims the click over an explicitly interactive element that paints nothing', () => {
    // The WebGL Map: pixels in a drawing buffer, no computed background at all.
    expect(decidePassthrough([layer({ interactive: true }), layer({ structural: true })])).toBe(true);
  });

  it('does not let a passthrough wrapper veto an interactive child', () => {
    expect(decidePassthrough([
      layer({ interactive: true }),
      layer({ passthrough: true, backgroundColor: 'rgb(0 0 0 / 0.4)' }),
    ])).toBe(true);
  });

  it('ignores a painted layer marked passthrough', () => {
    expect(decidePassthrough([layer({ passthrough: true, backgroundColor: 'rgb(255 255 255)' })]))
      .toBe(false);
  });

  /**
   * The load placeholder is the live reason `structural` exists. `.x-shell__settling` is a full-bleed box
   * washed with `--x-ambient-calm`, so on the paint rule alone it would claim the entire window for the
   * few hundred milliseconds a lazy surface takes to arrive — a burst of stolen clicks at exactly the
   * moment the user is reaching for something.
   */
  it('ignores a painted structural layer', () => {
    expect(decidePassthrough([
      layer({ structural: true, backgroundColor: 'rgba(232, 236, 233, 0.28)' }),
    ])).toBe(false);
  });

  it('gives the desktop the click when the stack is empty', () => {
    expect(decidePassthrough([])).toBe(false);
  });
});
