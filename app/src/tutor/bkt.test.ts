import { describe, it, expect } from 'vitest';
import {
  condition, transition, updateBkt, predictCorrect, runSequence,
  initMastery, hasMastered, normalizeParams, isIdentifiable,
  DEFAULT_PARAMS, MASTERY_THRESHOLD,
  type BktParams,
} from './bkt';

/** The exact parameter set the reverse-engineering report works its traces with (§10.5). */
const REPORT: BktParams = { pInit: 0.3, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1, pForget: 0 };

/**
 * The report quotes `L' = 0.692682` and `L' = 0.145762`, but those are the exact values
 * **truncated** at the sixth decimal, not rounded — the true values are 0.6926829268… and
 * 0.1457627118…, and rounding would have given `0.692683` / `0.145763`.
 *
 * That matters here because `toBeCloseTo(x, 6)` asserts `|actual − x| < 0.5e-6`, and the
 * truncation error against the correct answer is 9.3e-7 — larger than the tolerance. So asserting
 * the report's printed digits at precision 6 would fail against a *correct* implementation.
 *
 * Resolution: pin the exact closed-form values at precision 6 (below), and separately assert the
 * report's printed digits at the precision they were actually printed to. Both are checked, so a
 * regression can't hide in the gap.
 */
const EXACT_CORRECT = 28.4 / 41;     // 0.27/0.41 then + 0.1·(1 − that) — see the trace test
const EXACT_INCORRECT = 8.6 / 59;

describe('the worked traces from the report — regression pins', () => {
  it('one correct answer takes 0.3 to 0.692682…', () => {
    // condition:  num = 0.3 × 0.9 = 0.27 ; other = 0.7 × 0.2 = 0.14 ; post = 0.27/0.41
    // transition: L' = post + (1 − post) × 0.1
    const post = condition(0.3, true, REPORT);
    expect(post).toBeCloseTo(0.658536, 5);          // report: 0.658536… (also truncated)
    expect(post).toBeCloseTo(0.27 / 0.41, 12);

    const next = updateBkt(0.3, true, REPORT);
    expect(next).toBeCloseTo(EXACT_CORRECT, 6);
    // The report's own printed digits, at the precision it printed them.
    expect(next).toBeCloseTo(0.692682, 5);
    expect(next.toFixed(6)).toBe('0.692683');       // rounds up; the report truncated
  });

  it('one incorrect answer takes 0.3 to 0.145762…', () => {
    // condition:  num = 0.3 × 0.1 = 0.03 ; other = 0.7 × 0.8 = 0.56 ; post = 0.03/0.59
    const post = condition(0.3, false, REPORT);
    expect(post).toBeCloseTo(0.050847, 5);
    expect(post).toBeCloseTo(0.03 / 0.59, 12);

    const next = updateBkt(0.3, false, REPORT);
    expect(next).toBeCloseTo(EXACT_INCORRECT, 6);
    expect(next).toBeCloseTo(0.145762, 5);
    expect(next.toFixed(6)).toBe('0.145763');
  });

  it('and predicts the next response at 0.684878…', () => {
    const next = updateBkt(0.3, true, REPORT);
    expect(predictCorrect(next, REPORT)).toBeCloseTo(0.684878, 5);
  });

  it('reproduces the same numbers through runSequence, from the prior', () => {
    expect(runSequence([true], REPORT)[0]).toBeCloseTo(EXACT_CORRECT, 6);
    expect(runSequence([false], REPORT)[0]).toBeCloseTo(EXACT_INCORRECT, 6);
    expect(initMastery(REPORT)).toBe(0.3);
  });
});

