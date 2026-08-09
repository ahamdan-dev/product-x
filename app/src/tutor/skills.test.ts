import { describe, it, expect } from 'vitest';
import { SkillTracker } from './skills';
import { DEFAULT_PARAMS, MASTERY_THRESHOLD, updateBkt, type BktParams } from './bkt';

const PARAMS: BktParams = { pInit: 0.3, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1, pForget: 0 };

/** A tracker where every skill shares one known parameter set, so expectations are hand-checkable. */
function trackerWith(...skillIds: string[]): SkillTracker {
  const params: Record<string, BktParams> = {};
  for (const id of skillIds) params[id] = PARAMS;
  return new SkillTracker({ defaultParams: PARAMS, params });
}

describe('multi-KC steps update EVERY knowledge component', () => {
  /**
   * The regression test for OATutor `Problem.js:260-263`, where `firstAttempts[cardIndex] = true`
   * sits inside the KC loop and starves every KC after the first. If that bug were reintroduced,
   * `cardio` would move and `renal` would sit at its prior.
   */
  it('moves all three KCs of a three-skill step, not just the first', () => {
    const t = trackerWith('cardio', 'renal', 'endo');
    const before = ['cardio', 'renal', 'endo'].map(id => t.get(id));
    expect(before).toEqual([0.3, 0.3, 0.3]);

    t.observeStep('step-1', ['cardio', 'renal', 'endo'], true);

    for (const id of ['cardio', 'renal', 'endo']) {
      expect(t.get(id)).toBeGreaterThan(0.3);
      // Each KC got exactly one independent update, so each lands on the same known value.
      expect(t.get(id)).toBeCloseTo(updateBkt(0.3, true, PARAMS), 12);
    }
  });

  it('moves every KC downward on a wrong answer too', () => {
    const t = trackerWith('a', 'b');
    t.observeStep('step-1', ['a', 'b'], false);
    expect(t.get('a')).toBeCloseTo(updateBkt(0.3, false, PARAMS), 12);
    expect(t.get('b')).toBeCloseTo(updateBkt(0.3, false, PARAMS), 12);
    expect(t.get('b')).toBeLessThan(0.3);
  });

  it('updates all KCs identically regardless of their order in the array', () => {
    const forward = trackerWith('a', 'b', 'c');
    const reversed = trackerWith('a', 'b', 'c');
    forward.observeStep('s', ['a', 'b', 'c'], true);
    reversed.observeStep('s', ['c', 'b', 'a'], true);
    for (const id of ['a', 'b', 'c']) {
      expect(forward.get(id)).toBeCloseTo(reversed.get(id), 12);
    }
  });

  it('scales to a ten-KC step with no KC left behind', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `skill-${i}`);
    const t = trackerWith(...ids);
    t.observeStep('big-step', ids, true);
    for (const id of ids) expect(t.get(id)).toBeGreaterThan(0.3);
  });

  it('counts a duplicated KC once, not twice', () => {
    const dup = trackerWith('a');
    const single = trackerWith('a');
    dup.observeStep('s', ['a', 'a', 'a'], true);
    single.observeStep('s', ['a'], true);
    expect(dup.get('a')).toBeCloseTo(single.get('a'), 12);
  });
});

describe('first-attempt-only scoring', () => {
  it('ignores every attempt after the first on the same step', () => {
    const t = trackerWith('a');
    expect(t.observeStep('s1', ['a'], false)).toBe(true);
    const afterFirst = t.get('a');

    expect(t.observeStep('s1', ['a'], true)).toBe(false);
    expect(t.observeStep('s1', ['a'], true)).toBe(false);
    expect(t.get('a')).toBe(afterFirst);
  });

  it('cannot be gamed by retrying a step to mastery', () => {
    const t = trackerWith('a');
    t.observeStep('s1', ['a'], false);
    for (let i = 0; i < 50; i++) t.observeStep('s1', ['a'], true);
    expect(t.get('a')).toBeLessThan(0.3);
  });

  it('still scores a different step', () => {
    const t = trackerWith('a');
    t.observeStep('s1', ['a'], true);
    const afterS1 = t.get('a');
    expect(t.observeStep('s2', ['a'], true)).toBe(true);
    expect(t.get('a')).toBeGreaterThan(afterS1);
  });

  it('re-opens credit after an explicit reset, for practice recycling', () => {
    const t = trackerWith('a');
    t.observeStep('s1', ['a'], true);
    const once = t.get('a');
    t.resetStep('s1');
    expect(t.isStepScored('s1')).toBe(false);
    t.observeStep('s1', ['a'], true);
    expect(t.get('a')).toBeGreaterThan(once);
  });

  it('honours firstAttempt: false on the low-level observe', () => {
    const t = trackerWith('a');
    expect(t.observe('a', true, { firstAttempt: false })).toBe(0.3);
    expect(t.get('a')).toBe(0.3);
  });
});

