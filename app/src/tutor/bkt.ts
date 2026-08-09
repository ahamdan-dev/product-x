/**
 * Bayesian Knowledge Tracing — the whole model, as pure functions.
 *
 * Two-state HMM over a single latent skill: index 0 = unmastered, index 1 = mastered. Each
 * observation is one Bernoulli response, and each response drives two stages:
 *
 *   1. **condition** — Bayes-update the mastery belief on what we just saw
 *   2. **transition** — advance the belief through one learning opportunity
 *
 * Provenance for every equation here (reverse-engineered, see
 * `_refs/PRODUCT-X/TUTOR-ENGINE-REVERSE-ENGINEERING.md` §10.3):
 *   - stages 1 + 2 with `pForget = 0`: OATutor `src/models/BKT/BKT-brain.js:4-13`
 *   - stage 2 general form: pyBKT transition matrix `As`, `fit/EM_fit.py:72-74`, where
 *     `learns = A[1,0]` and `forgets = A[0,1]` (`models/Model.py:431-432`), applied as `A · alpha`
 *     (`EM_fit.py:205`)
 *   - stage 1 emission values: pyBKT `Bn`, `fit/EM_fit.py:80-82`
 *   - `predictCorrect`: pyBKT `fit/predict_onestep.py:36`
 *
 * Deliberate divergences from OATutor's original:
 *   - **Pure, not mutating.** `BKT-brain.js` mutated `model.probMastery` in place on an object
 *     shared through React context, which made mastery global mutable state. Everything here
 *     returns a new number.
 *   - **`pForget` is in the general form.** OATutor has no forgetting at all, so its mastery is
 *     monotonically non-decreasing — wrong for medical education with long inter-session gaps.
 *   - **NaN is fatal, not silent.** A single NaN mastery estimate propagates through every
 *     subsequent update, every aggregate, and every selection decision while looking like a
 *     rendering bug three layers away. We throw at the boundary instead.
 */

export interface BktParams {
  /** P(L₀) — prior probability the learner already knows this before any evidence. */
  pInit: number;
  /** P(T) — unmastered → mastered per learning opportunity. */
  pLearn: number;
  /** P(G) — P(correct | unmastered). A 4-option MCQ is ≈0.25; free response ≈0. */
  pGuess: number;
  /** P(S) — P(incorrect | mastered). Knows it, fumbled it. */
  pSlip: number;
  /** P(F) — mastered → unmastered per opportunity. 0 for standard BKT. */
  pForget: number;
}

/**
 * Cold-start parameters, used for any skill the content author didn't tune. OATutor hand-authors
 * these per knowledge component in `bkt-params/*.json`; we do the same, and these are the fallback.
 *
 * Ranges follow pyBKT's own initializer bounds (`generate/random_model_uni.py:27-36`:
 * learn ≤ 0.40, guess ≤ 0.40, slip ≤ 0.30) and satisfy the identifiability guard
 * `pGuess + pSlip < 1`.
 *
 * `pForget` is **0 on purpose**, which is a divergence from the report's recommendation to switch
 * forgetting on. Reason: this product already models decay properly, in real elapsed time, via
 * `retrievability()` in `src/learner/model.ts`. BKT's `pForget` decays per *opportunity*, so
 * turning both on would charge the learner twice for the same forgetting — and it would charge it
 * for practising, which is backwards. The general form supports it (see `transition`) so any
 * skill can opt in explicitly.
 */
export const DEFAULT_PARAMS: BktParams = {
  pInit: 0.20,
  pLearn: 0.20,
  pGuess: 0.20,
  pSlip: 0.10,
  pForget: 0,
};

/**
 * Mastery cutoff. 0.95 is not arbitrary — it is the same number in both source implementations,
 * arrived at independently: OATutor `src/config/config.js:111` (`MASTERY_THRESHOLD = 0.95`) and
 * pyBKT `models/Roster.py:11` (default `mastery_state`).
 */
export const MASTERY_THRESHOLD = 0.95;

/**
 * Reject anything that cannot be a probability, then squeeze the survivor into [0,1].
 *
 * Clamping rather than throwing on out-of-range is deliberate: floating-point drift can put a
 * legitimate result at 1.0000000000000002, and that is not worth a crash. NaN and ±Infinity are a
 * different story — they are always a real bug upstream, and they are silent, so they throw.
 */