describe('monotonicity under repeated correct answers', () => {
  it('never goes down, and converges up toward 1', () => {
    const trace = runSequence(new Array(60).fill(true), REPORT);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]!).toBeGreaterThanOrEqual(trace[i - 1]!);
    }
    expect(trace.at(-1)!).toBeGreaterThan(0.99);
    expect(trace.at(-1)!).toBeLessThanOrEqual(1);
  });

  it('holds for a spread of parameter sets, not just the report\'s', () => {
    const sets: BktParams[] = [
      DEFAULT_PARAMS,
      { pInit: 0.05, pLearn: 0.02, pGuess: 0.35, pSlip: 0.25, pForget: 0 },
      { pInit: 0.9, pLearn: 0.4, pGuess: 0.02, pSlip: 0.02, pForget: 0 },
    ];
    for (const p of sets) {
      const trace = runSequence(new Array(40).fill(true), p);
      for (let i = 1; i < trace.length; i++) {
        expect(trace[i]!).toBeGreaterThanOrEqual(trace[i - 1]! - 1e-12);
      }
    }
  });

  it('is only non-decreasing because pForget is 0 — that is the load-bearing assumption', () => {
    expect(DEFAULT_PARAMS.pForget).toBe(0);
    expect(REPORT.pForget).toBe(0);
  });
});

/**
 * The intuitive claim is "a correct answer raises mastery more than an incorrect one lowers it".
 * That is true near the floor and **false near the ceiling**, and it has to be: at L = 0.95 there
 * is only 0.05 of headroom to gain, while there is 0.95 of room to lose. For the report's params
 * the crossover sits between L = 0.50 and L = 0.55.
 *
 * The invariant that actually holds everywhere is the *ordering* one: whatever the prior, being
 * right leaves you strictly better off than being wrong. That is the property worth pinning, since
 * it is the one a broken sign or a swapped branch would violate.
 */
describe('correct beats incorrect, always', () => {
  it('leaves mastery strictly higher than the same answer marked wrong, at every prior', () => {
    for (let L = 0.001; L < 1; L += 0.001) {
      expect(updateBkt(L, true, REPORT)).toBeGreaterThan(updateBkt(L, false, REPORT));
    }
  });

  it('holds for any identifiable params, i.e. whenever pGuess < 1 − pSlip', () => {
    const sets: BktParams[] = [
      DEFAULT_PARAMS,
      { pInit: 0.5, pLearn: 0.4, pGuess: 0.35, pSlip: 0.25, pForget: 0 },
      { pInit: 0.1, pLearn: 0.05, pGuess: 0.02, pSlip: 0.02, pForget: 0 },
      { pInit: 0.4, pLearn: 0.2, pGuess: 0.25, pSlip: 0.3, pForget: 0.05 },
    ];
    for (const p of sets) {
      expect(p.pGuess).toBeLessThan(1 - p.pSlip);
      expect(isIdentifiable(p)).toBe(true);
      for (let L = 0.01; L < 1; L += 0.01) {
        expect(updateBkt(L, true, p)).toBeGreaterThan(updateBkt(L, false, p));
      }
    }
  });

  it('gains more than it loses while mastery is low — and stops doing so past the crossover', () => {
    const gain = (L: number) => updateBkt(L, true, REPORT) - L;
    const loss = (L: number) => L - updateBkt(L, false, REPORT);

    for (const L of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5]) {
      expect(gain(L)).toBeGreaterThan(loss(L));
    }
    // Past the crossover the asymmetry reverses. Documented, not a bug: there is no headroom left.
    for (const L of [0.6, 0.75, 0.9]) {
      expect(gain(L)).toBeLessThan(loss(L));
    }
  });
});

describe('forgetting', () => {
  it('decays a confident learner who stops being observed favourably', () => {
    const forgetful: BktParams = { ...REPORT, pForget: 0.2 };
    // Transition alone, applied repeatedly to a near-certain belief, must fall.
    let L = 0.99;
    const first = L;
    for (let i = 0; i < 5; i++) L = transition(L, forgetful);
    expect(L).toBeLessThan(first);
  });

  it('caps a perfect-streak learner below 1, unlike standard BKT', () => {
    const forgetful: BktParams = { ...REPORT, pForget: 0.2 };
    const withForget = runSequence(new Array(50).fill(true), forgetful).at(-1)!;
    const without = runSequence(new Array(50).fill(true), REPORT).at(-1)!;
    expect(withForget).toBeLessThan(without);
    expect(withForget).toBeLessThan(0.99);
    expect(withForget).toBeGreaterThan(0.5);       // still learns, just not to certainty
  });

  it('makes an incorrect answer hurt more than it would without forgetting', () => {
    const forgetful: BktParams = { ...REPORT, pForget: 0.3 };
    expect(updateBkt(0.8, false, forgetful)).toBeLessThan(updateBkt(0.8, false, REPORT));
  });

  it('reduces to the standard OATutor form when pForget is 0', () => {
    // OATutor BKT-brain.js:13 — L' = post + (1 − post) · pTransit
    const post = condition(0.42, true, REPORT);
    expect(transition(post, REPORT)).toBeCloseTo(post + (1 - post) * REPORT.pLearn, 12);
  });
});

