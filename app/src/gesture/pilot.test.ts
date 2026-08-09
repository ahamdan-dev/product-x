/**
 * GesturePilot tests.
 *
 * Everything here runs on synthetic landmark frames — no camera, no MediaPipe, no WASM. The
 * pilot takes its hands from an injected `HandSource`, so a test can hand it any pose sequence
 * it likes and assert on the resulting intents deterministically.
 *
 * `synthHand` builds a 21-landmark hand whose geometry is exact by construction: every
 * fingertip sits at precisely `extension * palmScale` from the wrist, and the palm centroid sits
 * precisely at `at`. That means thresholds can be tested at their exact boundaries rather than
 * approximately.
 */

import { describe, it, expect } from 'vitest';
import {
  GesturePilot,
  DEFAULT_PILOT_CONFIG,
  type HandSource,
  type PilotFrame,
  type PilotIntent,
  type Point2,
} from './pilot';
import { GestureDetector } from './gestureDetector';
import { classifyCameraError } from './handTracker';
import { HandLandmarkIndex, LANDMARK_COUNT, type Handedness, type HandLandmarks } from './handTypes';
import type { TrackedHands } from './handTracker';

// ---------------------------------------------------------------------------
// Synthetic hand construction
// ---------------------------------------------------------------------------

/** Fingertip-to-wrist over palm-scale ratio for a flat open hand. Above the fist open band. */
const OPEN = 2.1;
/** Same ratio for a closed fist. Below the fist close threshold of 1.2. */
const FIST = 1.05;
/** Thumb-to-index separation that is unambiguously not a pinch (release threshold is 0.06). */
const NO_PINCH = 0.15;
/** Thumb-to-index separation that is unambiguously a pinch (trigger threshold is 0.035). */
const PINCHED = 0.02;

interface SynthOptions {
  /** Palm centroid in RAW (un-mirrored) normalized space. Exact, not approximate. */
  at?: Point2;
  /** Wrist-to-middle-MCP distance. The scale reference all ratios are measured against. */
  palmScale?: number;
  /** Fingertip-to-wrist distance as a multiple of palmScale. `OPEN` or `FIST`. */
  extension?: number;
  /** 3D distance between thumb tip and index tip. */
  pinch?: number;
  /** Uniform depth offset for the whole hand. Applied to every landmark, so ratios hold. */
  z?: number;
  /** Absolute override for the index fingertip, for driving pointer motion directly. */
  indexTip?: Point2;
}

/** Direction each fingertip extends from the wrist. Normalized inside `synthHand`. */
const TIP_DIRECTIONS: Record<number, [number, number]> = {
  [HandLandmarkIndex.INDEX_FINGER_TIP]: [0.25, -1],
  [HandLandmarkIndex.MIDDLE_FINGER_TIP]: [0, -1],
  [HandLandmarkIndex.RING_FINGER_TIP]: [-0.2, -1],
  [HandLandmarkIndex.PINKY_TIP]: [-0.4, -1],
};

const PALM_INDICES = [
  HandLandmarkIndex.WRIST,
  HandLandmarkIndex.INDEX_FINGER_MCP,
  HandLandmarkIndex.MIDDLE_FINGER_MCP,
  HandLandmarkIndex.RING_FINGER_MCP,
  HandLandmarkIndex.PINKY_MCP,
];

