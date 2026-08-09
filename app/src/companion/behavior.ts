/**
 * Companion behavior engine.
 *
 * The blueprint's hardest companion rule is §30: "The companion should never move without meaning."
 * The research report's hardest rule is the anti-Tamagotchi clause: it is not hungry, it does not
 * demand attention, and the student must never have to swat it away mid-question.
 *
 * Those two rules together mean animation cannot be driven by a timer. It is driven by *events*,
 * arbitrated by priority, and gated by cooldowns so the same reaction can't fire twice in a row.
 *
 * Design decisions that make the timing feel natural rather than mechanical:
 *
 *  1. REACTION LATENCY. Nothing fires on the same tick as its trigger. Every behavior carries a
 *     `delay` — a beat of "noticing" before "reacting". Instant reactions read as scripted; 180-520ms
 *     of lag reads as attention. This is the single biggest difference between alive and robotic.
 *
 *  2. INTERRUPT CLASSES. A behavior declares what can cut it off. Idle is interruptible by anything.
 *     A rare celebration is interruptible only by the user actually doing something — it will never
 *     be stomped by an ambient tick.
 *
 *  3. COOLDOWNS + REFRACTORY PERIODS. `celebrate.rare` has a 6-hour cooldown, so the world's biggest
 *     reaction stays rare (blueprint §35.5: "use rarely"). Idle variety has a short cooldown so the
 *     companion doesn't loop the same look-around twice.
 *
 *  4. FOCUS SUPPRESSION. During Focus mode the engine drops every behavior whose `focusSafe` flag is
 *     false, and scales idle variety probability to near zero. The companion goes quiet without
 *     going dead — it keeps breathing.
 *
 *  5. SETTLE-BEFORE-IDLE. After any one-shot the companion returns to idle through a cross-fade, not
 *     a cut, and holds the final pose briefly first. Snapping back to breathing is the classic tell.
 */

export type ClipName =
  | 'idle.breathe'
  | 'idle.lookAround'
  | 'locomote.stroll'
  | 'locomote.walk'
  | 'locomote.jog'
  | 'locomote.run'
  | 'study.walkReading'
  | 'study.explain'
  | 'celebrate.small'
  | 'celebrate.milestone'
  | 'celebrate.rare';

/** Companion modes, from the research report's 5-mode spec. */
export type CompanionMode = 'focus' | 'ask' | 'stuck' | 'debrief' | 'together';

/** What can interrupt a running behavior. */
export type InterruptClass =
  | 'anything'      // ambient idle — yields to everything
  | 'user'          // yields only to a direct user action
  | 'nothing';      // plays to completion (used for milestone reveals)

export type TriggerId =
  // navigation
  | 'card.selected'
  | 'card.closed'
  | 'corner.entered'
  | 'route.accepted'
  // conversation
  | 'companion.speakStart'
  | 'companion.speakEnd'
  | 'user.typing'
  | 'user.voiceStart'
  // evidence + learning
  | 'evidence.received'
  | 'concept.improved'
  | 'concept.stabilized'
  | 'district.developed'
  | 'milestone.major'
  // session
  | 'session.open'
  | 'session.close'
  | 'mode.changed'
  // ambient
  | 'ambient.tick';

export interface Behavior {
  id: string;
  clip: ClipName;
  /** ms of "noticing" before the clip starts. Never 0 for reactive behaviors. */
  delay: number;
  /** Higher wins when two behaviors compete in the same window. */
  priority: number;
  /** false = one-shot, then settle back to the resting clip. */
  loop: boolean;
  interruptibleBy: InterruptClass;
  /** ms before this behavior may fire again. */
  cooldown: number;
  /** May this fire while the user is in Focus mode? */
  focusSafe: boolean;
  /** Playback rate multiplier. Sub-1.0 reads as calmer, weightier. */
  rate?: number;
  /** Cross-fade duration into this clip, ms. */
  fade?: number;
  /** Extra hold on the last pose before settling, ms. One-shots only. */
  settleHold?: number;
}

/** The resting behavior. Always available, never on cooldown. */
export const RESTING: Behavior = {
  id: 'rest',
  clip: 'idle.breathe',
  delay: 0,
  priority: 0,
  loop: true,
  interruptibleBy: 'anything',
  cooldown: 0,
  focusSafe: true,
  rate: 0.85,   // slower than authored — reads as calm, not idling-in-a-game
  fade: 420,
};

