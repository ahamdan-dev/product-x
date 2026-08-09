/**
 * GesturePilot — the product-facing layer over hand tracking.
 *
 * Original to this project. It composes the ported HandTracker, GestureDetector and One Euro
 * filters into an API an application can actually build on: a per-frame list of *intents*
 * ("the user picked something", "the user is dragging") rather than a stream of raw landmarks.
 *
 * Two rules shape everything here:
 *
 *   1. Nothing raw escapes. Every position a consumer sees has been through a One Euro filter.
 *      MediaPipe landmarks jitter by a few thousandths of a normalized unit even on a hand held
 *      still, and an unsmoothed cursor is the single biggest reason gesture UIs feel cheap.
 *
 *   2. Every position is X-mirrored (`x = 1 - x`). The webcam is a selfie view: raise your right
 *      hand and MediaPipe reports it on the right of the image, which is the *left* of what the
 *      user perceives as their own view. Without the mirror the cursor moves opposite the hand
 *      and the whole interface feels broken. Mirroring once, here, means no consumer has to
 *      remember to do it.
 */

import * as THREE from 'three';
import {
  GestureDetector,
  type GestureConfigOverrides,
  type GestureEvent,
} from './gestureDetector';
import type { TrackedHands } from './handTracker';
import { HandTracker } from './handTracker';
import {
  HandLandmarkIndex,
  type CameraFailure,
  type DiagnosticSink,
  type Handedness,
  type HandLandmarks,
  type Landmark3,
} from './handTypes';
import { clamp, distance3D, gramSchmidtOrthogonalize, mapRange, signedAngleDelta } from './handMath';
import { OneEuroFilter, Vector3OneEuroFilter } from './smoothing';

/** A 2D point in mirrored, normalized screen space. Both axes run 0..1. */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * What the user is telling the application to do. Deliberately small: these are the primitives
 * an app needs, not a catalogue of everything the hand can do.
 */
export type PilotIntent =
  /** Index-finger cursor, smoothed. Emitted every frame a hand is tracked and not manipulating. */
  | { kind: 'point'; at: Point2; hand: Handedness }
  /** Fist closed. Emitted every frame the fist is held, so a consumer can drag. */
  | { kind: 'grab'; at: Point2; hand: Handedness }
  /** The fist opened, or the hand left the frame while closed. Always paired with a `grab`. */
  | { kind: 'release'; hand: Handedness }
  /** A pinch tap — one click. Fires once per pinch, never once per frame. */
  | { kind: 'pick'; at: Point2; hand: Handedness }
  /** Two-hand spread. `factor` is relative to the separation when the gesture latched. */
  | { kind: 'scale'; factor: number }
  /** Two-hand twist. Cumulative signed rotation since latch; positive = counter-clockwise. */
  | { kind: 'spin'; deltaRadians: number }
  /** A fast swipe of the index finger. */
  | { kind: 'slice'; from: Point2; to: Point2; hand: Handedness }
  /** Nothing is happening. Emitted alone, never alongside another intent. */
  | { kind: 'idle' };

/** One tracked hand, fully smoothed and mirrored. */
export interface PilotHand {
  hand: Handedness;
  /** Smoothed palm center in mirrored normalized space. */
  at: Point2;
  /** Smoothed index fingertip in mirrored normalized space — the cursor. */
  pointer: Point2;
  /** MediaPipe's relative depth at the palm, smoothed. Negative is closer to the camera. */
  depth: number;
  /** Palm-facing orientation, smoothed. Valid rotation (proper, orthonormal). */
  quaternion: THREE.Quaternion;
  /** 0 = closed fist, 1 = flat open hand. */
  openness: number;
  /** Index-tip speed in normalized units per second. */
  speed: number;
}

export interface PilotFrame {
  intents: PilotIntent[];
  hands: PilotHand[];
  /** Mean MediaPipe handedness score across tracked hands; 0 when nothing is tracked. */
  confidence: number;
}

