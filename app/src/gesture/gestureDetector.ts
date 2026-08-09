/**
 * GestureDetector — turns MediaPipe landmarks into gesture lifecycle events.
 *
 * Derived from gesture-lab `src/shared/GestureDetector.ts` and `src/shared/GestureTypes.ts`
 * (MIT). See LICENSE-gesture-lab.md.
 *
 * The detection math, hysteresis bands and cooldowns are ported unchanged. Every threshold in
 * DEFAULT_GESTURE_CONFIG is a tuned value — a "cleaner" number makes gestures either chatter or
 * refuse to fire, and neither failure is visible in code review.
 *
 * Changes from upstream:
 *   - `enum GestureType` / `enum GestureState` became string-literal unions. `enum` emits
 *     runtime code, which this project avoids under `verbatimModuleSyntax` / `isolatedModules`.
 *   - The four copy-pasted thumb-to-finger pinch routines are one parametrized routine. Same
 *     arithmetic, same per-finger thresholds, one place to read.
 *   - `detect()` returns every event with its handedness attached instead of a single
 *     last-hand-wins slot per gesture, so two-handed gestures can be attributed.
 *   - Every landmark access is guarded, because `noUncheckedIndexedAccess` types them as
 *     possibly-undefined and a truncated landmark array would otherwise crash mid-frame.
 */

import * as THREE from 'three';
import { HandLandmarkIndex, type Handedness, type HandLandmarks, type Landmark3 } from './handTypes';
import { distance3D } from './handMath';

/** Which gesture an event describes. */
export type GestureKind = 'pinch' | 'middlePinch' | 'ringPinch' | 'pinkyPinch' | 'fist';

/** The thumb-to-fingertip pinches, which all share one detection routine. */
export type PinchKind = 'pinch' | 'middlePinch' | 'ringPinch' | 'pinkyPinch';

/** Where a gesture is in its lifecycle. `idle` is never emitted; it means "no event". */
export type GesturePhase = 'idle' | 'started' | 'active' | 'ended';

/** The phases that actually reach a consumer. */
export type EmittedPhase = Exclude<GesturePhase, 'idle'>;

interface GestureEventBase {
  phase: EmittedPhase;
  /** Which hand produced this. */
  hand: Handedness;
  /** Gesture point in MediaPipe's normalized space — NOT mirrored. */
  normalized: { x: number; y: number; z: number };
  /**
   * Gesture point in Three.js world units. X is mirrored and Y flipped to match a selfie-view
   * video, then scaled by 10. Ported as-is from upstream.
   */
  position: THREE.Vector3;
  /** ms the gesture has been held. 0 on the `started` frame. */
  holdDuration: number;
  timestamp: number;
}

export interface PinchEvent extends GestureEventBase {
  kind: PinchKind;
  /** 3D separation of thumb tip and the paired fingertip, in normalized units. */
  distance: number;
  /** 0..1, how far inside the release threshold the pinch is. */
  strength: number;
}

export interface FistEvent extends GestureEventBase {
  kind: 'fist';
}

export type GestureEvent = PinchEvent | FistEvent;

/** Hysteresis + debounce band for one pinch pairing. */
export interface PinchThresholds {
  /** Fingertip separation below which the pinch triggers, in normalized units. */
  threshold: number;
  /** Separation above which the pinch releases. Above `threshold` on purpose — that gap is the
   *  hysteresis band that stops a hand hovering at the boundary from chattering. */
  releaseThreshold: number;
  /** Minimum ms between two triggers of this pinch. This is what makes a pinch a single click
   *  instead of one event per frame. */
  cooldownMs: number;
}

export interface FistThresholds {
  /** Fingertip-to-wrist over palm-scale ratio below which a finger counts as curled. */
  closeThreshold: number;
  /** Ratio above which a finger counts as extended. The gap from `closeThreshold` is the
   *  hysteresis band. */
  openThreshold: number;
  /** Consecutive frames of a closed hand needed to confirm a fist. */
  minDurationFrames: number;
}

export interface GestureConfig {
  pinch: PinchThresholds;
  middlePinch: PinchThresholds;
  ringPinch: PinchThresholds;
  pinkyPinch: PinchThresholds;
  fist: FistThresholds;
}