describe('step mastery aggregation', () => {
  it('is the product of the KC masteries, matching OATutor Platform.js:401', () => {
    const t = trackerWith('a', 'b');
    t.set('a', 0.8);
    t.set('b', 0.5);
    expect(t.stepMastery(['a', 'b'])).toBeCloseTo(0.4, 12);
  });

  it('returns 1 for an untagged step — the empty product blocks nothing', () => {
    expect(trackerWith().stepMastery([])).toBe(1);
  });

  it('uses a skill\'s prior, not zero, for a never-seen skill', () => {
    expect(trackerWith().get('brand-new')).toBe(PARAMS.pInit);
    // And the library-wide default when no default was supplied either.
    expect(new SkillTracker().get('brand-new')).toBe(DEFAULT_PARAMS.pInit);
  });

  it('the geometric mean is length-independent where the raw product is not', () => {
    const t = new SkillTracker({ defaultParams: PARAMS });
    const one = ['x0'];
    const six = Array.from({ length: 6 }, (_, i) => `y${i}`);
    for (const id of [...one, ...six]) t.set(id, 0.8);

    // The raw product punishes the six-KC step for being long: 0.8^6 = 0.262.
    expect(t.stepMastery(one)).toBeCloseTo(0.8, 12);
    expect(t.stepMastery(six)).toBeCloseTo(Math.pow(0.8, 6), 12);
    expect(t.stepMastery(six)).toBeLessThan(t.stepMastery(one));

    // The geometric mean scores them equally, which is what makes ordering meaningful.
    expect(t.stepMasteryGeometric(one)).toBeCloseTo(0.8, 12);
    expect(t.stepMasteryGeometric(six)).toBeCloseTo(0.8, 12);
  });

  it('geometric mean survives many small factors without underflowing to 0', () => {
    const t = new SkillTracker({ defaultParams: PARAMS });
    // 0.5^1200 is below the smallest denormal double, so the naive product is exactly 0 while the
    // log-space geometric mean is still exact. This is why the implementation sums logs.
    const ids = Array.from({ length: 1200 }, (_, i) => `z${i}`);
    for (const id of ids) t.set(id, 0.5);
    expect(t.stepMastery(ids)).toBe(0);
    expect(t.stepMasteryGeometric(ids)).toBeCloseTo(0.5, 6);

    // Even well short of underflow the product is already useless as an ordering signal.
    const fewer = ids.slice(0, 60);
    expect(t.stepMastery(fewer)).toBeLessThan(1e-18);
    expect(t.stepMasteryGeometric(fewer)).toBeCloseTo(0.5, 6);
  });

  it('geometric mean is 0 when any KC is truly 0', () => {
    const t = trackerWith('a', 'b');
    t.set('a', 0);
    t.set('b', 0.9);
    expect(t.stepMasteryGeometric(['a', 'b'])).toBe(0);
  });

  it('aggregateMastery is the plain mean — one function, unlike the original\'s two', () => {
    const t = trackerWith('a', 'b', 'c');
    t.set('a', 0.9); t.set('b', 0.6); t.set('c', 0.3);
    expect(t.aggregateMastery(['a', 'b', 'c'])).toBeCloseTo(0.6, 12);
    // The broken copy at Problem.js:267-283 unshifted a 0 and divided by length-1, giving 0.9.
    expect(t.aggregateMastery(['a', 'b', 'c'])).not.toBeCloseTo(0.9, 3);
    expect(t.aggregateMastery([])).toBe(0);
  });
});