/** Anything that can supply hands for a frame. `HandTracker` satisfies this structurally. */
export interface HandSource {
  readHands(timestampMs: number): TrackedHands;
}

export interface PilotConfig {
  /** One Euro minimum cutoff for positions, in Hz. Lower = calmer at rest, more lag. */
  positionMinCutoff: number;
  /** One Euro speed coefficient for positions. Higher = less lag during fast motion. */
  positionBeta: number;
  /** One Euro minimum cutoff for the openness scalar, in Hz. */
  opennessMinCutoff: number;
  /** One Euro speed coefficient for openness. */
  opennessBeta: number;
  /** Fingertip-to-wrist over palm-scale ratio that maps to openness 0. */
  closedRatio: number;
  /** Fingertip-to-wrist over palm-scale ratio that maps to openness 1. */
  openRatio: number;
  /** Index-tip speed, in normalized units per second, above which a swipe counts as a slice. */
  sliceSpeed: number;
  /** Consecutive frames above `sliceSpeed` required before a slice is emitted. */
  sliceFrames: number;
  /** Lower clamp for `scale.factor`. */
  scaleMin: number;
  /** Upper clamp for `scale.factor`. */
  scaleMax: number;
  /** Minimum palm separation at latch time. Guards against dividing by a noisy near-zero. */
  minTwoHandSeparation: number;
  /** How long a point must be dwelled on before `dwellProgress` reaches 1. */
  dwellHoldMs: number;
  /** How long a hand may be missing before its filters are discarded rather than resumed. */
  handLostMs: number;
}

export const DEFAULT_PILOT_CONFIG: PilotConfig = {
  positionMinCutoff: 1.2,
  positionBeta: 0.6,
  opennessMinCutoff: 2.0,
  opennessBeta: 0.4,
  // A flat open hand puts the fingertips a little over 2x the palm scale from the wrist; a fist
  // brings them to roughly 1.1x. These bounds match the fist detector's own hysteresis band.
  closedRatio: 1.2,
  openRatio: 2.1,
  sliceSpeed: 1.5,
  sliceFrames: 3,
  scaleMin: 0.5,
  scaleMax: 2.0,
  minTwoHandSeparation: 0.08,
  dwellHoldMs: 900,
  handLostMs: 250,
};

export interface GesturePilotOptions {
  /**
   * Where hands come from. Defaults to an internally owned `HandTracker`, which must then be
   * started with `attach(video)`. Pass a source to drive the pilot from recorded or synthetic
   * frames — that is how it is tested, with no camera and no MediaPipe.
   */
  source?: HandSource;
  config?: Partial<PilotConfig>;
  /** Overrides for the ported detector thresholds. These are tuned; change with care. */
  gestures?: GestureConfigOverrides;
  onDiagnostic?: DiagnosticSink;
}

/** Per-hand smoothing and gesture bookkeeping. Keyed by a stable slot id, not by array index. */
interface HandSlot {
  hand: Handedness;
  palm: Vector3OneEuroFilter;
  pointer: Vector3OneEuroFilter;
  /** The palm basis is smoothed as two vectors and re-orthonormalized, rather than as a
   *  quaternion: filtering in a linear space sidesteps quaternion double-cover entirely, and
   *  Gram-Schmidt guarantees the result is still a valid rotation. */
  forward: Vector3OneEuroFilter;
  right: Vector3OneEuroFilter;
  openness: OneEuroFilter;
  lastPointer: Point2 | null;
  lastSeenAt: number;
  /** True while a fist is held, so a release can still be emitted if the hand vanishes. */
  grabbing: boolean;
  /** Consecutive frames the pointer has exceeded `sliceSpeed`. */
  fastFrames: number;
  /** Pointer position when the current fast run began. */
  fastFrom: Point2 | null;
  /** False after a slice fires, until the pointer slows back down. Stops one swipe repeating. */
  sliceArmed: boolean;
}

interface TwoHandLatch {
  keyA: string;
  keyB: string;
  startDistance: number;
  lastAngle: number;
  totalRotation: number;
}

