import { describe, it, expect } from 'vitest';
import {
  placeSatellites, quadrantFor, bloomExtent, bloomBox, clampCentre, DEFAULT_SATELLITES,
  RING_INNER, RING_OUTER, SATELLITE_R, ARC_SPAN_DEG, STAGGER_MS,
} from './radial';

/** The five satellite centres measured off _refs/EXTRACT/exp_06.jpg, companion at (575,243) r=85. */
const REF = {
  centre: { x: 575, y: 243 },
  r: 85,
  satellites: [
    { name: 'umbrella', x: 743, y: 251 },
    { name: 'bell', x: 810, y: 353 },
    { name: 'person', x: 692, y: 363 },
    { name: 'basket', x: 678, y: 485 },
    { name: 'gear', x: 575, y: 411 },
  ],
};

describe('geometry matches the reference frame', () => {
  it('reproduces each measured satellite centre within 12px', () => {
    const placed = placeSatellites(DEFAULT_SATELLITES, 'downRight');
    expect(placed).toHaveLength(REF.satellites.length);

    placed.forEach((p, i) => {
      const ref = REF.satellites[i]!;
      const px = REF.centre.x + p.x * REF.r;
      const py = REF.centre.y + p.y * REF.r;
      const dist = Math.hypot(px - ref.x, py - ref.y);
      expect(dist, `${ref.name} off by ${dist.toFixed(1)}px`).toBeLessThan(12);
    });
  });

  it('staggers two radii rather than sitting on one circle', () => {
    const placed = placeSatellites(DEFAULT_SATELLITES);
    const radii = placed.map(p => Math.hypot(p.x, p.y));
    expect(radii[0]).toBeCloseTo(RING_INNER, 5);
    expect(radii[1]).toBeCloseTo(RING_OUTER, 5);
    expect(radii[2]).toBeCloseTo(RING_INNER, 5);
    expect(radii[3]).toBeCloseTo(RING_OUTER, 5);
    expect(radii[4]).toBeCloseTo(RING_INNER, 5);
    // The distinction has to be visible, not a rounding artifact.
    expect(RING_OUTER / RING_INNER).toBeGreaterThan(1.35);
  });

  it('spans exactly a quarter turn across the item count', () => {
    const placed = placeSatellites(DEFAULT_SATELLITES);
    const first = placed[0]!, last = placed[placed.length - 1]!;
    const a0 = Math.atan2(first.y, first.x) * 180 / Math.PI;
    const a1 = Math.atan2(last.y, last.x) * 180 / Math.PI;
    expect(a0).toBeCloseTo(0, 5);
    expect(a1).toBeCloseTo(ARC_SPAN_DEG, 5);
  });

  it('keeps the arc a quarter turn at other item counts', () => {
    for (const n of [2, 3, 4, 6]) {
      const items = DEFAULT_SATELLITES.slice(0, Math.min(n, DEFAULT_SATELLITES.length));
      const padded = n <= DEFAULT_SATELLITES.length
        ? items
        : [...DEFAULT_SATELLITES, { id: 'chat' as const, label: 'Extra', badge: 0 }];
      const placed = placeSatellites(padded);
      const last = placed[placed.length - 1]!;
      const a1 = Math.atan2(last.y, last.x) * 180 / Math.PI;
      expect(a1).toBeCloseTo(ARC_SPAN_DEG, 4);
    }
  });

  it('sizes satellites smaller than the companion, as in the frame', () => {
    expect(SATELLITE_R).toBeLessThan(1);
    expect(SATELLITE_R).toBeGreaterThan(0.4);
  });
});