function synthHand(opts: SynthOptions = {}): HandLandmarks {
  const at = opts.at ?? { x: 0.5, y: 0.5 };
  const s = opts.palmScale ?? 0.12;
  const extension = opts.extension ?? OPEN;
  const pinch = opts.pinch ?? NO_PINCH;
  const z = opts.z ?? 0;

  const points: { x: number; y: number; z: number }[] = Array.from(
    { length: LANDMARK_COUNT },
    () => ({ x: 0, y: 0, z: 0 }),
  );

  const set = (index: number, x: number, y: number): void => {
    points[index] = { x, y, z: 0 };
  };

  // Wrist below the palm center, knuckles above it. Normalized Y grows downward.
  const wristX = 0;
  const wristY = 0.5 * s;
  set(HandLandmarkIndex.WRIST, wristX, wristY);
  set(HandLandmarkIndex.INDEX_FINGER_MCP, 0.25 * s, -0.45 * s);
  set(HandLandmarkIndex.MIDDLE_FINGER_MCP, 0, -0.5 * s); // exactly palmScale from the wrist
  set(HandLandmarkIndex.RING_FINGER_MCP, -0.25 * s, -0.45 * s);
  set(HandLandmarkIndex.PINKY_MCP, -0.45 * s, -0.35 * s);

  // Intermediate joints, evenly spaced toward each tip. Nothing reads them, but a 21-point hand
  // with zeros in the middle would be a misleading fixture.
  const jointChains: [number, number, number, number][] = [
    [
      HandLandmarkIndex.THUMB_CMC,
      HandLandmarkIndex.THUMB_MCP,
      HandLandmarkIndex.THUMB_IP,
      HandLandmarkIndex.THUMB_TIP,
    ],
    [
      HandLandmarkIndex.INDEX_FINGER_MCP,
      HandLandmarkIndex.INDEX_FINGER_PIP,
      HandLandmarkIndex.INDEX_FINGER_DIP,
      HandLandmarkIndex.INDEX_FINGER_TIP,
    ],
    [
      HandLandmarkIndex.MIDDLE_FINGER_MCP,
      HandLandmarkIndex.MIDDLE_FINGER_PIP,
      HandLandmarkIndex.MIDDLE_FINGER_DIP,
      HandLandmarkIndex.MIDDLE_FINGER_TIP,
    ],
    [
      HandLandmarkIndex.RING_FINGER_MCP,
      HandLandmarkIndex.RING_FINGER_PIP,
      HandLandmarkIndex.RING_FINGER_DIP,
      HandLandmarkIndex.RING_FINGER_TIP,
    ],
    [
      HandLandmarkIndex.PINKY_MCP,
      HandLandmarkIndex.PINKY_PIP,
      HandLandmarkIndex.PINKY_DIP,
      HandLandmarkIndex.PINKY_TIP,
    ],
  ];

  // Fingertips: exactly `extension * s` from the wrist along their direction.
  for (const [tipIndex, dir] of Object.entries(TIP_DIRECTIONS)) {
    const index = Number(tipIndex);
    const len = Math.hypot(dir[0], dir[1]);
    set(
      index,
      wristX + (dir[0] / len) * extension * s,
      wristY + (dir[1] / len) * extension * s,
    );
  }

  // Thumb tip placed a fixed distance from the index tip, purely along X, so the thumb-to-index
  // 3D distance equals `pinch` exactly.
  const indexTipLocal = points[HandLandmarkIndex.INDEX_FINGER_TIP]!;
  set(HandLandmarkIndex.THUMB_TIP, indexTipLocal.x + pinch, indexTipLocal.y);

  for (const chain of jointChains) {
    const root = points[chain[0]]!;
    const tip = points[chain[3]]!;
    set(chain[1], root.x + (tip.x - root.x) / 3, root.y + (tip.y - root.y) / 3);
    set(chain[2], root.x + ((tip.x - root.x) * 2) / 3, root.y + ((tip.y - root.y) * 2) / 3);
  }
  // THUMB_CMC has no meaningful root above; anchor it near the wrist.
  set(HandLandmarkIndex.THUMB_CMC, wristX + 0.2 * s, wristY - 0.1 * s);

  // Translate so the palm centroid lands exactly on `at`.
  let cx = 0;
  let cy = 0;
  for (const index of PALM_INDICES) {
    const point = points[index]!;
    cx += point.x;
    cy += point.y;
  }
  cx /= PALM_INDICES.length;
  cy /= PALM_INDICES.length;

  const dx = at.x - cx;
  const dy = at.y - cy;

  const hand = points.map((point) => ({ x: point.x + dx, y: point.y + dy, z }));

  if (opts.indexTip) {
    hand[HandLandmarkIndex.INDEX_FINGER_TIP] = { x: opts.indexTip.x, y: opts.indexTip.y, z };
    hand[HandLandmarkIndex.THUMB_TIP] = {
      x: opts.indexTip.x + pinch,
      y: opts.indexTip.y,
      z,
    };
  }

  return hand;
}

