import { describe, it, expect } from 'vitest';
import {
  CameraRig, YAW_PRESETS, FRAMINGS, FOV_DEG,
  PITCH_MIN_DEG, PITCH_MAX_DEG, YAW_NUDGE_LIMIT_DEG,
  visibleDistricts,
} from './camera';
import { DUR } from '../motion/bezier';

const DEG = Math.PI / 180;

/** Run the rig forward in realistic 16ms frames rather than one big jump. */
function advance(rig: CameraRig, ms: number, step = 16) {
  for (let t = 0; t < ms; t += step) rig.update(Math.min(step, ms - t));
}

function pitchOf(rig: CameraRig): number {
  const { position, lookAt } = rig.pose();
  const dy = position[1] - lookAt[1];
  const horiz = Math.hypot(position[0] - lookAt[0], position[2] - lookAt[2]);
  return Math.atan2(dy, horiz) / DEG;
}

/**
 * Orbit radius, measured to the *focus point* — deliberately not to `lookAt`. The rig lifts
 * `lookAt` by the framing's heightOffset so the subject seats on the lower third, so distance-to-
 * lookAt is legitimately shorter than the orbit radius. Measuring the wrong one gave a 0.31-unit
 * discrepancy that looked like a dolly bug and wasn't.
 */
function distanceOf(rig: CameraRig): number {
  const { position } = rig.pose();
  const f = rig.focus;
  return Math.hypot(position[0] - f.x, position[1] - f.y, position[2] - f.z);
}

/** Yaw in degrees, normalized to 0–360. */
function yawOf(rig: CameraRig): number {
  const { position, lookAt } = rig.pose();
  const y = Math.atan2(position[0] - lookAt[0], position[2] - lookAt[2]) / DEG;
  return ((y % 360) + 360) % 360;
}

/** Shortest signed degrees from a to b. */
function angleDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

describe('the lens is long, not wide', () => {
  it('uses a 28° FOV — wide-angle is the hobby-3D tell', () => {
    expect(FOV_DEG).toBe(28);
    expect(FOV_DEG).toBeLessThan(35);
  });
});

describe('yaw is on rails', () => {
  it('offers exactly four presets, one per board corner, 90° apart', () => {
    expect(YAW_PRESETS).toHaveLength(4);
    const yaws = YAW_PRESETS.map(p => p.yawDeg);
    for (let i = 1; i < yaws.length; i++) {
      expect(yaws[i]! - yaws[i - 1]!).toBe(90);
    }
  });

  it('rotates a quarter turn and lands exactly on the next preset', () => {
    const rig = new CameraRig('home');
    rig.rotate(1);
    advance(rig, DUR.camera + 100);
    expect(rig.activePreset).toBe('journey');
    expect(rig.isSettled).toBe(true);
  });

  it('wraps around the four corners in both directions', () => {
    const rig = new CameraRig('home');
    rig.rotate(-1);
    advance(rig, DUR.camera + 100);
    expect(rig.activePreset).toBe('vault');
    rig.rotate(1);
    advance(rig, DUR.camera + 100);
    expect(rig.activePreset).toBe('home');
  });

  it('takes the short way round instead of unwinding 270°', () => {
    const rig = new CameraRig('home');   // 45°
    rig.rotate(-1);                      // → vault at 315°, i.e. -90°, never +270°
    // Sample the whole path: the short way never leaves the 315°→45° arc that passes through 0°.
    // The long way would have to cross 180°, so watching for that is the real assertion.
    for (let t = 0; t < DUR.camera; t += 20) {
      rig.update(20);
      const d = Math.abs(angleDelta(0, yawOf(rig)));
      expect(d).toBeLessThan(90);       // stays near 0°, never swings toward 180°
    }
    advance(rig, 200);
    expect(rig.activePreset).toBe('vault');
    expect(yawOf(rig)).toBeCloseTo(315, 2);
  });

  it('is interruptible mid-transition', () => {
    const rig = new CameraRig('home');
    rig.rotate(1);
    advance(rig, 200);
    expect(rig.isTransitioning).toBe(true);
    rig.rotate(1);                        // change course before arriving
    advance(rig, DUR.camera + 100);
    expect(rig.activePreset).toBe('world');
    expect(rig.isSettled).toBe(true);
  });
});

