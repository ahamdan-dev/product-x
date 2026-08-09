import { describe, it, expect } from 'vitest';
import { BehaviorArbiter } from './arbiter';
import { gaitFor, travelDurationMs, nextAmbientDelay, type ClipName } from './behavior';

const ALL_CLIPS = new Set<ClipName>([
  'idle.breathe', 'idle.lookAround', 'locomote.stroll', 'locomote.walk', 'locomote.jog',
  'locomote.run', 'study.walkReading', 'study.explain', 'celebrate.small',
  'celebrate.milestone', 'celebrate.rare',
]);

/** Controllable clock so timing assertions are exact rather than flaky. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function make(opts: {
  clips?: Set<ClipName>;
  rand?: () => number;
  start?: number;
} = {}) {
  const c = clock(opts.start ?? 0);
  const a = new BehaviorArbiter({
    availableClips: opts.clips ?? ALL_CLIPS,
    now: c.now,
    rand: opts.rand ?? (() => 0.5),
  });
  return { a, c };
}

describe('resting state', () => {
  it('starts at rest, breathing, slower than authored', () => {
    const { a } = make();
    expect(a.getActive().behavior.id).toBe('rest');
    expect(a.getActive().clip).toBe('idle.breathe');
    expect(a.getActive().rate).toBeLessThan(1);
  });
});

describe('reaction latency — the alive-vs-robotic property', () => {
  it('delays every reactive behavior instead of firing on the trigger tick', () => {
    const { a, c } = make();
    const r = a.fire('concept.stabilized');
    expect(r).not.toBeNull();
    // Not visibly playing yet: the companion is "noticing".
    expect(a.isPlaying()).toBe(false);
    c.advance(r!.behavior.delay - 1);
    expect(a.isPlaying()).toBe(false);
    c.advance(2);
    expect(a.isPlaying()).toBe(true);
  });

  it('does NOT delay barge-in — yielding to the user must be instant', () => {
    const { a } = make();
    a.fire('companion.speakStart');
    const r = a.fire('user.typing', true);
    expect(r).not.toBeNull();
    expect(r!.behavior.delay).toBe(0);
    expect(a.isPlaying()).toBe(true);
  });
});

describe('interrupt classes', () => {
  it('a user action always cuts off companion speech', () => {
    const { a, c } = make();
    a.fire('companion.speakStart');
    c.advance(500);
    const r = a.fire('user.voiceStart', true);
    expect(r?.behavior.id).toBe('yield.listen');
  });

  it('an ambient tick cannot stomp a running celebration', () => {
    const { a, c } = make({ rand: () => 0.01 });
    a.fire('milestone.major');
    c.advance(600);
    a.reportClipDuration(4000);
    // System-initiated, low priority, and the celebration is interruptibleBy 'user'.
    expect(a.fire('ambient.tick')).toBeNull();
  });

  it('a finished one-shot is replaceable even by a low-priority behavior', () => {
    const { a, c } = make({ rand: () => 0.01 });
    a.fire('concept.improved');
    c.advance(500);
    a.reportClipDuration(1200);
    c.advance(5000);            // well past the end
    expect(a.tick()?.behavior.id).toBe('rest');
  });
});

describe('cooldowns keep rare things rare', () => {
  it('refuses the same behavior inside its cooldown window', () => {
    const { a, c } = make();
    expect(a.fire('concept.stabilized')).not.toBeNull();
    c.advance(1000);
    a.reportClipDuration(500);
    c.advance(3000);
    a.tick();                                     // settle to rest
    expect(a.fire('concept.stabilized')).toBeNull(); // 180s cooldown still active
    c.advance(180_000);
    expect(a.fire('concept.stabilized')).not.toBeNull();
  });

  it('falls through to the milestone behavior when the rare one is cooling down', () => {
    const { a, c } = make();
    expect(a.fire('milestone.major')?.behavior.id).toBe('react.rare');
    c.advance(600);
    a.reportClipDuration(3000);
    c.advance(10_000);
    a.tick();
    // rare has a 6h cooldown; milestone (1h) is still available.
    expect(a.fire('milestone.major')?.behavior.id).toBe('react.milestone');
  });

  it('gives celebrate.rare a genuinely long cooldown (blueprint: use rarely)', () => {
    const { a } = make();
    const r = a.fire('milestone.major')!;
    expect(r.behavior.cooldown).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
  });
});

describe('focus mode suppression', () => {
  it('drops focus-unsafe behaviors but keeps breathing', () => {
    const { a } = make();
    a.setMode('focus');
    expect(a.fire('concept.improved')).toBeNull();   // focusSafe: false
    expect(a.getActive().clip).toBe('idle.breathe'); // still alive, not dead
  });

  it('still allows navigation and speech while focused', () => {
    const { a } = make();
    a.setMode('focus');
    expect(a.fire('card.selected')).not.toBeNull();
    expect(a.fire('companion.speakStart')).not.toBeNull();
  });

  it('slows the companion down in focus mode', () => {
    const { a } = make();
    const askRate = a.getActive().rate;
    a.setMode('focus');
    a.fire('card.selected');
    const focusRate = a.getActive().rate;
    a.setMode('together');
    a.fire('route.accepted');
    expect(focusRate).toBeLessThan(a.getActive().rate);
    expect(askRate).toBeGreaterThan(0);
  });
});

describe('evidence must not be gamified', () => {
  it('produces no companion reaction when raw evidence arrives', () => {
    const { a } = make();
    expect(a.fire('evidence.received')).toBeNull();
    expect(a.getActive().behavior.id).toBe('rest');
  });
});

describe('ambient scheduling', () => {
  it('never fires more often than the minimum window', () => {
    const { a, c } = make({ rand: () => 0.0 });   // always passes the chance roll
    let fires = 0;
    for (let i = 0; i < 600; i++) {               // 60s at 100ms steps
      c.advance(100);
      if (a.tick()?.behavior.id === 'ambient.look') fires++;
    }
    // 14s min window over 60s, and a 42s behavior cooldown on top.
    expect(fires).toBeLessThanOrEqual(2);
  });

  it('is near-silent in focus mode', () => {
    const { a, c } = make({ rand: () => 0.5 });   // 0.5 > focus ambientChance 0.04
    a.setMode('focus');
    let fires = 0;
    for (let i = 0; i < 2000; i++) {
      c.advance(100);
      if (a.tick()?.behavior.id === 'ambient.look') fires++;
    }
    expect(fires).toBe(0);
  });

  it('varies its interval so the cadence is not learnable', () => {
    const seq = [0.1, 0.9, 0.35, 0.72, 0.5];
    let i = 0;
    // `?? 0.5` satisfies noUncheckedIndexedAccess without weakening the test: `i` never exceeds
    // seq.length here, since map calls the fn exactly seq.length times.
    const vals = seq.map(() => nextAmbientDelay(() => seq[i++] ?? 0.5));
    expect(new Set(vals).size).toBe(seq.length);
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(14_000);
      expect(v).toBeLessThanOrEqual(46_000);
    }
  });

  it('does not interrupt itself — ambient only rolls while resting', () => {
    const { a, c } = make({ rand: () => 0.0 });
    a.fire('companion.speakStart');
    c.advance(300);
    let fires = 0;
    for (let i = 0; i < 1000; i++) {
      c.advance(100);
      if (a.tick()?.behavior.id === 'ambient.look') fires++;
    }
    expect(fires).toBe(0);
  });
});

describe('clip fallback for rigs missing an animation', () => {
  it('substitutes a real clip when study.explain is absent (female rig)', () => {
    const female = new Set(ALL_CLIPS);
    female.delete('study.explain');
    const { a } = make({ clips: female });
    const r = a.fire('companion.speakStart');
    expect(r).not.toBeNull();
    expect(r!.clip).not.toBe('study.explain');
    expect(female.has(r!.clip)).toBe(true);
  });

  it('degrades celebrate.rare down the chain', () => {
    const minimal = new Set<ClipName>(['idle.breathe', 'celebrate.small']);
    const { a } = make({ clips: minimal });
    expect(a.fire('milestone.major')!.clip).toBe('celebrate.small');
  });

  it('never resolves to a clip the rig does not have', () => {
    const minimal = new Set<ClipName>(['idle.breathe']);
    const { a } = make({ clips: minimal });
    for (const trig of ['card.selected', 'milestone.major', 'companion.speakStart'] as const) {
      const r = a.fire(trig, true);
      if (r) expect(minimal.has(r.clip)).toBe(true);
    }
  });
});

describe('gait selection — distance decides, not a constant', () => {
  it('strolls when close, walks mid-range, jogs across the board', () => {
    expect(gaitFor(0.05)).toBe('locomote.stroll');
    expect(gaitFor(0.4)).toBe('locomote.walk');
    expect(gaitFor(0.9)).toBe('locomote.jog');
  });

  it('reserves running for urgency only', () => {
    expect(gaitFor(0.9, false)).not.toBe('locomote.run');
    expect(gaitFor(0.9, true)).toBe('locomote.run');
  });

  it('scales travel time with distance and clamps both ends', () => {
    const near = travelDurationMs(0.05, 'locomote.stroll');
    const far = travelDurationMs(0.95, 'locomote.stroll');
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThanOrEqual(420);
    expect(far).toBeLessThanOrEqual(2600);
  });
});

describe('one behavior at a time', () => {
  it('holds exactly one active behavior through a burst of triggers', () => {
    const { a, c } = make();
    for (const t of ['card.selected', 'corner.entered', 'concept.improved'] as const) {
      a.fire(t);
      c.advance(50);
      expect(a.getActive()).toBeDefined();
    }
    expect(a.debug().active).toBeTruthy();
  });
});
