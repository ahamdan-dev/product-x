/**
 * Behavior arbiter — decides what the companion does, and when.
 *
 * Pure logic, no Three.js. That keeps it unit-testable, which matters because timing bugs in a
 * character are invisible in code review and glaring on screen.
 *
 * The arbiter owns four guarantees:
 *   1. Only one behavior is active at a time.
 *   2. A behavior cannot be interrupted by something its interrupt class forbids.
 *   3. A behavior on cooldown never fires — the same reaction can't repeat back-to-back.
 *   4. Every reactive behavior is delayed by a "noticing" beat before it starts.
 */

import {
  BEHAVIOR_TABLE, MODE_TUNING, RESTING, nextAmbientDelay,
  type Behavior, type ClipName, type CompanionMode, type TriggerId,
} from './behavior';

export interface ActiveBehavior {
  behavior: Behavior;
  clip: ClipName;
  /** Effective values after mode tuning is applied. */
  rate: number;
  fade: number;
  /** now() when the clip should actually start playing. */
  startAt: number;
  /** now() when a one-shot is expected to finish (incl. settleHold). null for loops. */
  endsAt: number | null;
}

export interface ArbiterOptions {
  /** Clips the loaded rig actually has. Missing clips fall back gracefully. */
  availableClips: ReadonlySet<ClipName>;
  now?: () => number;
  rand?: () => number;
}

/** Fallbacks for rigs missing an authored clip (the female rig has no study.explain). */
const CLIP_FALLBACK: Partial<Record<ClipName, ClipName[]>> = {
  'study.explain': ['idle.lookAround', 'idle.breathe'],
  'celebrate.rare': ['celebrate.milestone', 'celebrate.small'],
  'celebrate.milestone': ['celebrate.small', 'idle.lookAround'],
  'locomote.stroll': ['locomote.walk'],
  'locomote.jog': ['locomote.walk'],
  'locomote.run': ['locomote.jog', 'locomote.walk'],
  'study.walkReading': ['locomote.walk'],
};

export class BehaviorArbiter {
  private mode: CompanionMode = 'ask';
  private active: ActiveBehavior;
  private lastFired = new Map<string, number>();
  private lastAmbientAt: number;
  private nextAmbientAt: number;
  private readonly now: () => number;
  private readonly rand: () => number;
  private readonly clips: ReadonlySet<ClipName>;

  constructor(opts: ArbiterOptions) {
    this.now = opts.now ?? (() => performance.now());
    this.rand = opts.rand ?? Math.random;
    this.clips = opts.availableClips;
    const t = this.now();
    this.active = this.toActive(RESTING, t);
    this.lastAmbientAt = t;
    this.nextAmbientAt = t + nextAmbientDelay(this.rand);
  }

  getMode(): CompanionMode { return this.mode; }

  setMode(mode: CompanionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Re-roll the ambient clock so a mode switch doesn't inherit the previous mode's cadence.
    this.nextAmbientAt = this.now() + nextAmbientDelay(this.rand);
  }

  getActive(): ActiveBehavior { return this.active; }

  /** True once the delay has elapsed and the clip should be audibly/visibly playing. */
  isPlaying(): boolean { return this.now() >= this.active.startAt; }

  /**
   * Resolve a clip name against what the rig actually has.
   * Returns null only if neither the clip nor any fallback exists.
   */
  private resolveClip(clip: ClipName): ClipName | null {
    if (this.clips.has(clip)) return clip;
    for (const alt of CLIP_FALLBACK[clip] ?? []) {
      if (this.clips.has(alt)) return alt;
    }
    return this.clips.has('idle.breathe') ? 'idle.breathe' : null;
  }

  private toActive(b: Behavior, t: number): ActiveBehavior {
    const tune = MODE_TUNING[this.mode];
    const clip = this.resolveClip(b.clip) ?? 'idle.breathe';
    const delay = Math.round(b.delay * tune.delayScale);
    const startAt = t + delay;
    const rate = (b.rate ?? 1) * tune.rateScale;
    return {
      behavior: b,
      clip,
      rate,
      fade: b.fade ?? 300,
      startAt,
      // Loops never expire. One-shot end time is filled in by the renderer once it knows the
      // real clip duration; we seed it with the settle hold so the arbiter has a lower bound.
      endsAt: b.loop ? null : startAt + (b.settleHold ?? 0),
    };
  }

  /** Called by the renderer once it knows the clip's true duration. */
  reportClipDuration(durationMs: number): void {
    const a = this.active;
    if (a.behavior.loop) return;
    const hold = a.behavior.settleHold ?? 0;
    a.endsAt = a.startAt + durationMs / a.rate + hold;
  }

  private onCooldown(b: Behavior, t: number): boolean {
    if (b.cooldown <= 0) return false;
    const last = this.lastFired.get(b.id);
    return last !== undefined && t - last < b.cooldown;
  }

  private canInterrupt(incoming: Behavior, isUserAction: boolean): boolean {
    const cur = this.active.behavior;
    switch (cur.interruptibleBy) {
      case 'anything': return true;
      case 'user': return isUserAction || incoming.priority > cur.priority;
      case 'nothing': return isUserAction;
    }
  }

  /**
   * Fire a trigger. Returns the newly active behavior if it changed, else null.
   * `isUserAction` marks triggers that came from a direct human act — those get interrupt rights
   * that system events do not, which is what keeps the companion from ever talking over the user.
   */
  fire(trigger: TriggerId, isUserAction = false): ActiveBehavior | null {
    const t = this.now();
    const tune = MODE_TUNING[this.mode];
    const candidates = BEHAVIOR_TABLE[trigger] ?? [];
    if (candidates.length === 0) return null;

    const eligible = candidates
      .filter(b => !(tune.suppressUnsafe && !b.focusSafe))
      .filter(b => !this.onCooldown(b, t))
      // Highest priority first; ties broken by least-recently-fired so repeats vary.
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return (this.lastFired.get(a.id) ?? 0) - (this.lastFired.get(b.id) ?? 0);
      });

    const pick = eligible[0];
    if (!pick) return null;

    // A finished one-shot is always replaceable, regardless of its interrupt class.
    const finished = this.active.endsAt !== null && t >= this.active.endsAt;
    if (!finished && !this.canInterrupt(pick, isUserAction)) return null;

    this.lastFired.set(pick.id, t);
    this.active = this.toActive(pick, t);
    return this.active;
  }

  /**
   * Per-frame update. Handles two things the event system can't:
   *   - settling a finished one-shot back to rest through a cross-fade
   *   - the jittered ambient clock
   */
  tick(): ActiveBehavior | null {
    const t = this.now();
    const a = this.active;

    // Settle a completed one-shot back to breathing.
    if (a.endsAt !== null && t >= a.endsAt && a.behavior.id !== RESTING.id) {
      this.active = this.toActive(RESTING, t);
      return this.active;
    }

    // Ambient clock. Only rolls while resting — the companion never interrupts itself.
    if (t >= this.nextAmbientAt) {
      this.nextAmbientAt = t + nextAmbientDelay(this.rand);
      const resting = a.behavior.id === RESTING.id;
      if (resting && this.rand() < MODE_TUNING[this.mode].ambientChance) {
        this.lastAmbientAt = t;
        return this.fire('ambient.tick');
      }
    }
    return null;
  }

  /** Test/debug introspection. */
  debug() {
    return {
      mode: this.mode,
      active: this.active.behavior.id,
      clip: this.active.clip,
      msUntilAmbient: Math.max(0, Math.round(this.nextAmbientAt - this.now())),
      lastAmbientAt: this.lastAmbientAt,
    };
  }
}
