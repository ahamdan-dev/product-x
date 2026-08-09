import { describe, it, expect } from 'vitest';
import { districtAppearance, WORLD_PALETTE } from './districtMaterial';
import type { DistrictReading } from '../state/store';
import type { WorldState } from '../learner/model';

function reading(over: Partial<DistrictReading> = {}): DistrictReading {
  return {
    id: 'x', label: 'X', slot: 0,
    development: 0, confidence: 0, conflict: 0,
    state: 'UNFORMED', decayed: 0, conceptCount: 1,
    ...over,
  };
}

/** Rough perceptual chroma: distance from the grey axis. */
function chromaOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mean = (r + g + b) / 3;
  return Math.hypot(r - mean, g - mean, b - mean);
}

const ALL_STATES: WorldState[] =
  ['UNFORMED', 'FOUNDATION', 'DEVELOPING', 'FUNCTIONAL', 'MASTERED', 'MAINTENANCE'];

describe('unstable is not a color — the central palette rule', () => {
  it('never emits a warm/red hue for any state, decay, or conflict', () => {
    for (const state of ALL_STATES) {
      for (const decayed of [0, 0.3, 0.6, 0.9]) {
        for (const conflict of [0, 0.5, 1]) {
          const a = districtAppearance(reading({ state, decayed, conflict, development: 0.5 }));
          const n = parseInt(a.color.slice(1), 16);
          const r = (n >> 16) & 255, b = n & 255;
          // Hematoxylin and fog are both cool: blue channel must never lose to red.
          expect(r).toBeLessThanOrEqual(b + 2);
        }
      }
    }
  });

  it('renders decay as loss of chroma, moving toward fog', () => {
    const fresh = districtAppearance(reading({ state: 'FUNCTIONAL', development: 0.75 }));
    const lapsed = districtAppearance(reading({ state: 'FUNCTIONAL', development: 0.75, decayed: 0.6 }));
    expect(chromaOf(lapsed.color)).toBeLessThan(chromaOf(fresh.color));
  });

  it('drains chroma monotonically as decay grows', () => {
    let prev = Infinity;
    for (const d of [0, 0.2, 0.4, 0.6, 0.8]) {
      const c = chromaOf(districtAppearance(reading({ state: 'MASTERED', development: 0.9, decayed: d })).color);
      expect(c).toBeLessThanOrEqual(prev + 0.001);
      prev = c;
    }
  });

  it('gives UNFORMED almost no hue — fog means "I don\'t know", not "you failed"', () => {
    const a = districtAppearance(reading({ state: 'UNFORMED' }));
    const fogChroma = chromaOf(WORLD_PALETTE.light.fog);
    expect(chromaOf(a.color)).toBeLessThan(fogChroma + 8);
  });
});

describe('development is never demolished (§21.6)', () => {
  it('keeps full height for a decayed district', () => {
    const peak = districtAppearance(reading({ state: 'MASTERED', development: 0.9 }));
    const lapsed = districtAppearance(reading({ state: 'MAINTENANCE', development: 0.4, decayed: 0.5 }));
    expect(lapsed.height).toBeCloseTo(peak.height, 6);
  });

  it('takes the light away instead of the building', () => {
    const peak = districtAppearance(reading({ state: 'MASTERED', development: 0.9 }));
    const lapsed = districtAppearance(reading({ state: 'MAINTENANCE', development: 0.4, decayed: 0.5 }));
    expect(lapsed.emissive).toBeLessThan(peak.emissive);
    expect(lapsed.height).toBeGreaterThan(0);
  });

  it('never returns a zero-height district — unformed is a plot, not a void', () => {
    for (const state of ALL_STATES) {
      expect(districtAppearance(reading({ state })).height).toBeGreaterThan(0.3);
    }
  });
});