interface DwellEntry {
  heldMs: number;
}

const PALM_POINTS: readonly number[] = [
  HandLandmarkIndex.WRIST,
  HandLandmarkIndex.INDEX_FINGER_MCP,
  HandLandmarkIndex.MIDDLE_FINGER_MCP,
  HandLandmarkIndex.RING_FINGER_MCP,
  HandLandmarkIndex.PINKY_MCP,
];

const OPENNESS_TIPS: readonly number[] = [
  HandLandmarkIndex.INDEX_FINGER_TIP,
  HandLandmarkIndex.MIDDLE_FINGER_TIP,
  HandLandmarkIndex.RING_FINGER_TIP,
  HandLandmarkIndex.PINKY_TIP,
];

/** Below this the palm scale is noise and ratios built on it are meaningless. */
const MIN_PALM_SCALE = 0.01;

const IDLE_FRAME: PilotIntent = { kind: 'idle' };

export class GesturePilot {
  private readonly source: HandSource;
  private readonly tracker: HandTracker | null;
  private readonly detector: GestureDetector;
  private readonly diagnostic: DiagnosticSink;
  private cfg: PilotConfig;

  private slots = new Map<string, HandSlot>();
  private latch: TwoHandLatch | null = null;
  private dwells = new Map<string, DwellEntry>();
  private lastHands: PilotHand[] = [];

  constructor(options: GesturePilotOptions = {}) {
    this.cfg = { ...DEFAULT_PILOT_CONFIG, ...options.config };
    this.diagnostic = options.onDiagnostic ?? (() => {});
    this.detector = new GestureDetector(options.gestures ?? {});

    if (options.source) {
      this.source = options.source;
      this.tracker = null;
    } else {
      const tracker = new HandTracker({ onDiagnostic: this.diagnostic });
      this.tracker = tracker;
      this.source = tracker;
    }
  }

  /**
   * Start the owned tracker against a video element. Returns false when the pilot was built with
   * an external source, where there is nothing to attach.
   */
  async attach(videoElement: HTMLVideoElement): Promise<boolean> {
    if (!this.tracker) {
      this.diagnostic('warn', 'attach() ignored: pilot is driven by an external hand source');
      return false;
    }
    await this.tracker.initialize(videoElement);
    return this.tracker.isCameraEnabled();
  }

  /** Release the camera but keep MediaPipe resident, so it can be re-enabled cheaply. */
  stopCamera(): void {
    this.tracker?.stop();
    this.reset();
  }

  /** Why the camera last failed, or null. Undefined when there is no owned tracker. */
  get cameraFailure(): CameraFailure | null | undefined {
    return this.tracker?.lastFailure;
  }

  dispose(): void {
    this.tracker?.dispose();
    this.reset();
  }

  get config(): Readonly<PilotConfig> {
    return this.cfg;
  }

