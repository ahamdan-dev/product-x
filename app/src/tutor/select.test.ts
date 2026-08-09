import { describe, it, expect } from 'vitest';
import {
  weakestFirst, zoneOfProximalDevelopment, spacedRetrieval,
  defaultHeuristic, configure, select, HEURISTICS, ZPD_TARGET,
  type Candidate, type SelectionHeuristic,
} from './select';
import { SkillTracker } from './skills';
import { MASTERY_THRESHOLD, type BktParams } from './bkt';
import { emptyConcept, type ConceptState } from '../learner/model';

const PARAMS: BktParams = { pInit: 0.3, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1, pForget: 0 };

function tracker(mastery: Record<string, number> = {}): SkillTracker {
  const t = new SkillTracker({ defaultParams: PARAMS });
  for (const [id, m] of Object.entries(mastery)) t.set(id, m);
  return t;
}

const item = (id: string, ...skillIds: string[]): Candidate => ({ id, skillIds });

describe('the empty and degenerate cases return null, never throw', () => {
  it('returns null for an empty candidate list', () => {
    const t = tracker();
    expect(weakestFirst([], t)).toBeNull();
    expect(zoneOfProximalDevelopment([], t)).toBeNull();
    expect(spacedRetrieval([], t)).toBeNull();
    expect(defaultHeuristic([], t)).toBeNull();
  });

  it('returns null when every candidate is already completed', () => {
    const t = tracker();
    const pool = [item('a', 's1'), item('b', 's2')];
    const completed = new Set(['a', 'b']);
    expect(weakestFirst(pool, t, { completed })).toBeNull();
    expect(zoneOfProximalDevelopment(pool, t, { completed })).toBeNull();
    expect(spacedRetrieval(pool, t, { completed })).toBeNull();
  });

  it('reports exhaustion explicitly through select()', () => {
    const t = tracker();
    expect(select([], t)).toEqual({ item: null, fallback: false, exhausted: true });
  });

  it('handles an untagged candidate without dividing by zero', () => {
    const t = tracker();
    const pool: Candidate[] = [{ id: 'untagged', skillIds: [] }];
    expect(weakestFirst(pool, t)?.id).toBe('untagged');
    expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('untagged');
    expect(spacedRetrieval(pool, t)?.id).toBe('untagged');
  });
});