/** Palm centroid of a synthetic hand, in raw space. Mirrors what the pilot averages. */
function palmCentroid(hand: HandLandmarks): Point2 {
  let x = 0;
  let y = 0;
  for (const index of PALM_INDICES) {
    const point = hand[index]!;
    x += point.x;
    y += point.y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/** A hand source the test drives frame by frame. */
class ScriptedSource implements HandSource {
  next: TrackedHands = { hands: [], handedness: [], confidence: 0 };

  readHands(): TrackedHands {
    return this.next;
  }

  set(hands: HandLandmarks[], handedness: Handedness[], confidence = 0.95): void {
    // Mirrors the real tracker, which reports zero confidence when it reports no hands.
    this.next = { hands, handedness, confidence: hands.length === 0 ? 0 : confidence };
  }

  clear(): void {
    this.next = { hands: [], handedness: [], confidence: 0 };
  }
}

const FRAME_MS = 16;
const START_MS = 1000;

interface Rig {
  pilot: GesturePilot;
  source: ScriptedSource;
  /** Advance one frame with the given pose and return the resulting frame. */
  step(hands: HandLandmarks[], handedness?: Handedness[]): PilotFrame;
  /** Advance `count` frames holding the same pose. Returns every frame produced. */
  hold(count: number, hands: HandLandmarks[], handedness?: Handedness[]): PilotFrame[];
  now(): number;
}

function makeRig(config?: Partial<ConstructorParameters<typeof GesturePilot>[0]>): Rig {
  const source = new ScriptedSource();
  const pilot = new GesturePilot({ source, ...config });
  let t = START_MS;

  const step = (hands: HandLandmarks[], handedness?: Handedness[]): PilotFrame => {
    source.set(hands, handedness ?? hands.map(() => 'right' as Handedness));
    const frame = pilot.update(t);
    t += FRAME_MS;
    return frame;
  };

  return {
    pilot,
    source,
    step,
    hold: (count, hands, handedness) => {
      const frames: PilotFrame[] = [];
      for (let i = 0; i < count; i++) frames.push(step(hands, handedness));
      return frames;
    },
    now: () => t,
  };
}

function intentsOf(frames: PilotFrame[]): PilotIntent[] {
  return frames.flatMap((frame) => frame.intents);
}

function countKind(frames: PilotFrame[], kind: PilotIntent['kind']): number {
  return intentsOf(frames).filter((intent) => intent.kind === kind).length;
}

function lastOfKind<K extends PilotIntent['kind']>(
  frames: PilotFrame[],
  kind: K,
): Extract<PilotIntent, { kind: K }> | undefined {
  const matches = intentsOf(frames).filter(
    (intent): intent is Extract<PilotIntent, { kind: K }> => intent.kind === kind,
  );
  return matches[matches.length - 1];
}

/** Deterministic PRNG, so the jitter test asserts on a fixed noise sequence. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

/** Two hands, positioned by where their palms should appear in MIRRORED (user-visible) space. */
function twoHandsAtScreen(
  leftAt: Point2,
  rightAt: Point2,
  pinch: number,
): { hands: HandLandmarks[]; handedness: Handedness[] } {
  return {
    hands: [
      synthHand({ at: { x: 1 - leftAt.x, y: leftAt.y }, pinch }),
      synthHand({ at: { x: 1 - rightAt.x, y: rightAt.y }, pinch }),
    ],
    handedness: ['left', 'right'],
  };
}

// ---------------------------------------------------------------------------
// Fixture sanity — if these drift, every threshold test below is meaningless
// ---------------------------------------------------------------------------

describe('synthHand fixture', () => {
  it('produces 21 landmarks', () => {
    expect(synthHand()).toHaveLength(LANDMARK_COUNT);
  });

  it('places the palm centroid exactly at the requested point', () => {
    const centroid = palmCentroid(synthHand({ at: { x: 0.31, y: 0.72 } }));
    expect(centroid.x).toBeCloseTo(0.31, 12);
    expect(centroid.y).toBeCloseTo(0.72, 12);
  });

  it('puts fingertips at exactly extension * palmScale from the wrist', () => {
    const s = 0.12;
    const hand = synthHand({ palmScale: s, extension: OPEN });
    const wrist = hand[HandLandmarkIndex.WRIST]!;
    for (const tipIndex of Object.keys(TIP_DIRECTIONS).map(Number)) {
      const tip = hand[tipIndex]!;
      expect(Math.hypot(tip.x - wrist.x, tip.y - wrist.y)).toBeCloseTo(OPEN * s, 12);
    }
  });

  it('separates thumb and index tips by exactly the requested pinch distance', () => {
    const hand = synthHand({ pinch: 0.031 });
    const thumb = hand[HandLandmarkIndex.THUMB_TIP]!;
    const index = hand[HandLandmarkIndex.INDEX_FINGER_TIP]!;
    expect(Math.hypot(thumb.x - index.x, thumb.y - index.y)).toBeCloseTo(0.031, 12);
  });
});

// ---------------------------------------------------------------------------
// Mirroring
// ---------------------------------------------------------------------------

describe('x mirroring', () => {
  it('mirrors the palm and pointer x on the first frame, and leaves y alone', () => {
    const rig = makeRig();
    const raw = { x: 0.3, y: 0.65 };
    const hand = synthHand({ at: raw });

    // The One Euro filter passes the first sample through untouched, so frame one is exact.
    const frame = rig.step([hand]);
    const tracked = frame.hands[0]!;

    expect(tracked.at.x).toBeCloseTo(1 - raw.x, 12);
    expect(tracked.at.y).toBeCloseTo(raw.y, 12);

    const rawIndexTip = hand[HandLandmarkIndex.INDEX_FINGER_TIP]!;
    expect(tracked.pointer.x).toBeCloseTo(1 - rawIndexTip.x, 12);
    expect(tracked.pointer.y).toBeCloseTo(rawIndexTip.y, 12);
  });

  it('moves the cursor left when the raw hand moves right', () => {
    const rig = makeRig();
    const first = rig.step([synthHand({ at: { x: 0.3, y: 0.5 } })]);
    const frames = rig.hold(40, [synthHand({ at: { x: 0.7, y: 0.5 } })]);
    const last = frames[frames.length - 1]!;

    expect(last.hands[0]!.at.x).toBeLessThan(first.hands[0]!.at.x);
  });

  it('reports pick positions in mirrored space too', () => {
    const rig = makeRig();
    rig.step([synthHand({ at: { x: 0.25, y: 0.5 }, pinch: NO_PINCH })]);
    const frames = rig.hold(3, [synthHand({ at: { x: 0.25, y: 0.5 }, pinch: PINCHED })]);

    const pick = lastOfKind(frames, 'pick');
    expect(pick).toBeDefined();
    // Raw palm is at x=0.25, so anything mirrored must land on the far side of center.
    expect(pick!.at.x).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// pick — cooldown and single-fire
// ---------------------------------------------------------------------------

describe('pick', () => {
  const open = () => synthHand({ pinch: NO_PINCH });
  const pinched = () => synthHand({ pinch: PINCHED });

  it('emits exactly one pick for one pinch, not one per frame', () => {
    const rig = makeRig();
    const frames = [
      ...rig.hold(3, [open()]),
      ...rig.hold(20, [pinched()]), // held closed for 320ms
      ...rig.hold(5, [open()]),
    ];

    expect(countKind(frames, 'pick')).toBe(1);
  });

  it('does not emit a second pick inside the cooldown window', () => {
    const rig = makeRig();
    // Pinch, release, pinch again. The whole sequence spans 10 frames = 160ms, well inside the
    // 400ms pinch cooldown, so the second squeeze must be swallowed.
    const frames = [
      ...rig.hold(1, [open()]),
      ...rig.hold(3, [pinched()]),
      ...rig.hold(3, [open()]),
      ...rig.hold(3, [pinched()]),
    ];

    expect(countKind(frames, 'pick')).toBe(1);
  });

  it('emits a second pick once the cooldown has elapsed', () => {
    const rig = makeRig();
    const frames = [
      ...rig.hold(1, [open()]),
      ...rig.hold(3, [pinched()]),
      ...rig.hold(30, [open()]), // 480ms open, clearing the 400ms cooldown
      ...rig.hold(3, [pinched()]),
    ];

    expect(countKind(frames, 'pick')).toBe(2);
  });

  it('suppresses point while a fist is held and pairs grab with release', () => {
    const rig = makeRig();
    const fistFrames = rig.hold(5, [synthHand({ extension: FIST })]);
    const openFrames = rig.hold(3, [synthHand({ extension: OPEN })]);

    // Grab every frame the fist is held, so a consumer can drag off it.
    expect(countKind(fistFrames, 'grab')).toBe(5);
    expect(countKind(fistFrames, 'point')).toBe(0);

    // Exactly one release, on the frame the fist opens.
    expect(countKind(openFrames, 'release')).toBe(1);

    // That release frame carries the release alone; pointing resumes the frame after. Grab,
    // point and release are mutually exclusive within a frame for a given hand.
    expect(openFrames[0]!.intents).toEqual([{ kind: 'release', hand: 'right' }]);
    expect(countKind(openFrames, 'point')).toBe(2);
  });

  it('releases a held grab when the hand leaves the frame', () => {
    const rig = makeRig();
    rig.hold(4, [synthHand({ extension: FIST })]);
    const gone = rig.hold(1, []);

    expect(countKind(gone, 'release')).toBe(1);
  });

  it('reports openness near 0 for a fist and near 1 for a flat hand', () => {
    const fistRig = makeRig();
    const fistFrames = fistRig.hold(20, [synthHand({ extension: FIST })]);
    expect(fistFrames[fistFrames.length - 1]!.hands[0]!.openness).toBeLessThan(0.05);

    const openRig = makeRig();
    const openFrames = openRig.hold(20, [synthHand({ extension: OPEN })]);
    expect(openFrames[openFrames.length - 1]!.hands[0]!.openness).toBeGreaterThan(0.95);
  });
});

// ---------------------------------------------------------------------------
// Hysteresis
// ---------------------------------------------------------------------------

describe('hysteresis', () => {
  const { threshold, releaseThreshold } = new GestureDetector().getConfig().pinch;
  /** Dead center of the band: too far to trigger, too close to release. */
  const MIDBAND = (threshold + releaseThreshold) / 2;

  it('does not chatter when the distance sits inside the hysteresis band', () => {
    expect(MIDBAND).toBeGreaterThan(threshold);
    expect(MIDBAND).toBeLessThan(releaseThreshold);

    const detector = new GestureDetector();
    const phases: string[] = [];
    let t = START_MS;

    const feed = (pinch: number): void => {
      const { events } = detector.detect([synthHand({ pinch })], ['right'], t);
      for (const event of events) {
        if (event.kind === 'pinch') phases.push(event.phase);
      }
      t += FRAME_MS;
    };

    // 40 frames = 640ms parked in the band, longer than the 400ms cooldown, so a dropped
    // gesture would have room to re-trigger and the chatter would show up as extra phases.
    const BAND_FRAMES = 40;

    feed(NO_PINCH);
    feed(PINCHED);
    for (let i = 0; i < BAND_FRAMES; i++) feed(MIDBAND);

    // One clean start, then one active per band frame, never released while inside the band.
    // This is the invariant that keeps a drag alive when a hand drifts at the pinch boundary.
    expect(phases.filter((phase) => phase === 'started')).toHaveLength(1);
    expect(phases.filter((phase) => phase === 'ended')).toHaveLength(0);
    expect(phases.filter((phase) => phase === 'active')).toHaveLength(BAND_FRAMES);
    expect(detector.isPinchActive('pinch', 'right')).toBe(true);
  });

  it('keeps a two-hand latch alive when a pinch drifts into the hysteresis band', () => {
    const rig = makeRig();
    const latch = twoHandsAtScreen({ x: 0.35, y: 0.5 }, { x: 0.65, y: 0.5 }, PINCHED);
    rig.step(latch.hands, latch.handedness);

    // Both hands relax to the middle of the band — still pinching as far as the user is
    // concerned. Without hysteresis the latch would drop and the manipulation would die.
    const drifted = twoHandsAtScreen({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, MIDBAND);
    const frames = rig.hold(30, drifted.hands, drifted.handedness);

    expect(countKind(frames, 'scale')).toBe(30);
    expect(lastOfKind(frames, 'scale')!.factor).toBeGreaterThan(1);
  });

  it('holds a single pinch through 60 frames of oscillation inside the band', () => {
    const detector = new GestureDetector();
    const phases: string[] = [];

    const feed = (pinch: number, t: number): void => {
      const { events } = detector.detect([synthHand({ pinch })], ['right'], t);
      for (const event of events) {
        if (event.kind === 'pinch') phases.push(event.phase);
      }
    };

    let t = START_MS;
    feed(PINCHED, t);
    for (let i = 0; i < 60; i++) {
      t += FRAME_MS;
      // Both values are strictly inside (threshold, releaseThreshold).
      feed(i % 2 === 0 ? threshold + 0.005 : releaseThreshold - 0.005, t);
    }

    expect(phases[0]).toBe('started');
    expect(phases.filter((phase) => phase === 'started')).toHaveLength(1);
    expect(phases.filter((phase) => phase === 'ended')).toHaveLength(0);
  });

  it('ends the pinch once the distance clears the release threshold', () => {
    const detector = new GestureDetector();
    detector.detect([synthHand({ pinch: PINCHED })], ['right'], START_MS);
    expect(detector.isPinchActive('pinch', 'right')).toBe(true);

    const { events } = detector.detect(
      [synthHand({ pinch: releaseThreshold + 0.001 })],
      ['right'],
      START_MS + FRAME_MS,
    );

    expect(events.find((event) => event.kind === 'pinch')?.phase).toBe('ended');
    expect(detector.isPinchActive('pinch', 'right')).toBe(false);
  });

  it('keeps a fist through its own hysteresis band', () => {
    const detector = new GestureDetector();
    const { closeThreshold, openThreshold } = detector.getConfig().fist;
    const midband = (closeThreshold + openThreshold) / 2;

    detector.detect([synthHand({ extension: FIST })], ['right'], START_MS);
    expect(detector.isFistActive('right')).toBe(true);

    for (let i = 1; i <= 30; i++) {
      detector.detect([synthHand({ extension: midband })], ['right'], START_MS + i * FRAME_MS);
    }
    expect(detector.isFistActive('right')).toBe(true);

    detector.detect(
      [synthHand({ extension: openThreshold + 0.05 })],
      ['right'],
      START_MS + 31 * FRAME_MS,
    );
    expect(detector.isFistActive('right')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Two-hand scale and spin
// ---------------------------------------------------------------------------

describe('two-hand scale', () => {
  const START = { left: { x: 0.35, y: 0.5 }, right: { x: 0.65, y: 0.5 } };

  /** Latch the gesture, then hold a target pose long enough for smoothing to converge. */
  function latchThenHold(target: { left: Point2; right: Point2 }, frames = 60): PilotFrame[] {
    const rig = makeRig();
    const start = twoHandsAtScreen(START.left, START.right, PINCHED);
    rig.step(start.hands, start.handedness);

    const held = twoHandsAtScreen(target.left, target.right, PINCHED);
    return rig.hold(frames, held.hands, held.handedness);
  }

  it('reports the identity transform on the latch frame', () => {
    const rig = makeRig();
    const start = twoHandsAtScreen(START.left, START.right, PINCHED);
    const frame = rig.step(start.hands, start.handedness);

    const scale = frame.intents.find((intent) => intent.kind === 'scale');
    const spin = frame.intents.find((intent) => intent.kind === 'spin');
    expect(scale).toEqual({ kind: 'scale', factor: 1 });
    expect(spin).toEqual({ kind: 'spin', deltaRadians: 0 });
  });

  it('produces factor > 1 when the hands spread apart', () => {
    const frames = latchThenHold({ left: { x: 0.2, y: 0.5 }, right: { x: 0.8, y: 0.5 } });
    const scale = lastOfKind(frames, 'scale')!;

    expect(scale.factor).toBeGreaterThan(1);
  });

  it('produces factor < 1 when the hands pull in', () => {
    const frames = latchThenHold({ left: { x: 0.44, y: 0.5 }, right: { x: 0.56, y: 0.5 } });
    const scale = lastOfKind(frames, 'scale')!;

    expect(scale.factor).toBeLessThan(1);
  });

  it('clamps an extreme spread to scaleMax', () => {
    const frames = latchThenHold({ left: { x: 0.05, y: 0.5 }, right: { x: 0.95, y: 0.5 } }, 90);
    const scale = lastOfKind(frames, 'scale')!;

    expect(scale.factor).toBe(DEFAULT_PILOT_CONFIG.scaleMax);
  });

  it('clamps an extreme pull-in to scaleMin', () => {
    const frames = latchThenHold({ left: { x: 0.485, y: 0.5 }, right: { x: 0.515, y: 0.5 } }, 90);
    const scale = lastOfKind(frames, 'scale')!;

    expect(scale.factor).toBe(DEFAULT_PILOT_CONFIG.scaleMin);
  });

  it('honours a configured scale range', () => {
    const source = new ScriptedSource();
    const pilot = new GesturePilot({ source, config: { scaleMin: 0.9, scaleMax: 1.1 } });
    let t = START_MS;
    const feed = (pose: ReturnType<typeof twoHandsAtScreen>): PilotFrame => {
      source.set(pose.hands, pose.handedness);
      const frame = pilot.update(t);
      t += FRAME_MS;
      return frame;
    };

    feed(twoHandsAtScreen(START.left, START.right, PINCHED));
    let frame: PilotFrame | undefined;
    for (let i = 0; i < 90; i++) {
      frame = feed(twoHandsAtScreen({ x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 }, PINCHED));
    }

    const scale = frame!.intents.find((intent) => intent.kind === 'scale');
    expect(scale).toEqual({ kind: 'scale', factor: 1.1 });
  });

  it('does not fire from two hands merely being visible', () => {
    const rig = makeRig();
    const pose = twoHandsAtScreen(START.left, START.right, NO_PINCH);
    const frames = rig.hold(30, pose.hands, pose.handedness);

    expect(countKind(frames, 'scale')).toBe(0);
    expect(countKind(frames, 'spin')).toBe(0);
    expect(countKind(frames, 'point')).toBe(60); // one per hand per frame
  });

  it('releases the latch when either hand opens, and re-latches from the new separation', () => {
    const rig = makeRig();
    const latch = twoHandsAtScreen(START.left, START.right, PINCHED);
    rig.step(latch.hands, latch.handedness);

    const spread = twoHandsAtScreen({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, PINCHED);
    const spreadFrames = rig.hold(60, spread.hands, spread.handedness);
    expect(lastOfKind(spreadFrames, 'scale')!.factor).toBeGreaterThan(1);

    // Open one hand: the manipulation must stop dead.
    const oneOpen: HandLandmarks[] = [
      synthHand({ at: { x: 1 - 0.2, y: 0.5 }, pinch: NO_PINCH }),
      synthHand({ at: { x: 1 - 0.8, y: 0.5 }, pinch: PINCHED }),
    ];
    const releasedFrames = rig.hold(5, oneOpen, ['left', 'right']);
    expect(countKind(releasedFrames, 'scale')).toBe(0);

    // Pinching again re-latches at the current wide separation, so factor restarts near 1.
    const reFrames = rig.hold(30, spread.hands, spread.handedness);
    expect(reFrames[0]!.intents).toContainEqual({ kind: 'scale', factor: 1 });
    expect(lastOfKind(reFrames, 'scale')!.factor).toBeLessThan(1.2);
  });
});

describe('two-hand spin', () => {
  const LEFT = { x: 0.35, y: 0.5 };
  const RIGHT = { x: 0.65, y: 0.5 };
  /** Half the separation of the two palms, used to convert an angle into hand offsets. */
  const SPAN = RIGHT.x - LEFT.x;

  /**
   * Rotate the left→right palm vector by `phi` in the user's frame. Positive `phi` is
   * counter-clockwise on screen, which — because normalized Y grows downward — means the right
   * hand's y decreases.
   */
  function rotatedPose(phi: number): ReturnType<typeof twoHandsAtScreen> {
    const dy = (SPAN * Math.sin(phi)) / 2;
    return twoHandsAtScreen(
      { x: LEFT.x, y: 0.5 + dy },
      { x: RIGHT.x, y: 0.5 - dy },
      PINCHED,
    );
  }

  function spinAfter(phi: number, frames = 90): number {
    const rig = makeRig();
    const flat = rotatedPose(0);
    rig.step(flat.hands, flat.handedness);
    const pose = rotatedPose(phi);
    const held = rig.hold(frames, pose.hands, pose.handedness);
    return lastOfKind(held, 'spin')!.deltaRadians;
  }

  it('is positive for a counter-clockwise twist', () => {
    expect(spinAfter(0.5)).toBeGreaterThan(0.05);
  });

  it('is negative for a clockwise twist', () => {
    expect(spinAfter(-0.5)).toBeLessThan(-0.05);
  });

  it('has opposite signs and matching magnitude for mirrored twists', () => {
    const ccw = spinAfter(0.5);
    const cw = spinAfter(-0.5);

    expect(Math.sign(ccw)).toBe(1);
    expect(Math.sign(cw)).toBe(-1);
    expect(Math.abs(ccw)).toBeCloseTo(Math.abs(cw), 6);
  });

  it('tracks roughly the angle actually turned', () => {
    // The vector between palms rotates by `phi` in the geometry above, and spin accumulates the
    // signed delta, so the result should land near phi once smoothing settles.
    const spin = spinAfter(0.5, 120);
    expect(spin).toBeGreaterThan(0.3);
    expect(spin).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// slice
// ---------------------------------------------------------------------------

describe('slice', () => {
  /** Drag the index tip across the frame at a fixed step per 16ms frame. */
  function drag(stepPerFrame: number, frames: number): PilotFrame[] {
    const rig = makeRig();
    const out: PilotFrame[] = [];
    for (let i = 0; i < frames; i++) {
      const x = 0.2 + stepPerFrame * i;
      out.push(rig.step([synthHand({ at: { x: 0.5, y: 0.5 }, indexTip: { x, y: 0.4 } })]));
    }
    return out;
  }

  it('never fires for a slow drag', () => {
    // 0.004 units per 16ms frame = 0.25 units/s, far under the 1.5 units/s gate.
    const frames = drag(0.004, 40);
    expect(countKind(frames, 'slice')).toBe(0);
  });

  it('fires for a fast swipe', () => {
    // 0.05 units per 16ms frame = ~3.1 units/s.
    const frames = drag(0.05, 15);
    expect(countKind(frames, 'slice')).toBeGreaterThanOrEqual(1);
  });

  it('reports a from/to pair spanning the swipe direction', () => {
    const frames = drag(0.05, 15);
    const slice = lastOfKind(frames, 'slice')!;

    // Raw x increases, so mirrored x decreases.
    expect(slice.to.x).toBeLessThan(slice.from.x);
    expect(Math.hypot(slice.to.x - slice.from.x, slice.to.y - slice.from.y)).toBeGreaterThan(0);
  });

  it('requires the speed to be sustained, not a single fast frame', () => {
    const rig = makeRig();
    const frames: PilotFrame[] = [];
    let x = 0.2;
    for (let i = 0; i < 30; i++) {
      // One big jump every fourth frame, otherwise still. Never 3 fast frames in a row.
      if (i % 4 === 0) x += 0.06;
      frames.push(rig.step([synthHand({ at: { x: 0.5, y: 0.5 }, indexTip: { x, y: 0.4 } })]));
    }

    expect(countKind(frames, 'slice')).toBe(0);
  });

  it('fires once per swipe rather than once per fast frame', () => {
    const frames = drag(0.05, 15);
    expect(countKind(frames, 'slice')).toBe(1);
  });

  it('respects a configured speed threshold', () => {
    const source = new ScriptedSource();
    // Raise the gate far above the motion below; nothing should qualify.
    const pilot = new GesturePilot({ source, config: { sliceSpeed: 50 } });
    let t = START_MS;
    let sliceCount = 0;
    for (let i = 0; i < 20; i++) {
      source.set([synthHand({ indexTip: { x: 0.2 + 0.05 * i, y: 0.4 } })], ['right']);
      const frame = pilot.update(t);
      t += FRAME_MS;
      sliceCount += frame.intents.filter((intent) => intent.kind === 'slice').length;
    }

    expect(sliceCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dwell
// ---------------------------------------------------------------------------

describe('dwellProgress', () => {
  const HOLD_MS = DEFAULT_PILOT_CONFIG.dwellHoldMs;
  const RADIUS = 0.05;

  /** Step the pilot, then sample dwell against a fixed target. */
  function dwellRun(): { rig: Rig; target: Point2 } {
    const rig = makeRig();
    const frame = rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);
    // Aim at wherever the cursor actually is, in mirrored space.
    return { rig, target: { ...frame.hands[0]!.pointer } };
  }

  it('reaches 1.0 only after the configured hold time', () => {
    const { rig, target } = dwellRun();
    const dt = 100;
    const steps = Math.ceil(HOLD_MS / dt);
    let progress = 0;

    for (let i = 0; i < steps - 1; i++) {
      rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);
      progress = rig.pilot.dwellProgress('confirm', target, RADIUS, dt);
      expect(progress).toBeLessThan(1);
    }

    rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);
    progress = rig.pilot.dwellProgress('confirm', target, RADIUS, dt);
    expect(progress).toBe(1);
  });

  it('grows monotonically while the cursor stays inside the radius', () => {
    const { rig, target } = dwellRun();
    let previous = 0;
    for (let i = 0; i < 5; i++) {
      rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);
      const progress = rig.pilot.dwellProgress('confirm', target, RADIUS, 100);
      expect(progress).toBeGreaterThan(previous);
      previous = progress;
    }
  });

  it('resets to 0 as soon as the cursor leaves the radius', () => {
    const { rig, target } = dwellRun();
    for (let i = 0; i < 4; i++) {
      rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);
      rig.pilot.dwellProgress('confirm', target, RADIUS, 100);
    }
    expect(rig.pilot.dwellProgress('confirm', target, RADIUS, 0)).toBeGreaterThan(0);

    // Move the hand far away and let smoothing carry the cursor out of the target.
    rig.hold(40, [synthHand({ at: { x: 0.05, y: 0.95 } })]);
    expect(rig.pilot.dwellProgress('confirm', target, RADIUS, 100)).toBe(0);
  });

  it('starts over from 0 after leaving and returning', () => {
    const { rig, target } = dwellRun();
    for (let i = 0; i < 6; i++) {
      rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);
      rig.pilot.dwellProgress('confirm', target, RADIUS, 100);
    }
    const before = rig.pilot.dwellProgress('confirm', target, RADIUS, 0);

    rig.hold(40, [synthHand({ at: { x: 0.05, y: 0.95 } })]);
    expect(rig.pilot.dwellProgress('confirm', target, RADIUS, 100)).toBe(0);

    rig.hold(40, [synthHand({ at: { x: 0.5, y: 0.5 } })]);
    const after = rig.pilot.dwellProgress('confirm', target, RADIUS, 100);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it('returns 0 when no hand is tracked', () => {
    const rig = makeRig();
    rig.step([]);
    expect(rig.pilot.dwellProgress('confirm', { x: 0.5, y: 0.5 }, RADIUS, 100)).toBe(0);
  });

  it('tracks each target id independently', () => {
    const { rig, target } = dwellRun();
    for (let i = 0; i < 4; i++) {
      rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);
      rig.pilot.dwellProgress('a', target, RADIUS, 100);
    }
    rig.step([synthHand({ at: { x: 0.5, y: 0.5 } })]);

    const a = rig.pilot.dwellProgress('a', target, RADIUS, 100);
    const b = rig.pilot.dwellProgress('b', target, RADIUS, 100);
    expect(a).toBeGreaterThan(b);
  });
});

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

describe('smoothing', () => {
  it('materially reduces jitter on a noisy static hand', () => {
    const rig = makeRig();
    const rand = mulberry32(20260809);
    const NOISE = 0.006; // roughly what MediaPipe produces on a hand held still

    const rawX: number[] = [];
    const smoothedX: number[] = [];

    for (let i = 0; i < 240; i++) {
      const jitterX = (rand() - 0.5) * 2 * NOISE;
      const jitterY = (rand() - 0.5) * 2 * NOISE;
      const hand = synthHand({ at: { x: 0.5 + jitterX, y: 0.5 + jitterY } });
      const frame = rig.step([hand]);

      // Skip the warm-up, where the filter is still passing input through.
      if (i < 30) continue;
      rawX.push(1 - palmCentroid(hand).x); // same mirrored space as the output
      smoothedX.push(frame.hands[0]!.at.x);
    }

    const rawVar = variance(rawX);
    const smoothVar = variance(smoothedX);

    expect(rawVar).toBeGreaterThan(0);
    // An adaptive low-pass at these settings should remove the great majority of the variance.
    expect(smoothVar).toBeLessThan(rawVar * 0.25);
  });

  it('still converges on a moved hand rather than lagging forever', () => {
    const rig = makeRig();
    rig.step([synthHand({ at: { x: 0.3, y: 0.5 } })]);
    const frames = rig.hold(120, [synthHand({ at: { x: 0.7, y: 0.5 } })]);
    const last = frames[frames.length - 1]!;

    expect(last.hands[0]!.at.x).toBeCloseTo(1 - 0.7, 3);
  });

  it('does not drag the cursor across the screen after the hand is lost and reappears', () => {
    const rig = makeRig();
    rig.hold(30, [synthHand({ at: { x: 0.2, y: 0.2 } })]);

    // Gone for longer than handLostMs, so the filters are discarded, not resumed.
    const missingFrames = Math.ceil(DEFAULT_PILOT_CONFIG.handLostMs / FRAME_MS) + 4;
    rig.hold(missingFrames, []);

    const frame = rig.step([synthHand({ at: { x: 0.8, y: 0.8 } })]);
    // Re-acquired at full fidelity on the first frame, not smoothed in from the old position.
    expect(frame.hands[0]!.at.x).toBeCloseTo(1 - 0.8, 9);
    expect(frame.hands[0]!.at.y).toBeCloseTo(0.8, 9);
  });

  it('produces a normalized, valid palm quaternion', () => {
    const rig = makeRig();
    const frame = rig.step([synthHand()]);
    const q = frame.hands[0]!.quaternion;

    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
  });
});

// ---------------------------------------------------------------------------
// Frame shape and passthrough
// ---------------------------------------------------------------------------

describe('PilotFrame', () => {
  it('emits a lone idle intent when nothing is tracked', () => {
    const rig = makeRig();
    const frame = rig.step([]);

    expect(frame.intents).toEqual([{ kind: 'idle' }]);
    expect(frame.hands).toEqual([]);
    expect(frame.confidence).toBe(0);
  });

  it('never pairs idle with another intent', () => {
    const rig = makeRig();
    const frames = [
      ...rig.hold(3, [synthHand()]),
      ...rig.hold(3, []),
      ...rig.hold(3, [synthHand({ extension: FIST })]),
    ];

    for (const frame of frames) {
      if (frame.intents.some((intent) => intent.kind === 'idle')) {
        expect(frame.intents).toHaveLength(1);
      }
    }
  });

  it('passes the tracker confidence through', () => {
    const source = new ScriptedSource();
    const pilot = new GesturePilot({ source });
    source.set([synthHand()], ['right'], 0.42);

    expect(pilot.update(START_MS).confidence).toBeCloseTo(0.42, 9);
  });

  it('attributes hands and intents to the correct handedness', () => {
    const rig = makeRig();
    const pose = twoHandsAtScreen({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, NO_PINCH);
    const frame = rig.step(pose.hands, pose.handedness);

    expect(frame.hands.map((hand) => hand.hand)).toEqual(['left', 'right']);
    const points = frame.intents.filter((intent) => intent.kind === 'point');
    expect(points.map((intent) => intent.hand).sort()).toEqual(['left', 'right']);
  });

  it('clears all state on reset()', () => {
    const rig = makeRig();
    rig.hold(10, [synthHand({ extension: FIST })]);
    rig.pilot.reset();

    // A fist that was already held must re-announce itself as a fresh grab, and the first frame
    // after a reset is unsmoothed because the filters are new.
    const frame = rig.step([synthHand({ at: { x: 0.4, y: 0.6 }, extension: FIST })]);
    expect(frame.hands[0]!.at.x).toBeCloseTo(1 - 0.4, 9);
    expect(frame.intents.some((intent) => intent.kind === 'grab')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Camera failure classification
// ---------------------------------------------------------------------------

describe('classifyCameraError', () => {
  const cases: [string, string][] = [
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['DevicesNotFoundError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['TrackStartError', 'in-use'],
    ['OverconstrainedError', 'unsupported'],
    ['ConstraintNotSatisfiedError', 'unsupported'],
  ];

  for (const [name, expected] of cases) {
    it(`maps ${name} to ${expected}`, () => {
      const error = new Error('camera');
      error.name = name;
      expect(classifyCameraError(error)).toBe(expected);
    });
  }

  it('falls back to unknown for anything unrecognized', () => {
    expect(classifyCameraError(new Error('boom'))).toBe('unknown');
    expect(classifyCameraError('a string')).toBe('unknown');
    expect(classifyCameraError(null)).toBe('unknown');
  });
});