  updateConfig(patch: Partial<PilotConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  /** Drop all smoothing, latch, dwell and gesture state. */
  reset(): void {
    this.slots.clear();
    this.latch = null;
    this.dwells.clear();
    this.lastHands = [];
    this.detector.reset();
  }

  /**
   * Advance one frame.
   *
   * @param timestampMs Monotonically increasing milliseconds — the same clock passed to
   *   `requestAnimationFrame`. Converted to seconds internally, because One Euro's alpha is
   *   derived from dt in seconds and feeding it milliseconds silently disables all smoothing.
   */
  update(timestampMs: number): PilotFrame {
    const tSec = timestampMs / 1000;
    const tracked = this.source.readHands(timestampMs);
    const { events } = this.detector.detect(tracked.hands, tracked.handedness, timestampMs);
    const eventsByHand = groupByHand(events);

    const hands: PilotHand[] = [];
    const liveKeys: string[] = [];
    const intents: PilotIntent[] = [];

    for (let i = 0; i < tracked.hands.length; i++) {
      const raw = tracked.hands[i];
      if (!raw) continue;
      const handedness = tracked.handedness[i] ?? 'unknown';
      const key = slotKey(handedness, i);

      const slot = this.slotFor(key, handedness, timestampMs);
      const built = this.buildHand(slot, raw, handedness, tSec);
      if (!built) continue;

      liveKeys.push(key);
      hands.push(built);

      const dtMs = slot.lastPointer ? Math.max(0, timestampMs - slot.lastSeenAt) : 0;
      built.speed = this.measureSpeed(slot, built.pointer, dtMs);
      slot.lastPointer = built.pointer;
      slot.lastSeenAt = timestampMs;

      this.collectHandIntents(slot, built, eventsByHand.get(handedness) ?? [], intents);
    }

    // A hand that vanishes mid-fist would otherwise leave a consumer stuck in a drag forever.
    this.reapMissingSlots(new Set(liveKeys), timestampMs, intents);

    const twoHand = this.updateLatch(hands, eventsByHand);
    if (twoHand.length > 0) {
      // While two hands are manipulating, per-hand intents are suppressed. The hands are busy;
      // a cursor and a click coming through mid-pinch-zoom would fight the manipulation.
      intents.length = 0;
      intents.push(...twoHand);
    }

    if (intents.length === 0) intents.push(IDLE_FRAME);

    this.lastHands = hands;
    return { intents, hands, confidence: tracked.confidence };
  }

  /**
   * Hands-free confirmation: how long the cursor has rested inside a target, as 0..1.
   *
   * With no buttons and no click surface, dwell is how a user commits to something. Call it once
   * per frame per target; it returns 1 only once the pointer has stayed within `radius` of `at`
   * for `config.dwellHoldMs`, and drops straight back to 0 the moment the pointer leaves.
   *
   * @param targetId Stable id for the target — progress is tracked per id.
   * @param at Center of the target, in mirrored normalized space (the same space as `PilotHand`).
   * @param radius Hit radius in normalized units.
   * @param dtMs Milliseconds since the previous call for this target.
   */
  dwellProgress(targetId: string, at: Point2, radius: number, dtMs: number): number {
    const pointer = this.nearestPointer(at);
    if (!pointer || Math.hypot(pointer.x - at.x, pointer.y - at.y) > radius) {
      this.dwells.delete(targetId);
      return 0;
    }

    const entry = this.dwells.get(targetId) ?? { heldMs: 0 };
    entry.heldMs += Math.max(0, dtMs);
    this.dwells.set(targetId, entry);

    return clamp(entry.heldMs / this.cfg.dwellHoldMs, 0, 1);
  }

  /** Forget dwell progress for one target, or all of them. */
  clearDwell(targetId?: string): void {
    if (targetId === undefined) this.dwells.clear();
    else this.dwells.delete(targetId);
  }

  private nearestPointer(to: Point2): Point2 | null {
    let best: Point2 | null = null;
    let bestDist = Infinity;
    for (const hand of this.lastHands) {
      const d = Math.hypot(hand.pointer.x - to.x, hand.pointer.y - to.y);
      if (d < bestDist) {
        bestDist = d;
        best = hand.pointer;
      }
    }
    return best;
  }

  private slotFor(key: string, handedness: Handedness, timestampMs: number): HandSlot {
    const existing = this.slots.get(key);
    if (existing) {
      // The hand was gone long enough that resuming its filters would drag the cursor across
      // the screen from wherever it used to be. Start clean instead.
      if (timestampMs - existing.lastSeenAt > this.cfg.handLostMs) {
        this.resetSlotFilters(existing);
        existing.lastPointer = null;
      }
      existing.hand = handedness;
      return existing;
    }

    const slot: HandSlot = {
      hand: handedness,
      palm: this.newVectorFilter(),
      pointer: this.newVectorFilter(),
      forward: this.newVectorFilter(),
      right: this.newVectorFilter(),
      openness: new OneEuroFilter(this.cfg.opennessMinCutoff, this.cfg.opennessBeta),
      lastPointer: null,
      lastSeenAt: timestampMs,
      grabbing: false,
      fastFrames: 0,
      fastFrom: null,
      sliceArmed: true,
    };
    this.slots.set(key, slot);
    return slot;
  }

  private newVectorFilter(): Vector3OneEuroFilter {
    return new Vector3OneEuroFilter(this.cfg.positionMinCutoff, this.cfg.positionBeta);
  }

  private resetSlotFilters(slot: HandSlot): void {
    slot.palm.reset();
    slot.pointer.reset();
    slot.forward.reset();
    slot.right.reset();
    slot.openness.reset();
    slot.fastFrames = 0;
    slot.fastFrom = null;
    slot.sliceArmed = true;
  }

  private buildHand(
    slot: HandSlot,
    raw: HandLandmarks,
    handedness: Handedness,
    tSec: number,
  ): PilotHand | null {
    const wrist = raw[HandLandmarkIndex.WRIST];
    const indexMCP = raw[HandLandmarkIndex.INDEX_FINGER_MCP];
    const middleMCP = raw[HandLandmarkIndex.MIDDLE_FINGER_MCP];
    const indexTip = raw[HandLandmarkIndex.INDEX_FINGER_TIP];
    if (!wrist || !indexMCP || !middleMCP || !indexTip) return null;

    const palmRaw = centroid(raw, PALM_POINTS);
    if (!palmRaw) return null;

    // Mirror on the way in, so every downstream number — position, basis, angle — lives in the
    // space the user perceives.
    const palm = slot.palm
      .filter(new THREE.Vector3(1 - palmRaw.x, palmRaw.y, palmRaw.z), tSec)
      .clone();
    const pointer = slot.pointer
      .filter(new THREE.Vector3(1 - indexTip.x, indexTip.y, indexTip.z), tSec)
      .clone();

    const mWrist = mirror(wrist);
    const mIndex = mirror(indexMCP);
    const mMiddle = mirror(middleMCP);

    const forward = slot.forward
      .filter(
        new THREE.Vector3(mMiddle.x - mWrist.x, mMiddle.y - mWrist.y, mMiddle.z - mWrist.z),
        tSec,
      )
      .clone();
    const right = slot.right
      .filter(
        new THREE.Vector3(mIndex.x - mWrist.x, mIndex.y - mWrist.y, mIndex.z - mWrist.z),
        tSec,
      )
      .clone();

    const quaternion = palmQuaternion(forward, right);
    const openness = clamp(slot.openness.filter(this.rawOpenness(raw, wrist, middleMCP), tSec), 0, 1);

    return {
      hand: handedness,
      at: { x: palm.x, y: palm.y },
      pointer: { x: pointer.x, y: pointer.y },
      depth: palm.z,
      quaternion,
      openness,
      speed: 0,
    };
  }

  /**
   * Openness as the mean fingertip-to-wrist distance over palm scale, remapped to 0..1. Using a
   * ratio rather than an absolute distance makes it invariant to how far the hand is from the
   * camera — the same gesture reads the same at arm's length and up close.
   */
  private rawOpenness(raw: HandLandmarks, wrist: Landmark3, middleMCP: Landmark3): number {
    const palmScale = distance3D(wrist, middleMCP);
    if (palmScale < MIN_PALM_SCALE) return 0;

    let sum = 0;
    let count = 0;
    for (const tipIndex of OPENNESS_TIPS) {
      const tip = raw[tipIndex];
      if (!tip) continue;
      sum += distance3D(tip, wrist) / palmScale;
      count++;
    }
    if (count === 0) return 0;

    return clamp(mapRange(sum / count, this.cfg.closedRatio, this.cfg.openRatio, 0, 1), 0, 1);
  }

  private measureSpeed(slot: HandSlot, pointer: Point2, dtMs: number): number {
    if (!slot.lastPointer || dtMs <= 0) return 0;
    const dist = Math.hypot(pointer.x - slot.lastPointer.x, pointer.y - slot.lastPointer.y);
    return dist / (dtMs / 1000);
  }

  private collectHandIntents(
    slot: HandSlot,
    hand: PilotHand,
    handEvents: readonly GestureEvent[],
    out: PilotIntent[],
  ): void {
    let fistPhase: GestureEvent['phase'] | null = null;
    let pickAt: Point2 | null = null;

    for (const event of handEvents) {
      if (event.kind === 'fist') {
        fistPhase = event.phase;
      } else if (event.kind === 'pinch' && event.phase === 'started') {
        // Only the `started` frame becomes a pick. `active` repeats every frame, and the
        // detector's cooldown is what keeps a fluttering hand from producing a burst of clicks.
        pickAt = { x: 1 - event.normalized.x, y: event.normalized.y };
      }
    }

    if (fistPhase === 'started' || fistPhase === 'active') {
      slot.grabbing = true;
      out.push({ kind: 'grab', at: hand.at, hand: hand.hand });
    } else if (fistPhase === 'ended') {
      slot.grabbing = false;
      out.push({ kind: 'release', hand: hand.hand });
    } else {
      // A cursor and a closed fist are mutually exclusive: pointing with a fist is meaningless.
      out.push({ kind: 'point', at: hand.pointer, hand: hand.hand });
    }

    if (pickAt) out.push({ kind: 'pick', at: pickAt, hand: hand.hand });

    const slice = this.trackSlice(slot, hand);
    if (slice) out.push(slice);
  }

  /**
   * A slice is a velocity gate, not a shape match. The index tip has to sustain more than
   * `sliceSpeed` for `sliceFrames` consecutive frames — one noisy frame at 4 units/s happens all
   * the time and must not fire, whereas three in a row is a deliberate swipe.
   */
  private trackSlice(slot: HandSlot, hand: PilotHand): PilotIntent | null {
    const fast = hand.speed > this.cfg.sliceSpeed;

    if (!fast) {
      slot.fastFrames = 0;
      slot.fastFrom = null;
      // Re-arm only once the hand has actually slowed down, so one long swipe fires once.
      slot.sliceArmed = true;
      return null;
    }

    slot.fastFrames++;
    if (!slot.fastFrom) slot.fastFrom = slot.lastPointer ?? hand.pointer;

    if (!slot.sliceArmed || slot.fastFrames < this.cfg.sliceFrames) return null;

    slot.sliceArmed = false;
    return {
      kind: 'slice',
      from: slot.fastFrom,
      to: hand.pointer,
      hand: hand.hand,
    };
  }

  private reapMissingSlots(
    liveKeys: ReadonlySet<string>,
    timestampMs: number,
    out: PilotIntent[],
  ): void {
    for (const [key, slot] of this.slots) {
      if (liveKeys.has(key)) continue;

      if (slot.grabbing) {
        slot.grabbing = false;
        out.push({ kind: 'release', hand: slot.hand });
      }
      slot.fastFrames = 0;
      slot.fastFrom = null;

      if (timestampMs - slot.lastSeenAt > this.cfg.handLostMs) this.slots.delete(key);
    }
  }

  /**
   * Two-hand scale and spin.
   *
   * Both are derived from the vector between the two palm centers: `factor` is the current
   * separation over the separation at latch, `deltaRadians` is the accumulated signed rotation
   * of that vector. Relative-to-latch is what makes them usable — an absolute distance would
   * mean nothing without knowing the user's arm span.
   *
   * The latch requires a pinch on *both* hands and drops the moment either hand opens. That
   * gate is the whole reason these can't fire from noise: two hands merely being visible and
   * drifting would otherwise scale and rotate the scene constantly.
   */
  private updateLatch(
    hands: readonly PilotHand[],
    eventsByHand: ReadonlyMap<Handedness, GestureEvent[]>,
  ): PilotIntent[] {
    const pinching = hands.filter((hand) => isPinchHeld(eventsByHand.get(hand.hand)));

    if (pinching.length < 2) {
      this.latch = null;
      return [];
    }

    // Deterministic ordering so the angle's sign is stable frame to frame. Alphabetical puts
    // 'left' before 'right', which also makes the vector read left-to-right.
    const ordered = [...pinching].sort((a, b) => a.hand.localeCompare(b.hand));
    const a = ordered[0];
    const b = ordered[1];
    if (!a || !b) return [];

    const separation = Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y);
    // Y is negated so positive rotation reads counter-clockwise to the user: normalized Y grows
    // downward, and atan2 in a y-down space has the opposite handedness to what people expect.
    const angle = Math.atan2(-(b.at.y - a.at.y), b.at.x - a.at.x);

    if (!this.latch || this.latch.keyA !== a.hand || this.latch.keyB !== b.hand) {
      if (separation < this.cfg.minTwoHandSeparation) {
        this.latch = null;
        return [];
      }
      this.latch = {
        keyA: a.hand,
        keyB: b.hand,
        startDistance: separation,
        lastAngle: angle,
        totalRotation: 0,
      };
      // No motion has happened yet, so report the identity transform rather than nothing —
      // consumers can take this as "manipulation began".
      return [
        { kind: 'scale', factor: 1 },
        { kind: 'spin', deltaRadians: 0 },
      ];
    }

    // Accumulate per frame through signedAngleDelta so a twist past ±π doesn't snap a full turn.
    this.latch.totalRotation += signedAngleDelta(this.latch.lastAngle, angle);
    this.latch.lastAngle = angle;

    const factor = clamp(
      separation / this.latch.startDistance,
      this.cfg.scaleMin,
      this.cfg.scaleMax,
    );

    return [
      { kind: 'scale', factor },
      { kind: 'spin', deltaRadians: this.latch.totalRotation },
    ];
  }
}