/**
 * Trigger -> candidate behaviors. Multiple candidates are allowed; the arbiter picks by priority,
 * then by cooldown availability, then by least-recently-used so repeats feel varied.
 */
export const BEHAVIOR_TABLE: Record<TriggerId, Behavior[]> = {
  // ── Navigation ────────────────────────────────────────────────────────────
  // §14 step 3: "Companion moves toward that card." Distance decides the gait —
  // a nearby card gets a stroll, the far side of the board gets a walk. Running is
  // reserved for urgency, never for ordinary navigation.
  'card.selected': [
    {
      id: 'nav.stroll', clip: 'locomote.stroll', delay: 140, priority: 40, loop: true,
      interruptibleBy: 'user', cooldown: 0, focusSafe: true, rate: 1.0, fade: 260,
    },
  ],
  'card.closed': [
    {
      id: 'nav.settle', clip: 'idle.lookAround', delay: 320, priority: 20, loop: false,
      interruptibleBy: 'anything', cooldown: 9_000, focusSafe: false, rate: 0.9,
      fade: 380, settleHold: 240,
    },
  ],
  'corner.entered': [
    {
      id: 'nav.arrive', clip: 'idle.lookAround', delay: 260, priority: 30, loop: false,
      interruptibleBy: 'user', cooldown: 6_000, focusSafe: false, rate: 0.95,
      fade: 340, settleHold: 300,
    },
  ],
  'route.accepted': [
    // Accepting the day's mission is the one moment a small, purposeful bit of energy is earned.
    {
      id: 'route.go', clip: 'locomote.walk', delay: 220, priority: 55, loop: true,
      interruptibleBy: 'user', cooldown: 0, focusSafe: true, rate: 1.0, fade: 240,
    },
  ],

  // ── Conversation ──────────────────────────────────────────────────────────
  // Only the male rig has study.explain; the resolver falls back to lookAround for female.
  'companion.speakStart': [
    {
      id: 'talk.explain', clip: 'study.explain', delay: 180, priority: 60, loop: true,
      interruptibleBy: 'user', cooldown: 0, focusSafe: true, rate: 0.92, fade: 300,
    },
  ],
  'companion.speakEnd': [
    {
      id: 'talk.done', clip: 'idle.breathe', delay: 240, priority: 25, loop: true,
      interruptibleBy: 'anything', cooldown: 0, focusSafe: true, rate: 0.85, fade: 460,
    },
  ],
  // Barge-in must be immediate — this is the one place delay is 0. Waiting here would feel
  // like the companion is talking over the user.
  'user.typing': [
    {
      id: 'yield.typing', clip: 'idle.breathe', delay: 0, priority: 90, loop: true,
      interruptibleBy: 'anything', cooldown: 0, focusSafe: true, rate: 0.8, fade: 200,
    },
  ],
  'user.voiceStart': [
    {
      id: 'yield.listen', clip: 'idle.breathe', delay: 0, priority: 90, loop: true,
      interruptibleBy: 'anything', cooldown: 0, focusSafe: true, rate: 0.78, fade: 220,
    },
  ],

  // ── Evidence & learning ───────────────────────────────────────────────────
  // Deliberately silent. Evidence arriving is not an achievement (report: "Do not gamify
  // activity. Visualize evidence."), so it produces no companion reaction at all.
  'evidence.received': [],

  'concept.improved': [
    {
      id: 'react.nod', clip: 'idle.lookAround', delay: 400, priority: 45, loop: false,
      interruptibleBy: 'user', cooldown: 25_000, focusSafe: false, rate: 1.0,
      fade: 300, settleHold: 200,
    },
  ],
  'concept.stabilized': [
    {
      id: 'react.small', clip: 'celebrate.small', delay: 380, priority: 65, loop: false,
      interruptibleBy: 'user', cooldown: 180_000, focusSafe: false, rate: 0.95,
      fade: 280, settleHold: 320,
    },
  ],
  'district.developed': [
    // The world reveal is the star here; the companion only turns to look at it.
    // §23: the world reveal lasts a few seconds, then everything returns to calm.
    {
      id: 'react.watch', clip: 'idle.lookAround', delay: 520, priority: 70, loop: false,
      interruptibleBy: 'user', cooldown: 60_000, focusSafe: false, rate: 0.82,
      fade: 520, settleHold: 600,
    },
  ],
  'milestone.major': [
    {
      id: 'react.rare', clip: 'celebrate.rare', delay: 460, priority: 95, loop: false,
      interruptibleBy: 'user', cooldown: 21_600_000, focusSafe: false, rate: 1.0,
      fade: 340, settleHold: 500,
    },
    {
      id: 'react.milestone', clip: 'celebrate.milestone', delay: 440, priority: 85, loop: false,
      interruptibleBy: 'user', cooldown: 3_600_000, focusSafe: false, rate: 1.0,
      fade: 340, settleHold: 420,
    },
  ],

  // ── Session ───────────────────────────────────────────────────────────────
  'session.open': [
    {
      id: 'open.arrive', clip: 'idle.lookAround', delay: 700, priority: 50, loop: false,
      interruptibleBy: 'user', cooldown: 0, focusSafe: true, rate: 0.9,
      fade: 600, settleHold: 400,
    },
  ],
  'session.close': [],
  'mode.changed': [],

  // ── Ambient ───────────────────────────────────────────────────────────────
  // §34: idle actions must remain nondistracting. This is the only self-initiated behavior,
  // and it is heavily rate-limited by the ambient scheduler below.
  'ambient.tick': [
    {
      id: 'ambient.look', clip: 'idle.lookAround', delay: 0, priority: 5, loop: false,
      interruptibleBy: 'anything', cooldown: 42_000, focusSafe: false, rate: 0.8,
      fade: 900, settleHold: 300,
    },
  ],
};

