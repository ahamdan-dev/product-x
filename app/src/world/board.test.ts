import { describe, it, expect } from 'vitest';
import {
  BOARD, BOARD_SIZE, TOTAL_SPACES, SPACES_PER_SIDE, DISTRICT_SLOTS,
  cornerSpace, normalizedWalkDistance, walkPath, labelFacingSign,
} from './board';

describe('board shape', () => {
  it('has 32 spaces: 4 corners plus 7 per side', () => {
    expect(TOTAL_SPACES).toBe(32);
    expect(BOARD).toHaveLength(32);
    expect(BOARD.filter(s => s.kind === 'corner')).toHaveLength(4);
    expect(BOARD.filter(s => s.kind === 'action')).toHaveLength(28);
  });

  it('emits each corner exactly once', () => {
    const corners = BOARD.filter(s => s.kind === 'corner').map(s => s.corner);
    expect(new Set(corners).size).toBe(4);
    expect(corners.sort()).toEqual(['home', 'journey', 'vault', 'world']);
  });

  it('puts exactly 7 action cards between consecutive corners', () => {
    const cornerIdx = BOARD.filter(s => s.kind === 'corner').map(s => s.index);
    for (let i = 0; i < cornerIdx.length; i++) {
      const a = cornerIdx[i]!;
      const b = cornerIdx[(i + 1) % cornerIdx.length]!;
      const gap = (b - a + TOTAL_SPACES) % TOTAL_SPACES;
      expect(gap).toBe(SPACES_PER_SIDE + 1);
    }
  });

  it('places the corners at the four board corners, per the blueprint', () => {
    const h = BOARD_SIZE / 2;
    // HOME bottom-left, JOURNEY top-left, WORLD top-right, VAULT bottom-right.
    // -Z is "top" because Three.js looks down -Z.
    expect(cornerSpace('home').position).toEqual([-h, 0, h]);
    expect(cornerSpace('journey').position).toEqual([-h, 0, -h]);
    expect(cornerSpace('world').position).toEqual([h, 0, -h]);
    expect(cornerSpace('vault').position).toEqual([h, 0, h]);
  });

  it('winds counter-clockwise from HOME so index order is walk order', () => {
    expect(BOARD[0]!.corner).toBe('home');
    const order = BOARD.filter(s => s.kind === 'corner').map(s => s.corner);
    expect(order).toEqual(['home', 'journey', 'world', 'vault']);
  });

  it('keeps every space on the perimeter, never in the interior', () => {
    const h = BOARD_SIZE / 2;
    for (const s of BOARD) {
      const onX = Math.abs(Math.abs(s.position[0]) - h) < 1e-9;
      const onZ = Math.abs(Math.abs(s.position[2]) - h) < 1e-9;
      expect(onX || onZ).toBe(true);
    }
  });

  it('spaces action cards evenly along each side', () => {
    for (const side of ['west', 'north', 'east', 'south'] as const) {
      const cards = BOARD.filter(s => s.side === side && s.kind === 'action');
      expect(cards).toHaveLength(SPACES_PER_SIDE);
      // Along the varying axis, consecutive gaps must be identical.
      const axis = side === 'west' || side === 'east' ? 2 : 0;
      const vals = cards.map(c => c.position[axis]!);
      const gaps = vals.slice(1).map((v, i) => Math.abs(v - vals[i]!));
      for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 9);
    }
  });
});