describe('mastered items are avoided — unless nothing else remains', () => {
  it('skips an item whose every skill is mastered', () => {
    const t = tracker({ known: 0.99, unknown: 0.2 });
    const pool = [item('done', 'known'), item('todo', 'unknown')];
    expect(weakestFirst(pool, t)?.id).toBe('todo');
    expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('todo');
  });

  it('still returns something when EVERY item is mastered, rather than dead-ending', () => {
    const t = tracker({ a: 0.99, b: 0.98 });
    const pool = [item('x', 'a'), item('y', 'b')];
    const result = select(pool, t, weakestFirst);
    expect(result.item).not.toBeNull();
    expect(result.fallback).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it('does not flag fallback when unmastered work remains', () => {
    const t = tracker({ a: 0.99, b: 0.2 });
    const result = select([item('x', 'a'), item('y', 'b')], t, weakestFirst);
    expect(result.item?.id).toBe('y');
    expect(result.fallback).toBe(false);
  });

  it('treats a partially-mastered multi-skill item as still teachable', () => {
    const t = tracker({ solid: 0.99, shaky: 0.3 });
    const pool = [item('mixed', 'solid', 'shaky')];
    expect(weakestFirst(pool, t)?.id).toBe('mixed');
    expect(select(pool, t, weakestFirst).fallback).toBe(false);
  });

  it('honours a custom threshold', () => {
    const t = tracker({ a: 0.7, b: 0.4 });
    const pool = [item('x', 'a'), item('y', 'b')];
    expect(select(pool, t, weakestFirst, { threshold: 0.6 }).item?.id).toBe('y');
  });
});

describe('weakestFirst remediates', () => {
  it('picks the item with the lowest skill mastery', () => {
    const t = tracker({ strong: 0.9, mid: 0.5, weak: 0.1 });
    const pool = [item('a', 'strong'), item('b', 'mid'), item('c', 'weak')];
    expect(weakestFirst(pool, t)?.id).toBe('c');
  });

  it('uses the geometric mean, so a long item is not automatically the weakest', () => {
    const t = tracker({
      s1: 0.8, s2: 0.8, s3: 0.8, s4: 0.8, s5: 0.8, s6: 0.8,
      lonely: 0.6,
    });
    // Raw product would score the six-skill item 0.26 and the one-skill item 0.6, picking the
    // long one purely for being long. The geometric mean scores them 0.8 vs 0.6.
    const pool = [item('long', 's1', 's2', 's3', 's4', 's5', 's6'), item('short', 'lonely')];
    expect(weakestFirst(pool, t)?.id).toBe('short');
  });

  it('is the default heuristic, matching the original', () => {
    const t = tracker({ strong: 0.9, weak: 0.1 });
    const pool = [item('a', 'strong'), item('b', 'weak')];
    expect(defaultHeuristic(pool, t)?.id).toBe(weakestFirst(pool, t)?.id);
  });

  it('picks a near-floor item, which is exactly its documented downside', () => {
    const t = tracker({ hopeless: 0.02, achievable: 0.65 });
    const pool = [item('a', 'hopeless'), item('b', 'achievable')];
    const pick = weakestFirst(pool, t)!;
    expect(pick.id).toBe('a');
    // Predicted success on the chosen item is near pGuess — demoralising by construction.
    expect(t.predictStep(pick.skillIds)).toBeLessThan(0.25);
  });
});

describe('zoneOfProximalDevelopment picks the ~0.7 item', () => {
  /**
   * The spread is built by choosing masteries whose predicted P(correct) lands at known points.
   * With pGuess 0.2 and pSlip 0.1, P(correct) = 0.2 + 0.7·L, so L = (target − 0.2) / 0.7.
   */
  const forPredicted = (p: number) => (p - 0.2) / 0.7;

  it('picks the item closest to the 0.7 target, not the easiest', () => {
    const t = tracker({
      trivial: forPredicted(0.95),
      justRight: forPredicted(0.70),
      hard: forPredicted(0.40),
      hopeless: forPredicted(0.22),
    });
    const pool = [
      item('trivial', 'trivial'),
      item('justRight', 'justRight'),
      item('hard', 'hard'),
      item('hopeless', 'hopeless'),
    ];

    const pick = zoneOfProximalDevelopment(pool, t)!;
    expect(pick.id).toBe('justRight');
    expect(t.predictStep(pick.skillIds)).toBeCloseTo(0.7, 6);
  });

  it('is not the easiest item, and not the hardest either', () => {
    const t = tracker({
      easiest: forPredicted(0.93),
      middling: forPredicted(0.72),
      hardest: forPredicted(0.25),
    });
    const pool = [item('e', 'easiest'), item('m', 'middling'), item('h', 'hardest')];

    const pick = zoneOfProximalDevelopment(pool, t)!;
    expect(pick.id).toBe('m');
    // The explicit contrast with the other two policies on the same pool.
    expect(weakestFirst(pool, t)?.id).toBe('h');
    expect(pick.id).not.toBe('e');
    expect(pick.id).not.toBe('h');
  });

  /**
   * Two items placed symmetrically around the target are NOT an exact tie in floating point —
   * |0.6 − 0.7| is 0.09999999999999998 and |0.8 − 0.7| is 0.10000000000000020, so the lower item
   * genuinely wins by 2e-16. Asserting a specific winner here would be asserting a rounding
   * artefact. What is worth pinning is that the choice is *stable*: same inputs, same answer,
   * every time.
   */
  it('is stable on a near-tie rather than randomly picking either side', () => {
    const t = tracker({ below: forPredicted(0.6), above: forPredicted(0.8) });
    const pool = [item('below', 'below'), item('above', 'above')];
    const first = zoneOfProximalDevelopment(pool, t)!.id;
    for (let i = 0; i < 200; i++) {
      expect(zoneOfProximalDevelopment(pool, t)!.id).toBe(first);
    }
    // And stable under a reordering of the input, which a naive first-wins argmin would not be.
    expect(zoneOfProximalDevelopment([...pool].reverse(), t)!.id).toBe(first);
  });

  it('breaks an exact tie on candidate id', () => {
    const t = tracker({ s: forPredicted(0.5) });
    // Same skill on both, so the distance to target is bit-identical.
    const pool = [item('zebra', 's'), item('alpha', 's')];
    expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('alpha');
  });

  it('honours a custom target', () => {
    const t = tracker({
      low: forPredicted(0.35),
      mid: forPredicted(0.70),
      // Capped below the mastery threshold: a predicted 0.92 would need mastery 1.03, and anything
      // at or above 0.95 is filtered out as already mastered — correctly, but it would make this
      // test about the filter instead of about the target.
      high: 0.94,
    });
    const pool = [item('low', 'low'), item('mid', 'mid'), item('high', 'high')];
    expect(t.predictStep(['high'])).toBeCloseTo(0.858, 3);

    expect(zoneOfProximalDevelopment(pool, t, { target: 0.86 })?.id).toBe('high');
    expect(zoneOfProximalDevelopment(pool, t, { target: 0.70 })?.id).toBe('mid');
    expect(zoneOfProximalDevelopment(pool, t, { target: 0.35 })?.id).toBe('low');
  });

  it('accounts for per-item guess/slip, so an MCQ and free text rank differently', () => {
    const t = tracker({ s: 0.5 });
    // Same skill, same mastery; the MCQ is easier purely because guessing works.
    const mcq: Candidate = { id: 'mcq', skillIds: ['s'], itemParams: { pGuess: 0.25 } };
    const free: Candidate = { id: 'free', skillIds: ['s'], itemParams: { pGuess: 0.0 } };
    expect(t.predictStep(mcq.skillIds, mcq.itemParams))
      .toBeGreaterThan(t.predictStep(free.skillIds, free.itemParams));
    // With mastery 0.5: mcq predicts 0.575, free predicts 0.45. Target 0.7 favours the MCQ.
    expect(zoneOfProximalDevelopment([mcq, free], t)?.id).toBe('mcq');
  });

  it('tracks the learner: as they improve, it moves on to harder material', () => {
    const t = tracker({ basic: 0.2, advanced: 0.02 });
    const pool = [item('basic', 'basic'), item('advanced', 'advanced')];
    expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('basic');

    // Master the basic skill; the advanced item is now the closer one to target.
    t.set('basic', 0.99);
    t.set('advanced', forPredicted(0.68));
    expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('advanced');
  });

  it('exposes 0.7 as the documented default target', () => {
    expect(ZPD_TARGET).toBe(0.7);
  });
});

describe('spacedRetrieval finds what is due', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_800_000_000_000;

  /** A concept with `retrievals` successes, last retrieved `daysAgo` before NOW. */
  function concept(id: string, retrievals: number, daysAgo: number): ConceptState {
    return {
      ...emptyConcept(id, 'district'),
      successfulRetrievals: retrievals,
      lastRetrievedAt: NOW - daysAgo * DAY,
    };
  }

  it('picks the item whose skills are least retrievable right now', () => {
    const t = tracker({ fresh: 0.8, stale: 0.8 });
    const pool: Candidate[] = [
      { id: 'fresh', skillIds: ['fresh'], conceptStates: [concept('fresh', 3, 0.5)] },
      { id: 'stale', skillIds: ['stale'], conceptStates: [concept('stale', 3, 30)] },
    ];
    expect(spacedRetrieval(pool, t, { now: NOW })?.id).toBe('stale');
  });

  /**
   * The regression test for a real bug found while writing these tests: the shared "skip anything
   * already mastered" filter was dropping BKT-mastered items *before* `spacedRetrieval` ever saw
   * them. Since a decayed skill sits at 0.99 forever under `pForget = 0`, that filter deleted the
   * exact case this policy exists to catch. Mastered-but-due items are now rescued into the pool.
   */
  it('catches a skill BKT thinks is mastered but that has decayed in real time', () => {
    const t = tracker({ decayed: 0.99, weakish: 0.45 });
    const pool: Candidate[] = [
      { id: 'decayed', skillIds: ['decayed'], conceptStates: [concept('decayed', 2, 60)] },
      { id: 'weakish', skillIds: ['weakish'], conceptStates: [concept('weakish', 4, 0.2)] },
    ];
    expect(t.isMastered('decayed')).toBe(true);          // BKT says done
    // weakestFirst would drill the low-mastery item and never revisit the decayed one.
    expect(weakestFirst(pool, t)?.id).toBe('weakish');
    expect(spacedRetrieval(pool, t, { now: NOW })?.id).toBe('decayed');
  });

  it('does NOT rescue a mastered item that is still fresh', () => {
    const t = tracker({ freshMastered: 0.99, weakish: 0.45 });
    const pool: Candidate[] = [
      { id: 'freshMastered', skillIds: ['freshMastered'], conceptStates: [concept('freshMastered', 6, 0.05)] },
      { id: 'weakish', skillIds: ['weakish'], conceptStates: [concept('weakish', 1, 0.2)] },
    ];
    // Nothing is due on the mastered item, so the ordinary mastery filter applies to it.
    expect(spacedRetrieval(pool, t, { now: NOW })?.id).toBe('weakish');
  });

  it('the rescue does not leak into the other two policies', () => {
    const t = tracker({ decayed: 0.99, weakish: 0.45 });
    const pool: Candidate[] = [
      { id: 'decayed', skillIds: ['decayed'], conceptStates: [concept('decayed', 2, 60)] },
      { id: 'weakish', skillIds: ['weakish'], conceptStates: [concept('weakish', 4, 0.2)] },
    ];
    expect(weakestFirst(pool, t)?.id).toBe('weakish');
    expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('weakish');
  });

  it('uses the WORST concept on a multi-concept item', () => {
    const t = tracker({ a: 0.5, b: 0.5, c: 0.5 });
    const pool: Candidate[] = [
      { id: 'oneRotten', skillIds: ['a', 'b'], conceptStates: [concept('a', 3, 0.2), concept('b', 1, 45)] },
      { id: 'allFresh', skillIds: ['c'], conceptStates: [concept('c', 3, 0.3)] },
    ];
    expect(spacedRetrieval(pool, t, { now: NOW })?.id).toBe('oneRotten');
  });

  it('deprioritises never-retrieved concepts — review means reviewing something', () => {
    const t = tracker({ neverSeen: 0.3, due: 0.8 });
    const pool: Candidate[] = [
      // lastRetrievedAt === null, so retrievability() is 0 — maximally urgent if taken literally.
      { id: 'neverSeen', skillIds: ['neverSeen'], conceptStates: [emptyConcept('neverSeen', 'd')] },
      { id: 'due', skillIds: ['due'], conceptStates: [concept('due', 2, 20)] },
    ];
    expect(spacedRetrieval(pool, t, { now: NOW })?.id).toBe('due');
  });

  it('still returns a pick when nothing has ever been retrieved', () => {
    const t = tracker({ a: 0.3, b: 0.3 });
    const pool: Candidate[] = [
      { id: 'a', skillIds: ['a'], conceptStates: [emptyConcept('a', 'd')] },
      { id: 'b', skillIds: ['b'] },
    ];
    expect(spacedRetrieval(pool, t, { now: NOW })).not.toBeNull();
  });

  it('a longer-established concept decays slower, so it is picked later', () => {
    const t = tracker({ shallow: 0.8, deep: 0.8 });
    // Same elapsed time; the concept with more retrievals has a longer half-life.
    const pool: Candidate[] = [
      { id: 'shallow', skillIds: ['shallow'], conceptStates: [concept('shallow', 1, 10)] },
      { id: 'deep', skillIds: ['deep'], conceptStates: [concept('deep', 6, 10)] },
    ];
    expect(spacedRetrieval(pool, t, { now: NOW })?.id).toBe('shallow');
  });
});

describe('the three policies are genuinely different', () => {
  it('disagree on the same pool, which is the whole reason all three exist', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const NOW = 1_800_000_000_000;
    const t = tracker({ weak: 0.05, zpd: 5 / 7, decayed: 0.9 });

    const pool: Candidate[] = [
      { id: 'weak', skillIds: ['weak'], conceptStates: [{ ...emptyConcept('weak', 'd'), successfulRetrievals: 3, lastRetrievedAt: NOW - DAY }] },
      { id: 'zpd', skillIds: ['zpd'], conceptStates: [{ ...emptyConcept('zpd', 'd'), successfulRetrievals: 3, lastRetrievedAt: NOW - DAY }] },
      { id: 'decayed', skillIds: ['decayed'], conceptStates: [{ ...emptyConcept('decayed', 'd'), successfulRetrievals: 1, lastRetrievedAt: NOW - 40 * DAY }] },
    ];

    expect(weakestFirst(pool, t)?.id).toBe('weak');
    expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('zpd');
    expect(spacedRetrieval(pool, t, { now: NOW })?.id).toBe('decayed');
  });

  it('are all registered by name for a settings screen or an experiment', () => {
    expect(Object.keys(HEURISTICS).sort())
      .toEqual(['spacedRetrieval', 'weakestFirst', 'zoneOfProximalDevelopment']);
  });
});