function isPinchHeld(events: readonly GestureEvent[] | undefined): boolean {
  if (!events) return false;
  return events.some(
    (event) => event.kind === 'pinch' && (event.phase === 'started' || event.phase === 'active'),
  );
}

/**
 * Group events by handedness.
 *
 * Two hands both classified `unknown` would share a bucket. That is consistent with the ported
 * detector, whose state slots collapse `unknown` onto `right` for the same reason, and it does
 * not happen in practice — MediaPipe classifies handedness on essentially every frame it
 * reports a hand at all.
 */
function groupByHand(events: readonly GestureEvent[]): Map<Handedness, GestureEvent[]> {
  const map = new Map<Handedness, GestureEvent[]>();
  for (const event of events) {
    const bucket = map.get(event.hand);
    if (bucket) bucket.push(event);
    else map.set(event.hand, [event]);
  }
  return map;
}

/** Stable per-hand filter key. Falls back to array index only for unclassified hands. */
function slotKey(handedness: Handedness, index: number): string {
  return handedness === 'unknown' ? `unknown:${index}` : handedness;
}

function mirror(landmark: Landmark3): Landmark3 {
  return { x: 1 - landmark.x, y: landmark.y, z: landmark.z };
}

function centroid(raw: HandLandmarks, indices: readonly number[]): Landmark3 | null {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const index of indices) {
    const point = raw[index];
    if (!point) continue;
    x += point.x;
    y += point.y;
    z += point.z;
    count++;
  }
  if (count === 0) return null;
  return { x: x / count, y: y / count, z: z / count };
}

/**
 * Build a rotation from two smoothed, non-perpendicular palm vectors. Gram-Schmidt is what makes
 * this a valid rotation: the raw vectors are neither orthogonal nor unit length, and feeding them
 * straight to `makeBasis` produces a shearing matrix rather than an orientation.
 */
function palmQuaternion(forward: THREE.Vector3, right: THREE.Vector3): THREE.Quaternion {
  if (forward.lengthSq() < 1e-12 || right.lengthSq() < 1e-12) return new THREE.Quaternion();

  const basis = gramSchmidtOrthogonalize(forward, right);
  const matrix = new THREE.Matrix4().makeBasis(basis.right, basis.up, basis.forward);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}