describe('pitch is clamped — never top-down, never at the horizon', () => {
  it('starts at the authored framing pitch', () => {
    const rig = new CameraRig('home', 'board');
    expect(pitchOf(rig)).toBeCloseTo(FRAMINGS.board.pitchDeg, 4);
  });

  it('refuses to leave the 26°–46° band no matter how hard the user drags', () => {
    for (const dir of [-1, 1]) {
      const rig = new CameraRig('home', 'board');
      rig.beginDrag();
      for (let i = 0; i < 200; i++) {
        rig.drag(0, dir * 400);
        rig.update(16);
      }
      const p = pitchOf(rig);
      expect(p).toBeGreaterThanOrEqual(PITCH_MIN_DEG - 0.001);
      expect(p).toBeLessThanOrEqual(PITCH_MAX_DEG + 0.001);
    }
  });
});

describe('orbit is a lean, not a look', () => {
  it('caps the yaw nudge at ±22° from the preset, in both directions', () => {
    for (const dir of [-1, 1]) {
      const rig = new CameraRig('home', 'board');   // preset yaw 45°
      rig.beginDrag();
      for (let i = 0; i < 300; i++) { rig.drag(dir * 500, 0); rig.update(16); }
      const offset = Math.abs(angleDelta(45, yawOf(rig)));
      expect(offset).toBeLessThanOrEqual(YAW_NUDGE_LIMIT_DEG + 0.5);
      expect(offset).toBeGreaterThan(YAW_NUDGE_LIMIT_DEG - 3);   // it really did reach the cap
    }
  });

  it('springs all the way back on release — a lean can never move the camera permanently', () => {
    const rig = new CameraRig('home', 'board');
    const before = rig.pose();
    rig.beginDrag();
    for (let i = 0; i < 60; i++) { rig.drag(120, 60); rig.update(16); }
    const leaned = rig.pose();
    expect(leaned.position[0]).not.toBeCloseTo(before.position[0], 2);

    rig.endDrag();
    advance(rig, 4000);
    const after = rig.pose();
    expect(after.position[0]).toBeCloseTo(before.position[0], 2);
    expect(after.position[1]).toBeCloseTo(before.position[1], 2);
    expect(after.position[2]).toBeCloseTo(before.position[2], 2);
    expect(rig.isSettled).toBe(true);
  });

  it('does not report the nudge as part of the saved pose', () => {
    const rig = new CameraRig('home', 'board');
    rig.beginDrag();
    for (let i = 0; i < 40; i++) { rig.drag(200, 0); rig.update(16); }
    expect(rig.serialize().preset).toBe('home');
  });
});

describe('zoom is three framings, not a multiplier', () => {
  it('exposes exactly three, monotonically closer', () => {
    const ids = Object.keys(FRAMINGS);
    expect(ids).toEqual(['board', 'district', 'close']);
    expect(FRAMINGS.board.distance).toBeGreaterThan(FRAMINGS.district.distance);
    expect(FRAMINGS.district.distance).toBeGreaterThan(FRAMINGS.close.distance);
  });

  it('dollies to the exact authored distance, never between framings', () => {
    const rig = new CameraRig('home', 'board');
    rig.setFraming('district');
    advance(rig, DUR.camera + 100);
    expect(distanceOf(rig)).toBeCloseTo(FRAMINGS.district.distance, 3);
  });

  it('cannot zoom past either end', () => {
    const rig = new CameraRig('home', 'board');
    for (let i = 0; i < 8; i++) { rig.stepFraming(1); advance(rig, DUR.camera + 50); }
    expect(rig.activeFraming).toBe('close');
    for (let i = 0; i < 8; i++) { rig.stepFraming(-1); advance(rig, DUR.camera + 50); }
    expect(rig.activeFraming).toBe('board');
    expect(distanceOf(rig)).toBeCloseTo(FRAMINGS.board.distance, 3);
  });

  it('lowers the pitch as it moves in, so close-ups read as eye level', () => {
    expect(FRAMINGS.close.pitchDeg).toBeLessThan(FRAMINGS.board.pitchDeg);
  });
});