/** Per-mode tuning. Focus mode is near-silent; Together mode is the most expressive. */
export const MODE_TUNING: Record<CompanionMode, {
  /** Chance an ambient tick actually produces a behavior. */
  ambientChance: number;
  /** Multiplies every delay — higher = more languid. */
  delayScale: number;
  /** Multiplies every playback rate. */
  rateScale: number;
  /** Drop behaviors whose focusSafe is false. */
  suppressUnsafe: boolean;
}> = {
  focus:    { ambientChance: 0.04, delayScale: 1.35, rateScale: 0.80, suppressUnsafe: true },
  ask:      { ambientChance: 0.18, delayScale: 1.00, rateScale: 1.00, suppressUnsafe: false },
  stuck:    { ambientChance: 0.10, delayScale: 1.15, rateScale: 0.92, suppressUnsafe: false },
  debrief:  { ambientChance: 0.30, delayScale: 0.90, rateScale: 1.00, suppressUnsafe: false },
  together: { ambientChance: 0.42, delayScale: 0.85, rateScale: 1.05, suppressUnsafe: false },
};

/**
 * Ambient scheduling. Rather than a fixed interval (which the eye learns and then finds mechanical),
 * the next tick is drawn from a wide jittered window. Combined with `ambientChance`, the companion's
 * self-initiated motion becomes genuinely unpredictable — the property that reads as "alive".
 */
export const AMBIENT_WINDOW_MS = { min: 14_000, max: 46_000 };

export function nextAmbientDelay(rand: () => number = Math.random): number {
  const { min, max } = AMBIENT_WINDOW_MS;
  return Math.round(min + rand() * (max - min));
}

/** Distance-appropriate gait. Board is normalized to 0..1 across its diagonal. */
export function gaitFor(normalizedDistance: number, urgent = false): ClipName {
  if (urgent) return normalizedDistance > 0.55 ? 'locomote.run' : 'locomote.jog';
  if (normalizedDistance < 0.18) return 'locomote.stroll';
  if (normalizedDistance < 0.62) return 'locomote.walk';
  return 'locomote.jog';
}

/**
 * Travel duration for a move. Real distance decides time, not a constant — a constant duration for
 * every move is the tell that a token is being tweened rather than walking. Clamped so very short
 * hops still read as steps and very long ones don't drag.
 */
export function travelDurationMs(normalizedDistance: number, clip: ClipName): number {
  const speed: Partial<Record<ClipName, number>> = {
    'locomote.stroll': 900,
    'locomote.walk': 1500,
    'locomote.jog': 2400,
    'locomote.run': 3400,
    'study.walkReading': 800,
  };
  const px = normalizedDistance * 1000;
  const raw = (px / (speed[clip] ?? 1500)) * 1000;
  return Math.round(Math.min(2600, Math.max(420, raw)));
}