describe('orientation', () => {
  it('faces every action card outward, away from the board center', () => {
    for (const s of BOARD.filter(sp => sp.kind === 'action')) {
      // The facing must have a positive dot product with the outward radial direction.
      const dot = s.facing[0] * s.position[0] + s.facing[2] * s.position[2];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('faces corners along the diagonal bisector, not along either side', () => {
    for (const s of BOARD.filter(sp => sp.kind === 'corner')) {
      // A diagonal has both components non-zero and equal magnitude.
      expect(Math.abs(s.facing[0])).toBeCloseTo(Math.abs(s.facing[2]), 9);
      expect(Math.abs(s.facing[0])).toBeGreaterThan(0.5);
    }
  });

  it('produces a rotationY that actually points +Z along the facing vector', () => {
    for (const s of BOARD) {
      const x = Math.sin(s.rotationY);
      const z = Math.cos(s.rotationY);
      expect(x).toBeCloseTo(s.facing[0], 9);
      expect(z).toBeCloseTo(s.facing[2], 9);
    }
  });

  it('keeps every facing vector normalized', () => {
    for (const s of BOARD) {
      expect(Math.hypot(s.facing[0], s.facing[1], s.facing[2])).toBeCloseTo(1, 9);
    }
  });
});

describe('walking the board', () => {
  it('always takes the short way — half the board is the maximum', () => {
    // 0 → 24 is 24 steps forward but only 8 backward.
    expect(walkPath(0, 24)).toHaveLength(9);
    expect(walkPath(0, 24)[1]).toBe(31);          // stepped backward
    expect(normalizedWalkDistance(0, 24)).toBeCloseTo(8 / 16, 9);
  });

  it('normalizes distance to 0..1 with 1 being the far side', () => {
    expect(normalizedWalkDistance(0, 0)).toBe(0);
    expect(normalizedWalkDistance(0, 16)).toBe(1);
    expect(normalizedWalkDistance(0, 1)).toBeCloseTo(1 / 16, 9);
    for (let a = 0; a < TOTAL_SPACES; a++) {
      for (let b = 0; b < TOTAL_SPACES; b++) {
        const d = normalizedWalkDistance(a, b);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is symmetric', () => {
    for (let a = 0; a < TOTAL_SPACES; a += 3) {
      for (let b = 0; b < TOTAL_SPACES; b += 5) {
        expect(normalizedWalkDistance(a, b)).toBeCloseTo(normalizedWalkDistance(b, a), 12);
      }
    }
  });

  it('returns a contiguous path with correct endpoints and no repeats', () => {
    const p = walkPath(30, 4);
    expect(p[0]).toBe(30);
    expect(p[p.length - 1]).toBe(4);
    expect(new Set(p).size).toBe(p.length);
    for (let i = 1; i < p.length; i++) {
      const step = Math.abs(p[i]! - p[i - 1]!);
      expect(step === 1 || step === TOTAL_SPACES - 1).toBe(true);   // wraps count as one step
    }
  });

  it('handles a zero-length walk', () => {
    expect(walkPath(7, 7)).toEqual([7]);
  });
});

describe('district slots', () => {
  it('lays out 21 districts on three rings', () => {
    expect(DISTRICT_SLOTS).toHaveLength(21);
    expect(DISTRICT_SLOTS.filter(d => d.ring === 0)).toHaveLength(3);
    expect(DISTRICT_SLOTS.filter(d => d.ring === 1)).toHaveLength(7);
    expect(DISTRICT_SLOTS.filter(d => d.ring === 2)).toHaveLength(11);
  });

  it('leaves the perimeter walkway clear', () => {
    const h = BOARD_SIZE / 2;
    for (const d of DISTRICT_SLOTS) {
      const reach = Math.max(Math.abs(d.position[0]), Math.abs(d.position[2])) + d.radius;
      expect(h - reach).toBeGreaterThan(1.5);
    }
  });

  it('never overlaps two districts', () => {
    for (let i = 0; i < DISTRICT_SLOTS.length; i++) {
      for (let j = i + 1; j < DISTRICT_SLOTS.length; j++) {
        const a = DISTRICT_SLOTS[i]!, b = DISTRICT_SLOTS[j]!;
        const dist = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
        expect(dist).toBeGreaterThan((a.radius + b.radius) * 0.72);
      }
    }
  });

  it('keeps dead center empty so nothing competes with the companion', () => {
    for (const d of DISTRICT_SLOTS) {
      expect(Math.hypot(d.position[0], d.position[2])).toBeGreaterThan(1.0);
    }
  });

  it('uses prime ring counts so rings never align into visual spokes', () => {
    const isPrime = (n: number) => {
      for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
      return n > 1;
    };
    for (const ring of [0, 1, 2] as const) {
      expect(isPrime(DISTRICT_SLOTS.filter(d => d.ring === ring).length)).toBe(true);
    }
  });
});

/**
 * Label orientation. This exists because the renderer got it wrong twice and both versions passed
 * review — a fixed rotation, then a position test. Screenshots caught it; code reading did not.
 */
describe('label orientation', () => {
  /** The default camera bearing: over the south-east quadrant, looking back at the board. */
  const CAM = { x: 26, z: 26 };

  it('never reverses direction partway along a side', () => {
    // The exact defect. The old test was `position[2] < -2 || position[0] > 2`, and the south side
    // spans x = -16..+16, so its tiles disagreed with each other and one edge read half upside down.
    // Every tile on a side shares one outward axis, so every tile on a side must share one sign.
    for (const side of ['west', 'north', 'east', 'south'] as const) {
      const signs = new Set(
        BOARD.filter(s => s.side === side && s.kind === 'action')
          .map(s => labelFacingSign(s, CAM.x, CAM.z)),
      );
      expect(signs.size, `${side} disagrees with itself`).toBe(1);
    }
  });

  it('turns the label away from the camera, which is what reads right-side-up on a raked view', () => {
    for (const s of BOARD) {
      const sign = labelFacingSign(s, CAM.x, CAM.z);
      // The label's up vector, after the sign is applied.
      const ux = s.facing[0] * sign;
      const uz = s.facing[2] * sign;
      // ...must point away from the camera. A non-negative dot here would be text facing the viewer,
      // i.e. running down-screen.
      const toCamX = CAM.x - s.position[0];
      const toCamZ = CAM.z - s.position[2];
      expect(ux * toCamX + uz * toCamZ, `space ${s.index}`).toBeLessThanOrEqual(0);
    }
  });

  it('flips when the camera crosses to the other side of the board', () => {
    // The reason orientation cannot be baked once at build time: the rig orbits, so a bake is only
    // correct for one preset and reads backwards from the rest.
    const near = BOARD.find(s => s.side === 'south' && s.kind === 'action')!;
    expect(labelFacingSign(near, 0, 40)).not.toBe(labelFacingSign(near, 0, -40));
  });

  it('returns only ±1, so a basis built from it is always right-handed', () => {
    for (const s of BOARD) {
      for (const cam of [[26, 26], [-26, 26], [26, -26], [-26, -26], [0, 0]] as const) {
        expect(Math.abs(labelFacingSign(s, cam[0], cam[1]))).toBe(1);
      }
    }
  });
});