describe('the zero-denominator guard', () => {
  it('returns the prior instead of NaN when a correct answer has probability 0', () => {
    // pGuess = 0 and L = 0: a correct answer is impossible under the model.
    const p: BktParams = { pInit: 0, pLearn: 0, pGuess: 0, pSlip: 0, pForget: 0 };
    const out = condition(0, true, p);
    expect(Number.isNaN(out)).toBe(false);
    expect(out).toBe(0);
  });

  it('returns the prior instead of NaN when an incorrect answer has probability 0', () => {
    // pSlip = 0 and L = 1: an incorrect answer is impossible under the model.
    const p: BktParams = { pInit: 1, pLearn: 0, pGuess: 1, pSlip: 0, pForget: 0 };
    const out = condition(1, false, p);
    expect(Number.isNaN(out)).toBe(false);
    expect(out).toBe(1);
  });

  it('never yields NaN across a brute-force sweep of degenerate corners', () => {
    const edge = [0, 0.5, 1];
    for (const pGuess of edge) for (const pSlip of edge)
      for (const pLearn of edge) for (const pForget of edge)
        for (const L of [0, 0.5, 1]) for (const correct of [true, false]) {
          const p: BktParams = { pInit: L, pLearn, pGuess, pSlip, pForget };
          const out = updateBkt(L, correct, p);
          expect(Number.isNaN(out)).toBe(false);
          expect(out).toBeGreaterThanOrEqual(0);
          expect(out).toBeLessThanOrEqual(1);
        }
  });
});

describe('extreme parameters do not crash', () => {
  it('survives all-zero params', () => {
    const p: BktParams = { pInit: 0, pLearn: 0, pGuess: 0, pSlip: 0, pForget: 0 };
    expect(updateBkt(0, true, p)).toBe(0);
    expect(updateBkt(0, false, p)).toBe(0);
    expect(predictCorrect(0, p)).toBe(0);
  });

  it('survives all-one params', () => {
    const p: BktParams = { pInit: 1, pLearn: 1, pGuess: 1, pSlip: 1, pForget: 1 };
    expect(Number.isNaN(updateBkt(1, true, p))).toBe(false);
    expect(Number.isNaN(updateBkt(0.5, false, p))).toBe(false);
    expect(predictCorrect(0.5, p)).toBeGreaterThanOrEqual(0);
  });

  it('clamps out-of-range inputs rather than propagating them', () => {
    expect(updateBkt(-5, true, REPORT)).toBeGreaterThanOrEqual(0);
    expect(updateBkt(42, true, REPORT)).toBeLessThanOrEqual(1);
    const wild: BktParams = { pInit: -1, pLearn: 9, pGuess: -2, pSlip: 7, pForget: -3 };
    expect(normalizeParams(wild)).toEqual({
      pInit: 0, pLearn: 1, pGuess: 0, pSlip: 1, pForget: 0,
    });
  });

  it('keeps every result inside [0,1] over a wide random sweep', () => {
    let seed = 20260808;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 4000; i++) {
      const p: BktParams = {
        pInit: rand(), pLearn: rand(), pGuess: rand(), pSlip: rand(), pForget: rand(),
      };
      const out = updateBkt(rand(), rand() > 0.5, p);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
      expect(Number.isNaN(out)).toBe(false);
    }
  });
});