describe('light is earned and rationed', () => {
  it('emits nothing below FUNCTIONAL', () => {
    expect(districtAppearance(reading({ state: 'UNFORMED' })).emissive).toBe(0);
    expect(districtAppearance(reading({ state: 'FOUNDATION' })).emissive).toBe(0);
  });

  it('reserves the strongest light for MASTERED alone', () => {
    const mastered = districtAppearance(reading({ state: 'MASTERED', development: 1 })).emissive;
    for (const state of ALL_STATES.filter(s => s !== 'MASTERED')) {
      expect(districtAppearance(reading({ state, development: 1 })).emissive).toBeLessThan(mastered);
    }
  });

  it('finishes the surface as competency rises', () => {
    const raw = districtAppearance(reading({ state: 'UNFORMED' })).roughness;
    const done = districtAppearance(reading({ state: 'MASTERED', development: 1 })).roughness;
    expect(done).toBeLessThan(raw);
  });
});

describe('the fog line encodes confidence, not mastery', () => {
  it('sits at the base when we know nothing, regardless of how much was built', () => {
    const a = districtAppearance(reading({ state: 'FUNCTIONAL', development: 0.8, confidence: 0 }));
    expect(a.fogAt).toBe(0);
    expect(a.height).toBeGreaterThan(3);   // tall and completely fogged: "unverified"
  });

  it('clears entirely at full confidence', () => {
    expect(districtAppearance(reading({ confidence: 1 })).fogAt).toBe(1);
  });

  it('tracks confidence independently of mastery — that separation is the whole idea', () => {
    const tallUnsure = districtAppearance(reading({ development: 0.9, confidence: 0.15 }));
    const shortSure = districtAppearance(reading({ development: 0.2, confidence: 0.95 }));
    expect(tallUnsure.height).toBeGreaterThan(shortSure.height);
    expect(tallUnsure.fogAt).toBeLessThan(shortSure.fogAt);
  });

  it('clamps out-of-range confidence rather than producing an invalid plane', () => {
    expect(districtAppearance(reading({ confidence: -1 })).fogAt).toBe(0);
    expect(districtAppearance(reading({ confidence: 3 })).fogAt).toBe(1);
  });
});

describe('conflict is shown, not averaged away', () => {
  it('produces haze proportional to source disagreement', () => {
    expect(districtAppearance(reading({ conflict: 0 })).conflictHaze).toBe(0);
    const mid = districtAppearance(reading({ conflict: 0.34 })).conflictHaze;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThanOrEqual(1);
  });

  it('saturates rather than exceeding 1', () => {
    expect(districtAppearance(reading({ conflict: 1 })).conflictHaze).toBe(1);
  });
});

describe('massing reads as built, not as a bar', () => {
  it('uses discrete tiers, at least one', () => {
    for (const dev of [0, 0.25, 0.5, 0.75, 1]) {
      const a = districtAppearance(reading({ development: dev, state: 'DEVELOPING' }));
      expect(Number.isInteger(a.tiers)).toBe(true);
      expect(a.tiers).toBeGreaterThanOrEqual(1);
    }
  });

  it('adds tiers as development grows', () => {
    const low = districtAppearance(reading({ development: 0.1, state: 'FOUNDATION' })).tiers;
    const high = districtAppearance(reading({ development: 0.95, state: 'MASTERED' })).tiers;
    expect(high).toBeGreaterThan(low);
  });
});

describe('both themes are complete', () => {
  it('defines every token in light and dark', () => {
    const lk = Object.keys(WORLD_PALETTE.light).sort();
    const dk = Object.keys(WORLD_PALETTE.dark).sort();
    expect(lk).toEqual(dk);
  });

  it('never uses pure black or white', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const hex of Object.values(WORLD_PALETTE[theme])) {
        expect(hex.toUpperCase()).not.toBe('#000000');
        expect(hex.toUpperCase()).not.toBe('#FFFFFF');
      }
    }
  });

  it('produces valid hex for every state in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const state of ALL_STATES) {
        const a = districtAppearance(reading({ state, development: 0.6, decayed: 0.2 }), theme);
        expect(a.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