function prob(value: number, label: string): number {
  if (Number.isNaN(value)) {
    throw new TypeError(
      `bkt: ${label} is NaN. Refusing to continue — a NaN mastery estimate poisons every ` +
      `later update and every aggregate that reads it, and surfaces as an unrelated bug later.`,
    );
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`bkt: ${label} is ${String(value)}, which is not a probability.`);
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Validate + clamp a whole parameter set. Throws on any NaN field. */
export function normalizeParams(params: BktParams): BktParams {
  return {
    pInit: prob(params.pInit, 'pInit'),
    pLearn: prob(params.pLearn, 'pLearn'),
    pGuess: prob(params.pGuess, 'pGuess'),
    pSlip: prob(params.pSlip, 'pSlip'),
    pForget: prob(params.pForget, 'pForget'),
  };
}

/**
 * The conventional identifiability guard. If `pGuess + pSlip >= 1` the two latent states swap
 * meaning — "mastered" starts predicting wrong answers — and every number the model produces
 * reads backwards. Not enforced (fitted params can legitimately sit near the boundary), but
 * exposed so content validation can warn.
 */
export function isIdentifiable(params: BktParams): boolean {
  const p = normalizeParams(params);
  return p.pGuess + p.pSlip < 1;
}

/** Starting mastery belief for a skill with no evidence at all. */
export function initMastery(params: BktParams): number {
  return normalizeParams(params).pInit;
}

/**
 * Stage 1 — Bayes conditioning on one observation.
 *
 * ```
 *                        L · (1 − pSlip)
 *  P(L | correct)   = ─────────────────────────────────
 *                     L · (1 − pSlip) + (1 − L) · pGuess
 *
 *                          L · pSlip
 *  P(L | incorrect) = ─────────────────────────────────────
 *                     L · pSlip + (1 − L) · (1 − pGuess)
 * ```
 *
 * **The zero-denominator guard.** Degenerate parameters can make both terms zero — e.g.
 * `pGuess = 0` with `L = 0` and a correct answer, or `pSlip = 0` with `L = 1` and an incorrect
 * one. The naive expression yields `0 / 0 = NaN`. pyBKT hits the same case in its likelihood
 * accumulation and handles it by substituting 1 for a zero emission probability —
 * `likelihoods[:,t] *= np.where(sl == 0, 1, sl)` (`fit/EM_fit.py:176`) — which makes the
 * observation *uninformative* rather than impossible: multiplying by 1 leaves the belief
 * untouched. We do exactly the same thing by returning the prior unchanged. The alternative
 * readings (return 0, return 0.5) both invent information the observation cannot carry.
 */
export function condition(pMastery: number, correct: boolean, params: BktParams): number {
  const L = prob(pMastery, 'pMastery');
  const p = normalizeParams(params);

  const num = correct ? L * (1 - p.pSlip) : L * p.pSlip;
  const other = correct ? (1 - L) * p.pGuess : (1 - L) * (1 - p.pGuess);
  const denom = num + other;

  // See the guard note above: a zero-probability observation carries no information, so the
  // posterior is the prior. This is the `np.where(sl == 0, 1, sl)` behaviour, not a fudge.
  if (denom === 0) return L;

  return prob(num / denom, 'posterior');
}

/**
 * Stage 2 — the transition / learning step, in the general form that includes forgetting:
 *
 * ```
 *  L' = P(L | obs) · (1 − pForget) + (1 − P(L | obs)) · pLearn
 * ```
 *
 * With `pForget = 0` this collapses to the form OATutor implements
 * (`BKT-brain.js:13`): `L' = posterior + (1 − posterior) · pLearn`.
 */
export function transition(pConditioned: number, params: BktParams): number {
  const c = prob(pConditioned, 'pConditioned');
  const p = normalizeParams(params);
  return prob(c * (1 - p.pForget) + (1 - c) * p.pLearn, 'pMastery');
}

/** One full forward update for one observation. Pure — returns the new mastery belief. */
export function updateBkt(pMastery: number, correct: boolean, params: BktParams): number {
  return transition(condition(pMastery, correct, params), params);
}

/**
 * P(the next response is correct), marginalising over the mastery belief:
 *
 * ```
 *  P(correct) = L · (1 − pSlip) + (1 − L) · pGuess
 * ```
 *
 * This is a convex combination of `pGuess` and `1 − pSlip`, so it is always bracketed by those
 * two numbers — which is what makes it usable as a difficulty estimate. It is also what
 * `zoneOfProximalDevelopment` in `select.ts` optimises against.
 */
export function predictCorrect(pMastery: number, params: BktParams): number {
  const L = prob(pMastery, 'pMastery');
  const p = normalizeParams(params);
  return prob(L * (1 - p.pSlip) + (1 - L) * p.pGuess, 'pCorrect');
}

/** Has this belief crossed the mastery cutoff? */
export function hasMastered(pMastery: number, threshold = MASTERY_THRESHOLD): boolean {
  return prob(pMastery, 'pMastery') >= threshold;
}

/**
 * Replay a whole response sequence from the prior. Returns the mastery belief *after* each
 * response, so `out.length === responses.length`. Useful for verification and for rebuilding a
 * learner's trajectory from an event log without storing intermediate state.
 */
export function runSequence(responses: readonly boolean[], params: BktParams): number[] {
  let L = initMastery(params);
  const out: number[] = [];
  for (const correct of responses) {
    L = updateBkt(L, correct, params);
    out.push(L);
  }
  return out;
}