describe('determinism', () => {
  it('breaks candidate ties on id, never randomly', () => {
    const t = tracker({ s: 0.4 });
    // Three items, identical skills, therefore identical scores under every policy.
    const pool = [item('zebra', 's'), item('alpha', 's'), item('monkey', 's')];
    for (let i = 0; i < 200; i++) {
      expect(weakestFirst(pool, t)?.id).toBe('alpha');
      expect(zoneOfProximalDevelopment(pool, t)?.id).toBe('alpha');
      expect(spacedRetrieval(pool, t)?.id).toBe('alpha');
    }
  });

  it('is independent of the order the candidates arrive in', () => {
    const t = tracker({ s: 0.4 });
    const ids = ['zebra', 'alpha', 'monkey'];
    const forward = ids.map(id => item(id, 's'));
    const backward = [...forward].reverse();
    expect(weakestFirst(forward, t)?.id).toBe(weakestFirst(backward, t)?.id);
    expect(zoneOfProximalDevelopment(forward, t)?.id)
      .toBe(zoneOfProximalDevelopment(backward, t)?.id);
  });

  it('produces an identical session trajectory across two independent runs', () => {
    const run = () => {
      const t = tracker();
      const pool = ['a', 'b', 'c', 'd', 'e'].map(id => item(id, `skill-${id}`));
      const completed = new Set<string>();
      const picks: string[] = [];
      for (let i = 0; i < 5; i++) {
        const pick = zoneOfProximalDevelopment(pool, t, { completed });
        if (!pick) break;
        picks.push(pick.id);
        completed.add(pick.id);
        t.observeStep(pick.id, pick.skillIds, i % 2 === 0);
      }
      return picks;
    };
    const a = run();
    expect(a).toHaveLength(5);
    expect(a).toEqual(run());
  });

  it('does not mutate the candidate array it is given', () => {
    const t = tracker({ s: 0.4 });
    const pool = [item('b', 's'), item('a', 's')];
    const before = pool.map(c => c.id);
    weakestFirst(pool, t);
    zoneOfProximalDevelopment(pool, t);
    spacedRetrieval(pool, t);
    expect(pool.map(c => c.id)).toEqual(before);
  });
});

