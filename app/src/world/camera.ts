/**
 * The controlled camera. Pure math — no Three.js, no React — so the whole contract is testable.
 *
 * User ruling: "ENSURE THE MOST OPTIMAL CAMERA ANGLES THAT ARE CONTROLLED."
 * Every constant below exists to keep the world reading as a *model on a table* rather than a game
 * viewport, and to guarantee the frustum is predictable enough that off-screen districts can be
 * frozen and un-ticked.
 *
 * The contract, all enforced here:
 *   - 28° FOV. A long lens. Wide-angle is what makes hobby 3D look like a hobby.
 *   - Pitch clamped 26°–46°, base 34°. Never top-down (loses the world's silhouette), never
 *     near-horizon (loses the board's legibility).
 *   - Yaw snaps to 4 quarter-turn presets, one per board corner. Free orbit is allowed only as a
 *     ±22° nudge that springs back — you can lean to see behind a building, you cannot get lost.
 *   - 3 discrete zoom framings, each a scripted dolly. No scroll-wheel zoom multiplier.
 *   - No roll. Ever.
 */

import { clamp, damp, shortestAngle, EASE, DUR, lerp } from '../motion/bezier';

export const FOV_DEG = 28;

const DEG = Math.PI / 180;

/** The four presets, one per corner of the board. Index is stable and used for persistence. */
export const YAW_PRESETS = [
  { id: 'home',    label: 'Home',    yawDeg: 45 },
  { id: 'journey', label: 'Journey', yawDeg: 135 },
  { id: 'world',   label: 'World',   yawDeg: 225 },
  { id: 'vault',   label: 'Vault',   yawDeg: 315 },
] as const;

export type YawPresetId = typeof YAW_PRESETS[number]['id'];

/** Three framings. Distances are in world units; the board is 32 units across. */
export const FRAMINGS = {
  // 62, not 46: at a 28° lens a 32-unit board plus its rim needs this much standoff to sit inside
  // the frame. At 46 the near edge was cropped, which read as "the render is broken" rather than as
  // a close framing. Measured against the actual deck extent, not estimated.
  board:    { distance: 62, pitchDeg: 40, heightOffset: 0.0 },
  district: { distance: 24, pitchDeg: 32, heightOffset: 0.6 },
  close:    { distance: 11, pitchDeg: 26, heightOffset: 1.4 },
} as const;

export type FramingId = keyof typeof FRAMINGS;

export const PITCH_MIN_DEG = 26;
export const PITCH_MAX_DEG = 46;
/** How far the user may lean off the active preset before the rig refuses to go further. */
export const YAW_NUDGE_LIMIT_DEG = 22;
export const PITCH_NUDGE_LIMIT_DEG = 8;

/** Fraction of the nudge remaining after one second once the pointer is released. */
const SPRINGBACK_SMOOTHING = 0.0006;
/** Fraction remaining after one second while the pointer is down — a little lag reads as weight. */
const DRAG_SMOOTHING = 0.02;

export interface CameraTarget {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  /** Where the camera sits. */
  position: [number, number, number];
  /** Where it looks. */
  lookAt: [number, number, number];
}

interface Transition {
  fromYaw: number;
  toYaw: number;
  fromPitch: number;
  toPitch: number;
  fromDistance: number;
  toDistance: number;
  fromTarget: CameraTarget;
  toTarget: CameraTarget;
  elapsed: number;
  duration: number;
}

/**
 * The rig holds the *authored* pose (preset + framing) separately from the *user nudge*.
 * Keeping them separate is what makes spring-back trivially correct: the nudge decays to zero and
 * the authored pose is untouched, so a lean can never permanently move the camera.
 */
export class CameraRig {
  private presetIndex = 0;
  private framing: FramingId = 'board';

  /** Authored pose, the thing transitions animate. */
  private yaw: number;
  private pitch: number;
  private distance: number;
  private target: CameraTarget = { x: 0, y: 0, z: 0 };

  /** User nudge, in radians, always decaying toward zero. */
  private nudgeYaw = 0;
  private nudgePitch = 0;
  private nudgeYawTarget = 0;
  private nudgePitchTarget = 0;
  private dragging = false;

  private transition: Transition | null = null;