describe('NaN is fatal, by design', () => {
  it('throws on a NaN mastery rather than returning one', () => {
    expect(() => condition(NaN, true, REPORT)).toThrow(/NaN/);
    expect(() => updateBkt(NaN, true, REPORT)).toThrow(/NaN/);
    expect(() => predictCorrect(NaN, REPORT)).toThrow(/NaN/);
    expect(() => hasMastered(NaN)).toThrow(/NaN/);
  });

  it('throws on a NaN parameter, naming the field', () => {
    expect(() => updateBkt(0.5, true, { ...REPORT, pSlip: NaN })).toThrow(/pSlip/);
    expect(() => updateBkt(0.5, true, { ...REPORT, pGuess: NaN })).toThrow(/pGuess/);
    expect(() => updateBkt(0.5, true, { ...REPORT, pLearn: NaN })).toThrow(/pLearn/);
    expect(() => updateBkt(0.5, true, { ...REPORT, pForget: NaN })).toThrow(/pForget/);
    expect(() => initMastery({ ...REPORT, pInit: NaN })).toThrow(/pInit/);
  });

  it('throws on infinities too', () => {
    expect(() => condition(Infinity, true, REPORT)).toThrow(/probability/);
    expect(() => updateBkt(0.5, true, { ...REPORT, pLearn: -Infinity })).toThrow(/probability/);
  });
});

describe('predictCorrect is bracketed by [pGuess, 1 − pSlip]', () => {
  it('is a convex combination of the two emission probabilities', () => {
    for (let L = 0; L <= 1; L += 0.02) {
      const p = predictCorrect(L, REPORT);
      expect(p).toBeGreaterThanOrEqual(REPORT.pGuess - 1e-12);
      expect(p).toBeLessThanOrEqual(1 - REPORT.pSlip + 1e-12);
    }
  });

  it('hits exactly pGuess at zero mastery and 1 − pSlip at full mastery', () => {
    expect(predictCorrect(0, REPORT)).toBeCloseTo(REPORT.pGuess, 12);
    expect(predictCorrect(1, REPORT)).toBeCloseTo(1 - REPORT.pSlip, 12);
  });

  it('stays inside the bracket for arbitrary identifiable params', () => {
    const sets: BktParams[] = [
      DEFAULT_PARAMS,
      { pInit: 0.5, pLearn: 0.4, pGuess: 0.35, pSlip: 0.25, pForget: 0 },
      { pInit: 0.1, pLearn: 0.05, pGuess: 0.02, pSlip: 0.02, pForget: 0.1 },
    ];
    for (const p of sets) {
      const lo = Math.min(p.pGuess, 1 - p.pSlip);
      const hi = Math.max(p.pGuess, 1 - p.pSlip);
      for (let L = 0; L <= 1; L += 0.05) {
        const v = predictCorrect(L, p);
        expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(v).toBeLessThanOrEqual(hi + 1e-12);
      }
    }
  });

  it('increases with mastery, so it is usable as a difficulty estimate', () => {
    let prev = -1;
    for (let L = 0; L <= 1; L += 0.05) {
      const v = predictCorrect(L, REPORT);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('the mastery threshold', () => {
  it('is 0.95 — the same constant both source implementations landed on', () => {
    // OATutor src/config/config.js:111 and pyBKT models/Roster.py:11.
    expect(MASTERY_THRESHOLD).toBe(0.95);
  });

  it('is inclusive at the boundary', () => {
    expect(hasMastered(0.95)).toBe(true);
    expect(hasMastered(0.9499999)).toBe(false);
    expect(hasMastered(0.5, 0.5)).toBe(true);
  });
});

describe('purity', () => {
  it('never mutates the params object it is handed', () => {
    // OATutor's update() mutated model.probMastery in place on a context-shared object
    // (BKT-brain.js:13). This is the regression test for not doing that.
    const p: BktParams = { ...REPORT };
    const frozen = JSON.stringify(p);
    runSequence([true, false, true, true, false], p);
    expect(JSON.stringify(p)).toBe(frozen);
  });

  it('is deterministic — the same inputs give bit-identical outputs', () => {
    const a = runSequence([true, false, true], REPORT);
    const b = runSequence([true, false, true], REPORT);
    expect(a).toEqual(b);
  });
});