/** Per-section partial overrides. Top-level `Partial` would silently drop sibling thresholds. */
export type GestureConfigOverrides = {
  [K in keyof GestureConfig]?: Partial<GestureConfig[K]>;
};

/**
 * Tuned defaults, ported verbatim. Do not round these off.
 */
export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  pinch: {
    threshold: 0.035,
    releaseThreshold: 0.06,
    cooldownMs: 400,
  },
  middlePinch: {
    threshold: 0.045,
    releaseThreshold: 0.07,
    cooldownMs: 150,
  },
  ringPinch: {
    threshold: 0.045,
    releaseThreshold: 0.07,
    cooldownMs: 150,
  },
  pinkyPinch: {
    threshold: 0.055,
    releaseThreshold: 0.08,
    cooldownMs: 200,
  },
  fist: {
    closeThreshold: 1.2,
    openThreshold: 1.6,
    minDurationFrames: 1,
  },
};

export function resolveGestureConfig(overrides: GestureConfigOverrides = {}): GestureConfig {
  return {
    pinch: { ...DEFAULT_GESTURE_CONFIG.pinch, ...overrides.pinch },
    middlePinch: { ...DEFAULT_GESTURE_CONFIG.middlePinch, ...overrides.middlePinch },
    ringPinch: { ...DEFAULT_GESTURE_CONFIG.ringPinch, ...overrides.ringPinch },
    pinkyPinch: { ...DEFAULT_GESTURE_CONFIG.pinkyPinch, ...overrides.pinkyPinch },
    fist: { ...DEFAULT_GESTURE_CONFIG.fist, ...overrides.fist },
  };
}

export interface GestureDetectionResult {
  /** Every event produced this frame, across all hands. */
  events: GestureEvent[];
}

/** Which fingertip each pinch pairs with the thumb. */
const PINCH_TIP: Record<PinchKind, number> = {
  pinch: HandLandmarkIndex.INDEX_FINGER_TIP,
  middlePinch: HandLandmarkIndex.MIDDLE_FINGER_TIP,
  ringPinch: HandLandmarkIndex.RING_FINGER_TIP,
  pinkyPinch: HandLandmarkIndex.PINKY_TIP,
};

const PINCH_KINDS: readonly PinchKind[] = ['pinch', 'middlePinch', 'ringPinch', 'pinkyPinch'];

/** Fingertips checked when deciding whether a hand is a fist. The thumb is excluded upstream. */
const FIST_TIPS: readonly number[] = [
  HandLandmarkIndex.INDEX_FINGER_TIP,
  HandLandmarkIndex.MIDDLE_FINGER_TIP,
  HandLandmarkIndex.RING_FINGER_TIP,
  HandLandmarkIndex.PINKY_TIP,
];

/**
 * One frame of a pinch is enough to trigger. Ported from upstream, where all four pinches set
 * this to 1 for instant reaction; the cooldown, not a frame count, prevents repeats.
 */
const REQUIRED_SUSTAINED_FRAMES = 1;

/** Below this, the wrist-to-MCP scale reference is noise and the frame is unusable. */
const MIN_PALM_SCALE = 0.01;

/** World-space scale applied to normalized coordinates. Ported from upstream. */
const WORLD_SCALE = 10;

type HandKey = 'left' | 'right';

interface PinchState {
  isActive: boolean;
  lastTriggerTime: number;
  sustainedFrames: number;
  holdStartTime: number;
}

interface FistState {
  isActive: boolean;
  sustainedFrames: number;
  holdStartTime: number;
}

/**
 * `unknown` handedness shares the right hand's state slot. Ported from upstream, where the
 * ternary `handedness === 'left' ? 'left' : 'right'` had the same effect. It matters only if
 * MediaPipe fails to classify both hands at once, which it effectively never does.
 */
export function handKey(handedness: Handedness): HandKey {
  return handedness === 'left' ? 'left' : 'right';
}

function at(hand: HandLandmarks, index: number): Landmark3 | undefined {
  return hand[index];
}

export class GestureDetector {
  private config: GestureConfig;
  private pinchState!: Record<PinchKind, Record<HandKey, PinchState>>;
  private fistState!: Record<HandKey, FistState>;