describe('weakest() tie-breaks deterministically', () => {
  /**
   * OATutor used `chosenProblem[Math.floor(Math.random() * chosenProblem.length)]`
   * (`defaultHeuristic.js:14`). Ties are the common case early on, when every skill still sits at
   * an identical prior, so a random tie-break makes the first lesson different on every launch.
   */
  it('picks the lexicographically lowest id when every mastery is tied', () => {
    for (let run = 0; run < 200; run++) {
      const t = trackerWith('zebra', 'alpha', 'monkey');
      expect(t.weakest(['zebra', 'alpha', 'monkey'])).toBe('alpha');
    }
  });

  it('is independent of the input order', () => {
    const t = trackerWith('a', 'b', 'c');
    expect(t.weakest(['c', 'b', 'a'])).toBe('a');
    expect(t.weakest(['b', 'a', 'c'])).toBe('a');
    expect(t.weakest(['a', 'c', 'b'])).toBe('a');
  });

  it('still prefers a genuinely lower mastery over the id ordering', () => {
    const t = trackerWith('alpha', 'zebra');
    t.set('zebra', 0.1);
    t.set('alpha', 0.9);
    expect(t.weakest(['alpha', 'zebra'])).toBe('zebra');
  });

  it('breaks a partial tie among only the tied-lowest skills', () => {
    const t = trackerWith('a', 'm', 'z');
    t.set('a', 0.9);
    t.set('m', 0.2);
    t.set('z', 0.2);
    expect(t.weakest(['a', 'm', 'z'])).toBe('m');
  });

  it('returns null for an empty list rather than throwing', () => {
    expect(trackerWith().weakest([])).toBeNull();
    expect(trackerWith().strongest([])).toBeNull();
  });

  it('strongest() mirrors it, same deterministic tie-break', () => {
    const t = trackerWith('zebra', 'alpha');
    expect(t.strongest(['zebra', 'alpha'])).toBe('alpha');
    t.set('zebra', 0.99);
    expect(t.strongest(['zebra', 'alpha'])).toBe('zebra');
  });

  it('produces an identical trajectory across two independently-run sessions', () => {
    const run = () => {
      const t = trackerWith('a', 'b', 'c', 'd');
      const picks: string[] = [];
      for (let i = 0; i < 12; i++) {
        const weak = t.weakest(['a', 'b', 'c', 'd'])!;
        picks.push(weak);
        t.observeStep(`step-${i}`, [weak], i % 3 !== 0);
      }
      return picks;
    };
    expect(run()).toEqual(run());
  });
});

describe('mastery threshold and graduation', () => {
  it('reports mastery at the shared 0.95 cutoff', () => {
    const t = trackerWith('a');
    t.set('a', 0.9499);
    expect(t.isMastered('a')).toBe(false);
    t.set('a', MASTERY_THRESHOLD);
    expect(t.isMastered('a')).toBe(true);
  });

  it('honours a custom threshold', () => {
    const t = new SkillTracker({ defaultParams: PARAMS, threshold: 0.6 });
    t.set('a', 0.65);
    expect(t.isMastered('a')).toBe(true);
  });

  it('allMastered treats an empty set as nothing left to teach', () => {
    expect(trackerWith().allMastered([])).toBe(true);
  });

  /**
   * OATutor's graduation check scanned every skill in `bktParams` rather than the lesson's
   * objectives (`Platform.js:428-433`), so with hundreds of KCs loaded it never fired. Scoped here.
   */
  it('graduates on the lesson objectives alone, ignoring unrelated skills', () => {
    const t = trackerWith('obj-1', 'obj-2', 'unrelated');
    t.set('obj-1', 0.97);
    t.set('obj-2', 0.96);
    t.set('unrelated', 0.01);
    expect(t.hasGraduated(['obj-1', 'obj-2'])).toBe(true);
  });

  it('honours a per-objective target, which the original left vestigial', () => {
    const t = trackerWith('easy', 'hard');
    t.set('easy', 0.75);
    t.set('hard', 0.99);
    expect(t.hasGraduated({ easy: 0.7, hard: 0.95 })).toBe(true);
    expect(t.hasGraduated({ easy: 0.8, hard: 0.95 })).toBe(false);
    // The global cutoff would have failed `easy` at 0.75.
    expect(t.hasGraduated(['easy', 'hard'])).toBe(false);
  });

  it('never graduates an empty objective set', () => {
    expect(trackerWith().hasGraduated([])).toBe(false);
    expect(trackerWith().hasGraduated({})).toBe(false);
  });
});