describe('the injection seam', () => {
  it('configure() binds options into a bare SelectionHeuristic', () => {
    const t = tracker({ low: 0.1, mid: 5 / 7 });
    const pool = [item('low', 'low'), item('mid', 'mid')];

    const policy: SelectionHeuristic = configure(zoneOfProximalDevelopment, { target: 0.7 });
    expect(policy(pool, t)?.id).toBe('mid');

    const remedial: SelectionHeuristic = configure(weakestFirst);
    expect(remedial(pool, t)?.id).toBe('low');
  });

  it('lets a caller pass any policy through select()', () => {
    const t = tracker({ a: 0.2, b: 0.9 });
    const pool = [item('a', 'a'), item('b', 'b')];
    // A one-off custom policy: always the last candidate. The seam does not care.
    const last = (c: Candidate[]) => c.at(-1) ?? null;
    expect(select(pool, t, last).item?.id).toBe('b');
  });

  it('skips completed items across every policy', () => {
    const t = tracker({ a: 0.1, b: 0.5 });
    const pool = [item('a', 'a'), item('b', 'b')];
    const completed = new Set(['a']);
    expect(weakestFirst(pool, t, { completed })?.id).toBe('b');
    expect(zoneOfProximalDevelopment(pool, t, { completed })?.id).toBe('b');
  });

  it('respects the shared mastery threshold constant', () => {
    const t = tracker({ a: MASTERY_THRESHOLD, b: MASTERY_THRESHOLD - 0.01 });
    expect(weakestFirst([item('a', 'a'), item('b', 'b')], t)?.id).toBe('b');
  });
});