  constructor(overrides: GestureConfigOverrides = {}) {
    this.config = resolveGestureConfig(overrides);
    this.reset();
  }

  /**
   * Run detection for one frame.
   *
   * @param hands One landmark array per detected hand.
   * @param handedness Handedness per hand, index-aligned with `hands`.
   * @param timestamp Milliseconds. Used for cooldowns and hold durations.
   */
  detect(
    hands: readonly HandLandmarks[],
    handedness: readonly Handedness[],
    timestamp: number,
  ): GestureDetectionResult {
    const events: GestureEvent[] = [];

    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i];
      if (!hand) continue;
      const handType = handedness[i] ?? 'unknown';

      for (const kind of PINCH_KINDS) {
        const event = this.detectPinch(hand, kind, handType, timestamp);
        if (event) events.push(event);
      }

      const fist = this.detectFist(hand, handType, timestamp);
      if (fist) events.push(fist);
    }

    return { events };
  }

  /**
   * Thumb-to-fingertip pinch.
   *
   * Fires when the tips come within `threshold`, releases only once they separate past
   * `releaseThreshold`, and cannot re-fire until `cooldownMs` has passed. The band between the
   * two thresholds is where a real hand spends most of its time, and holding state through it is
   * the entire reason a pinch reads as one deliberate click.
   */
  private detectPinch(
    hand: HandLandmarks,
    kind: PinchKind,
    handedness: Handedness,
    timestamp: number,
  ): PinchEvent | null {
    const thumbTip = at(hand, HandLandmarkIndex.THUMB_TIP);
    const fingerTip = at(hand, PINCH_TIP[kind]);
    if (!thumbTip || !fingerTip) return null;

    const thresholds = this.config[kind];
    const distance = distance3D(thumbTip, fingerTip);

    const state = this.pinchState[kind][handKey(handedness)];
    const wasActive = state.isActive;
    const isPinching = distance < thresholds.threshold;
    const isReleased = distance > thresholds.releaseThreshold;
    const cooldownElapsed = timestamp - state.lastTriggerTime > thresholds.cooldownMs;

    if (isPinching) state.sustainedFrames++;
    else state.sustainedFrames = 0;

    const isSustainedPinch = state.sustainedFrames >= REQUIRED_SUSTAINED_FRAMES;

    let phase: EmittedPhase;

    if (!wasActive && isSustainedPinch && cooldownElapsed) {
      phase = 'started';
      state.isActive = true;
      state.lastTriggerTime = timestamp;
      state.holdStartTime = timestamp;
    } else if (wasActive && isPinching) {
      phase = 'active';
    } else if (wasActive && isReleased) {
      phase = 'ended';
      state.isActive = false;
      state.sustainedFrames = 0;
    } else if (!wasActive && !isSustainedPinch) {
      return null;
    } else if (wasActive) {
      // Inside the hysteresis band: past `threshold` but not yet past `releaseThreshold`.
      // Hold the gesture rather than dropping it — this is the anti-chatter case.
      phase = 'active';
    } else {
      // Pinching and sustained, but still inside the cooldown. Stay silent.
      return null;
    }

    const midX = (thumbTip.x + fingerTip.x) / 2;
    const midY = (thumbTip.y + fingerTip.y) / 2;
    const midZ = (thumbTip.z + fingerTip.z) / 2;

    const strength = Math.max(0, Math.min(1, 1 - distance / thresholds.releaseThreshold));

    return {
      kind,
      phase,
      hand: handedness,
      normalized: { x: midX, y: midY, z: midZ },
      position: toWorld(midX, midY, midZ),
      distance,
      strength,
      holdDuration: wasActive ? timestamp - state.holdStartTime : 0,
      timestamp,
    };
  }

  /**
   * Fist — all four non-thumb fingertips curled toward the wrist.
   *
   * Distances are measured as a ratio against the wrist-to-middle-MCP palm scale, so the test is
   * invariant to how far the hand is from the camera. A hand at arm's length and a hand filling
   * the frame produce the same ratio.
   */
  private detectFist(
    hand: HandLandmarks,
    handedness: Handedness,
    timestamp: number,
  ): FistEvent | null {
    const wrist = at(hand, HandLandmarkIndex.WRIST);
    const middleMCP = at(hand, HandLandmarkIndex.MIDDLE_FINGER_MCP);
    if (!wrist || !middleMCP) return null;

    const palmScale = distance3D(wrist, middleMCP);
    if (palmScale < MIN_PALM_SCALE) return null;

    let allFingersClosed = true;
    let anyFingerOpen = false;

    for (const tipIndex of FIST_TIPS) {
      const tip = at(hand, tipIndex);
      if (!tip) return null;
      const ratio = distance3D(tip, wrist) / palmScale;
      if (ratio > this.config.fist.closeThreshold) allFingersClosed = false;
      if (ratio > this.config.fist.openThreshold) anyFingerOpen = true;
    }

    const state = this.fistState[handKey(handedness)];
    const wasActive = state.isActive;

    let phase: EmittedPhase;

    if (!wasActive && allFingersClosed) {
      state.sustainedFrames++;
      if (state.sustainedFrames < this.config.fist.minDurationFrames) return null;
      phase = 'started';
      state.isActive = true;
      state.holdStartTime = timestamp;
    } else if (wasActive && !anyFingerOpen) {
      // Still closed, including anywhere inside the hysteresis band.
      phase = 'active';
      state.sustainedFrames++;
    } else if (wasActive && anyFingerOpen) {
      phase = 'ended';
      state.isActive = false;
      state.sustainedFrames = 0;
    } else {
      state.sustainedFrames = 0;
      return null;
    }

    // Middle MCP, not a fingertip centroid: knuckles barely move as the fingers curl, so it is
    // by far the most stable point to call "where the fist is".
    const center = middleMCP;

    return {
      kind: 'fist',
      phase,
      hand: handedness,
      normalized: { x: center.x, y: center.y, z: center.z },
      position: toWorld(center.x, center.y, center.z),
      holdDuration: wasActive ? timestamp - state.holdStartTime : 0,
      timestamp,
    };
  }

  /** Clear all lifecycle state. Call when tracking is interrupted. */
  reset(): void {
    const newPinch = (): PinchState => ({
      isActive: false,
      lastTriggerTime: 0,
      sustainedFrames: 0,
      holdStartTime: 0,
    });
    const newPinchPair = (): Record<HandKey, PinchState> => ({
      left: newPinch(),
      right: newPinch(),
    });
    this.pinchState = {
      pinch: newPinchPair(),
      middlePinch: newPinchPair(),
      ringPinch: newPinchPair(),
      pinkyPinch: newPinchPair(),
    };
    this.fistState = {
      left: { isActive: false, sustainedFrames: 0, holdStartTime: 0 },
      right: { isActive: false, sustainedFrames: 0, holdStartTime: 0 },
    };
  }

  getConfig(): Readonly<GestureConfig> {
    return this.config;
  }

  updateConfig(overrides: GestureConfigOverrides): void {
    this.config = {
      pinch: { ...this.config.pinch, ...overrides.pinch },
      middlePinch: { ...this.config.middlePinch, ...overrides.middlePinch },
      ringPinch: { ...this.config.ringPinch, ...overrides.ringPinch },
      pinkyPinch: { ...this.config.pinkyPinch, ...overrides.pinkyPinch },
      fist: { ...this.config.fist, ...overrides.fist },
    };
  }

  /** Whether a given pinch is currently held on a given hand. */
  isPinchActive(kind: PinchKind, handedness: Handedness): boolean {
    return this.pinchState[kind][handKey(handedness)].isActive;
  }

  /** Whether a fist is currently held on a given hand. */
  isFistActive(handedness: Handedness): boolean {
    return this.fistState[handKey(handedness)].isActive;
  }
}

/**
 * Normalized image space to Three.js world units, ported from upstream: X mirrored for the
 * selfie view, Y flipped because screen Y grows downward, Z negated, all scaled by 10.
 */
function toWorld(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(
    -(x - 0.5) * WORLD_SCALE,
    -(y - 0.5) * WORLD_SCALE,
    -z * WORLD_SCALE,
  );
}