  constructor(preset: YawPresetId = 'home', framing: FramingId = 'board') {
    const idx = YAW_PRESETS.findIndex(p => p.id === preset);
    this.presetIndex = idx < 0 ? 0 : idx;
    this.framing = framing;
    this.yaw = YAW_PRESETS[this.presetIndex]!.yawDeg * DEG;
    this.pitch = FRAMINGS[framing].pitchDeg * DEG;
    this.distance = FRAMINGS[framing].distance;
  }

  // ── Discrete controls. These are the ONLY ways to change the authored pose. ────────────

  /** Rotate one quarter turn. Direction is ±1. Interruptible mid-transition. */
  rotate(direction: 1 | -1): void {
    const n = YAW_PRESETS.length;
    this.presetIndex = (this.presetIndex + direction + n) % n;
    this.beginTransition();
  }

  goToPreset(id: YawPresetId): void {
    const idx = YAW_PRESETS.findIndex(p => p.id === id);
    if (idx < 0 || idx === this.presetIndex) return;
    this.presetIndex = idx;
    this.beginTransition();
  }

  /** Change framing. Scripted dolly, not a zoom multiplier. */
  setFraming(framing: FramingId, focus?: CameraTarget): void {
    if (framing === this.framing && !focus) return;
    this.framing = framing;
    if (focus) this.target = { ...focus };
    else if (framing === 'board') this.target = { x: 0, y: 0, z: 0 };
    this.beginTransition();
  }

  /** Step in one framing level. Bound at both ends — there is no infinite zoom. */
  stepFraming(direction: 1 | -1, focus?: CameraTarget): void {
    const order: FramingId[] = ['board', 'district', 'close'];
    const i = order.indexOf(this.framing);
    const next = order[clamp(i + direction, 0, order.length - 1)]!;
    if (next !== this.framing) this.setFraming(next, focus);
  }

  /** Frame a specific district without changing the framing level. */
  focusOn(t: CameraTarget): void {
    this.target = { ...t };
    this.beginTransition();
  }

  // ── Continuous nudge. Cannot escape the clamp, always springs back. ────────────────────

  beginDrag(): void { this.dragging = true; }

  /**
   * Feed pointer movement in pixels. Sensitivity is deliberately low: this is a lean, not a look.
   */
  drag(dxPx: number, dyPx: number): void {
    if (!this.dragging) return;
    const yawLimit = YAW_NUDGE_LIMIT_DEG * DEG;
    const pitchLimit = PITCH_NUDGE_LIMIT_DEG * DEG;
    this.nudgeYawTarget = clamp(this.nudgeYawTarget + dxPx * 0.0022, -yawLimit, yawLimit);
    this.nudgePitchTarget = clamp(this.nudgePitchTarget + dyPx * 0.0016, -pitchLimit, pitchLimit);
  }

  endDrag(): void {
    this.dragging = false;
    this.nudgeYawTarget = 0;
    this.nudgePitchTarget = 0;
  }

  // ── Per-frame advance ─────────────────────────────────────────────────────────────────

  /** Advance the rig. Returns true if anything moved — the caller uses this to skip renders. */
  update(dtMs: number): boolean {
    let moved = false;

    if (this.transition) {
      const tr = this.transition;
      tr.elapsed += dtMs;
      const raw = Math.min(1, tr.elapsed / tr.duration);
      const e = EASE(raw);
      this.yaw = tr.fromYaw + shortestAngle(tr.fromYaw, tr.toYaw) * e;
      this.pitch = lerp(tr.fromPitch, tr.toPitch, e);
      this.distance = lerp(tr.fromDistance, tr.toDistance, e);
      this.target = {
        x: lerp(tr.fromTarget.x, tr.toTarget.x, e),
        y: lerp(tr.fromTarget.y, tr.toTarget.y, e),
        z: lerp(tr.fromTarget.z, tr.toTarget.z, e),
      };
      if (raw >= 1) this.transition = null;
      moved = true;
    }

    const smoothing = this.dragging ? DRAG_SMOOTHING : SPRINGBACK_SMOOTHING;
    const ny = damp(this.nudgeYaw, this.nudgeYawTarget, smoothing, dtMs);
    const np = damp(this.nudgePitch, this.nudgePitchTarget, smoothing, dtMs);
    if (Math.abs(ny - this.nudgeYaw) > 1e-5 || Math.abs(np - this.nudgePitch) > 1e-5) {
      moved = true;
    }
    this.nudgeYaw = ny;
    this.nudgePitch = np;

    return moved;
  }