describe('reveal stagger', () => {
  it('grows outward from the first satellite, one gesture not a list', () => {
    const placed = placeSatellites(DEFAULT_SATELLITES);
    expect(placed.map(p => p.delay)).toEqual([0, 34, 68, 102, 136]);
    // Whole bloom lands well inside a quarter second.
    expect(placed[placed.length - 1]!.delay).toBeLessThan(250);
    expect(STAGGER_MS).toBeLessThan(60);
  });

  it('assigns a stable order for animation indexing', () => {
    expect(placeSatellites(DEFAULT_SATELLITES).map(p => p.order)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('edge avoidance', () => {
  const r = 85;
  const reach = r * bloomExtent();

  it('blooms down-and-right with room available', () => {
    expect(quadrantFor({ x: 200, y: 200, r }, { width: 1600, height: 1000 })).toBe('downRight');
  });

  it('reflects left when parked against the right edge', () => {
    expect(quadrantFor({ x: 1590, y: 200, r }, { width: 1600, height: 1000 })).toBe('downLeft');
  });

  it('reflects up when parked against the bottom edge', () => {
    expect(quadrantFor({ x: 200, y: 990, r }, { width: 1600, height: 1000 })).toBe('upRight');
  });

  it('reflects both in the default bottom-right corner', () => {
    expect(quadrantFor({ x: 1560, y: 960, r }, { width: 1600, height: 1000 })).toBe('upLeft');
  });

  it('keeps every satellite on screen from any parking spot, including hard corners', () => {
    const vp = { width: 1600, height: 1000 };
    const spots = [
      { x: 1560, y: 960 }, { x: 40, y: 40 }, { x: 1590, y: 20 },
      { x: 20, y: 980 }, { x: 800, y: 500 }, { x: 0, y: 0 },
    ];
    for (const spot of spots) {
      const c = { ...spot, r };
      const q = quadrantFor(c, vp);
      const centre = clampCentre(c, vp, q);
      for (const p of placeSatellites(DEFAULT_SATELLITES, q)) {
        const px = centre.x + p.x * r, py = centre.y + p.y * r;
        const pr = p.r * r;
        expect(px - pr, `${JSON.stringify(spot)} ${p.id} left`).toBeGreaterThanOrEqual(-0.001);
        expect(py - pr, `${JSON.stringify(spot)} ${p.id} top`).toBeGreaterThanOrEqual(-0.001);
        expect(px + pr, `${JSON.stringify(spot)} ${p.id} right`).toBeLessThanOrEqual(vp.width + 0.001);
        expect(py + pr, `${JSON.stringify(spot)} ${p.id} bottom`).toBeLessThanOrEqual(vp.height + 0.001);
      }
    }
  });

  it('accounts for the backwards spill of the two on-axis satellites', () => {
    // The 0° and 90° satellites sit on the axes, so each overhangs the companion centre by its
    // own radius against the bloom direction. A symmetric box would clip them.
    const box = bloomBox('downRight');
    expect(box.minX).toBeCloseTo(-SATELLITE_R, 6);
    expect(box.minY).toBeCloseTo(-SATELLITE_R, 6);
    expect(box.maxX).toBeCloseTo(RING_OUTER + SATELLITE_R, 6);
    expect(box.maxY).toBeCloseTo(RING_OUTER + SATELLITE_R, 6);

    const placed = placeSatellites(DEFAULT_SATELLITES, 'downRight');
    const minY = Math.min(...placed.map(p => p.y - p.r));
    const minX = Math.min(...placed.map(p => p.x - p.r));
    expect(minY).toBeCloseTo(box.minY, 6);
    expect(minX).toBeCloseTo(box.minX, 6);
  });

  it('mirrors the box with the quadrant', () => {
    const dr = bloomBox('downRight');
    const ul = bloomBox('upLeft');
    expect(ul.maxX).toBeCloseTo(-dr.minX, 6);
    expect(ul.minX).toBeCloseTo(-dr.maxX, 6);
    expect(ul.maxY).toBeCloseTo(-dr.minY, 6);
    expect(ul.minY).toBeCloseTo(-dr.maxY, 6);
  });

  it('centres rather than clipping when the viewport cannot fit the bloom at all', () => {
    const tiny = { width: 100, height: 100 };
    const c = { x: 10, y: 10, r: 85 };
    expect(clampCentre(c, tiny, quadrantFor(c, tiny))).toEqual({ x: 50, y: 50 });
  });

  it('mirrors coordinates rather than reordering the menu', () => {
    const rightward = placeSatellites(DEFAULT_SATELLITES, 'downRight');
    const leftward = placeSatellites(DEFAULT_SATELLITES, 'downLeft');
    expect(leftward.map(p => p.id)).toEqual(rightward.map(p => p.id));
    leftward.forEach((p, i) => expect(p.x).toBeCloseTo(-rightward[i]!.x, 6));
  });

  it('reserves enough padding that nothing is clipped', () => {
    expect(bloomExtent()).toBeCloseTo(RING_OUTER + SATELLITE_R, 6);
    expect(reach).toBeGreaterThan(RING_OUTER * r);
  });
});

describe('the menu contents', () => {
  it('offers exactly the five feature surfaces the ten states need', () => {
    expect(DEFAULT_SATELLITES.map(s => s.id))
      .toEqual(['chat', 'imagine', 'activity', 'library', 'settings']);
  });

  it('carries badge counts through placement', () => {
    const withBadges = DEFAULT_SATELLITES.map(s =>
      s.id === 'activity' ? { ...s, badge: 12 } : s);
    const placed = placeSatellites(withBadges);
    expect(placed.find(p => p.id === 'activity')?.badge).toBe(12);
  });

  it('handles an empty menu without throwing', () => {
    expect(placeSatellites([])).toEqual([]);
  });
});