describe('per-skill params over a global default', () => {
  it('falls back to the default for unlisted skills', () => {
    const t = new SkillTracker({
      defaultParams: PARAMS,
      params: { special: { pInit: 0.8, pLearn: 0.5, pGuess: 0.25, pSlip: 0.05, pForget: 0 } },
    });
    expect(t.get('special')).toBe(0.8);
    expect(t.get('ordinary')).toBe(0.3);
    expect(t.paramsFor('ordinary')).toEqual(PARAMS);
  });

  it('lets a fast-learning skill outpace a slow one on identical evidence', () => {
    const t = new SkillTracker({
      defaultParams: PARAMS,
      params: {
        fast: { ...PARAMS, pLearn: 0.6 },
        slow: { ...PARAMS, pLearn: 0.02 },
      },
    });
    t.observeStep('s', ['fast', 'slow'], true);
    expect(t.get('fast')).toBeGreaterThan(t.get('slow'));
  });

  it('accepts a params override installed after construction', () => {
    const t = new SkillTracker({ defaultParams: PARAMS });
    t.setParams('a', { ...PARAMS, pInit: 0.55 });
    expect(t.get('a')).toBe(0.55);
  });

  it('applies per-item guess/slip without persisting it (pyBKT multigs)', () => {
    const mcq = trackerWith('a');
    const free = trackerWith('a');
    // A 4-option MCQ answered correctly is weaker evidence than free text answered correctly.
    mcq.observeStep('s', ['a'], true, { itemParams: { pGuess: 0.25 } });
    free.observeStep('s', ['a'], true, { itemParams: { pGuess: 0.0 } });
    expect(mcq.get('a')).toBeLessThan(free.get('a'));
    // The override was per-observation only.
    expect(mcq.paramsFor('a')).toEqual(PARAMS);
  });
});

describe('prediction', () => {
  it('predicts a step as the product of its per-skill predictions', () => {
    const t = trackerWith('a', 'b');
    t.set('a', 0.9);
    t.set('b', 0.9);
    expect(t.predictStep(['a', 'b'])).toBeCloseTo(t.predict('a') * t.predict('b'), 12);
  });

  it('rises as the learner improves', () => {
    const t = trackerWith('a');
    const cold = t.predict('a');
    for (let i = 0; i < 5; i++) t.observeStep(`s${i}`, ['a'], true);
    expect(t.predict('a')).toBeGreaterThan(cold);
  });
});

describe('snapshot / restore', () => {
  it('round-trips mastery, params and the step ledger', () => {
    const t = trackerWith('a', 'b');
    t.observeStep('s1', ['a', 'b'], true);
    t.observeStep('s2', ['a'], false);
    const snap = t.snapshot();

    const fresh = new SkillTracker({ defaultParams: PARAMS });
    fresh.restore(snap);
    expect(fresh.get('a')).toBeCloseTo(t.get('a'), 12);
    expect(fresh.get('b')).toBeCloseTo(t.get('b'), 12);
    expect(fresh.isStepScored('s1')).toBe(true);
    expect(fresh.isStepScored('s2')).toBe(true);
    expect(fresh.isStepScored('never')).toBe(false);
  });

  it('persists as a diff — untouched skills are not written out', () => {
    const t = trackerWith('moved', 'untouched');
    t.observeStep('s1', ['moved'], true);
    const snap = t.snapshot();
    expect(Object.keys(snap.mastery)).toEqual(['moved']);
  });

  it('survives a JSON round-trip, since this is what gets persisted', () => {
    const t = trackerWith('a');
    t.observeStep('s1', ['a'], true);
    const revived = new SkillTracker({ defaultParams: PARAMS });
    revived.restore(JSON.parse(JSON.stringify(t.snapshot())));
    expect(revived.get('a')).toBeCloseTo(t.get('a'), 12);
  });

  it('restore replaces state rather than merging into it', () => {
    const t = trackerWith('a');
    t.observeStep('s1', ['a'], true);
    t.restore({ version: 1, mastery: {}, params: {}, scoredSteps: [] });
    expect(t.isStepScored('s1')).toBe(false);
    // Back to the prior. Note restore() also drops the per-skill params from the snapshot, so the
    // tracker's constructor default is what answers now.
    expect(t.get('a')).toBe(PARAMS.pInit);
  });

  it('clone() carries state but is independent afterwards', () => {
    const t = trackerWith('a');
    t.observeStep('s1', ['a'], true);
    const c = t.clone();
    expect(c.get('a')).toBeCloseTo(t.get('a'), 12);
    c.observeStep('s2', ['a'], true);
    expect(c.get('a')).not.toBeCloseTo(t.get('a'), 6);
  });
});