  /** The pose to hand the camera this frame. Pitch is clamped here, after the nudge is applied. */
  pose(): CameraPose {
    const yaw = this.yaw + this.nudgeYaw;
    const pitch = clamp(
      this.pitch + this.nudgePitch,
      PITCH_MIN_DEG * DEG,
      PITCH_MAX_DEG * DEG,
    );
    const d = this.distance;
    const horizontal = Math.cos(pitch) * d;
    const height = Math.sin(pitch) * d;
    const offset = FRAMINGS[this.framing].heightOffset;

    return {
      position: [
        this.target.x + Math.sin(yaw) * horizontal,
        this.target.y + height,
        this.target.z + Math.cos(yaw) * horizontal,
      ],
      // Look slightly above the target at tighter framings so the subject sits on the lower third
      // rather than dead center — dead center is the generated-3D tell.
      lookAt: [this.target.x, this.target.y + offset, this.target.z],
    };
  }

  /** Roll is structurally impossible: `up` is a constant. Exposed so callers can't invent one. */
  get up(): [number, number, number] { return [0, 1, 0]; }

  /**
   * The orbit radius, i.e. camera-to-subject distance. This is NOT the distance to `lookAt` —
   * `lookAt` is lifted by the framing's `heightOffset` to seat the subject on the lower third, so
   * the two differ by design. The renderer wants this one for LOD and fog falloff.
   */
  get orbitDistance(): number { return this.distance; }

  /** The point being orbited, before the look-at height offset. */
  get focus(): CameraTarget { return { ...this.target }; }

  /** Current azimuth in radians, nudge included — for the compass affordance. */
  get azimuth(): number { return this.yaw + this.nudgeYaw; }

  get activePreset(): YawPresetId { return YAW_PRESETS[this.presetIndex]!.id; }
  get activeFraming(): FramingId { return this.framing; }
  get isTransitioning(): boolean { return this.transition !== null; }
  get isSettled(): boolean {
    return this.transition === null
      && Math.abs(this.nudgeYaw) < 1e-4
      && Math.abs(this.nudgePitch) < 1e-4;
  }

  /** For persistence. Only the authored pose round-trips — a nudge is never saved. */
  serialize() {
    return { preset: this.activePreset, framing: this.framing, target: { ...this.target } };
  }

  private beginTransition(): void {
    const f = FRAMINGS[this.framing];
    this.transition = {
      fromYaw: this.yaw,
      toYaw: YAW_PRESETS[this.presetIndex]!.yawDeg * DEG,
      fromPitch: this.pitch,
      toPitch: f.pitchDeg * DEG,
      fromDistance: this.distance,
      toDistance: f.distance,
      fromTarget: { ...this.target },
      toTarget: { ...this.target },
      elapsed: 0,
      duration: DUR.camera,
    };
  }
}

/**
 * Which districts are worth ticking. The predictable frustum is the whole point of the controlled
 * camera: with a free-fly camera you must test everything every frame, but here a cheap dot-product
 * cone test is exact enough, and it lets us freeze animation and shader time on anything behind us.
 */
export function visibleDistricts<T extends { position: [number, number, number] }>(
  districts: T[],
  pose: CameraPose,
  fovDeg = FOV_DEG,
  aspect = 16 / 9,
): T[] {
  const [px, py, pz] = pose.position;
  const [lx, ly, lz] = pose.lookAt;
  let fx = lx - px, fy = ly - py, fz = lz - pz;
  const flen = Math.hypot(fx, fy, fz) || 1;
  fx /= flen; fy /= flen; fz /= flen;

  // Horizontal FOV is the wider one; pad it so districts entering frame are already warm.
  const hFov = 2 * Math.atan(Math.tan((fovDeg * DEG) / 2) * aspect);
  const cosLimit = Math.cos(hFov / 2 + 12 * DEG);

  return districts.filter(d => {
    let dx = d.position[0] - px, dy = d.position[1] - py, dz = d.position[2] - pz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    return dx * fx + dy * fy + dz * fz >= cosLimit;
  });
}