describe('roll is structurally impossible', () => {
  it('has a constant up vector that no control can touch', () => {
    const rig = new CameraRig('home', 'board');
    rig.beginDrag();
    for (let i = 0; i < 100; i++) { rig.drag(300, -300); rig.update(16); }
    rig.rotate(1);
    advance(rig, 300);
    expect(rig.up).toEqual([0, 1, 0]);
  });
});

describe('framing a district', () => {
  it('moves the look-at target and keeps the camera the framing distance from it', () => {
    const rig = new CameraRig('home', 'board');
    rig.setFraming('district', { x: 8, y: 0, z: -6 });
    advance(rig, DUR.camera + 100);
    const { lookAt } = rig.pose();
    expect(lookAt[0]).toBeCloseTo(8, 3);
    expect(lookAt[2]).toBeCloseTo(-6, 3);
    expect(distanceOf(rig)).toBeCloseTo(FRAMINGS.district.distance, 3);
  });

  it('returns to board center when framing back out', () => {
    const rig = new CameraRig('home', 'board');
    rig.setFraming('close', { x: 12, y: 0, z: 4 });
    advance(rig, DUR.camera + 100);
    rig.setFraming('board');
    advance(rig, DUR.camera + 100);
    const { lookAt } = rig.pose();
    expect(lookAt[0]).toBeCloseTo(0, 3);
    expect(lookAt[2]).toBeCloseTo(0, 3);
  });
});

describe('predictable frustum buys us culling', () => {
  it('keeps what is in front and drops what is behind', () => {
    const rig = new CameraRig('home', 'board');
    const pose = rig.pose();
    // The rig sits on +x/+z looking at the origin, so -x/-z is in front of it.
    const districts = [
      { id: 'front', position: [-6, 0, -6] as [number, number, number] },
      { id: 'behind', position: [40, 0, 40] as [number, number, number] },
    ];
    const vis = visibleDistricts(districts, pose);
    const ids = vis.map(d => d.id);
    expect(ids).toContain('front');
    expect(ids).not.toContain('behind');
  });

  it('pads the cone by ~12° so districts entering frame are already warm', () => {
    const rig = new CameraRig('home', 'board');
    const pose = rig.pose();
    const [px, py, pz] = pose.position;
    const fLen = Math.hypot(pose.lookAt[0] - px, pose.lookAt[1] - py, pose.lookAt[2] - pz);
    const fwd = [
      (pose.lookAt[0] - px) / fLen,
      (pose.lookAt[1] - py) / fLen,
      (pose.lookAt[2] - pz) / fLen,
    ] as const;

    // Sweep a probe around the forward axis and find where inclusion actually flips.
    // Rotating forward about the world up gives us a family of directions at known angles.
    let boundary = -1;
    for (let deg = 0; deg <= 80; deg += 0.5) {
      const r = deg * DEG;
      const c = Math.cos(r), s = Math.sin(r);
      const dir = [fwd[0] * c - fwd[2] * s, fwd[1], fwd[0] * s + fwd[2] * c] as const;
      const probe = {
        id: 'probe',
        position: [px + dir[0] * 30, py + dir[1] * 30, pz + dir[2] * 30] as [number, number, number],
      };
      const inFrame = visibleDistricts([probe], pose).length === 1;
      if (!inFrame) { boundary = deg; break; }
    }

    // Rotating about world-up is not exactly the cone half-angle (forward is pitched down), so
    // allow a real tolerance — the assertion that matters is that the boundary sits well beyond
    // the 23.9° true half-FOV and well short of a hemisphere.
    const trueHalfFov = Math.atan(Math.tan(14 * DEG) * (16 / 9)) / DEG;   // ≈23.9°
    expect(boundary).toBeGreaterThan(trueHalfFov);
    expect(boundary).toBeLessThan(trueHalfFov + 24);
  });
});
