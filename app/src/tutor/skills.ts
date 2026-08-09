/**
 * The knowledge-component layer — one BKT belief per skill, plus the step→skills indirection.
 *
 * This is OATutor's Q-matrix idea (`skillModel.json` maps step id → KC array, attached to steps at
 * `src/platform-logic/Platform.js:53-64`) with the learner state kept in one owned place instead of
 * smeared across a React context object.
 *
 * Three deliberate divergences from the original, all of them corrections. Each is called out at
 * the method that implements it:
 *   1. `observe` updates **every** KC on a multi-KC step. OATutor updates only the first.
 *   2. `weakest` breaks ties deterministically. OATutor used `Math.random()`.
 *   3. `stepMastery` is available as a product (parity) *and* a geometric mean (recommended),
 *      because the raw product systematically ranks long problems as "hardest".
 */

import {
  DEFAULT_PARAMS, MASTERY_THRESHOLD, initMastery, updateBkt, predictCorrect, hasMastered,
  type BktParams,
} from './bkt';

/** Options for a single observation. */
export interface ObserveOptions {
  /**
   * Is this the learner's first attempt at the step? Only first attempts move the model —
   * the standard BKT convention, and OATutor's (`Problem.js:260-263`).
   *
   * Defaults to `true`: a bare `observe(skill, correct)` is a scored observation. Pass `false` for
   * retries. Prefer `observeStep()`, which tracks this for you and is the reason the multi-KC bug
   * cannot recur.
   */
  firstAttempt?: boolean;
  /**
   * Per-item guess/slip override — pyBKT's `multigs` / KT-IDEM variant (report §10.7), the
   * cheapest large accuracy gain available. A 4-option MCQ deserves `pGuess ≈ 0.25`; a free-text
   * answer ≈ 0. Merged over the skill's params for this observation only, never persisted.
   */
  itemParams?: Partial<Pick<BktParams, 'pGuess' | 'pSlip'>>;
}

/** Serialized learner state. Deliberately plain JSON — this is what gets persisted. */
export interface SkillSnapshot {
  version: 1;
  mastery: Record<string, number>;
  /** Only skills whose params were explicitly overridden, so the default can evolve. */
  params: Record<string, BktParams>;
  /** Steps already scored, so a restore doesn't re-open first-attempt credit. */
  scoredSteps: string[];
}

export interface SkillTrackerOptions {
  /** Global fallback params for any skill without an explicit entry. */
  defaultParams?: BktParams;
  /** Per-skill parameter overrides — OATutor's `bkt-params/*.json`. */
  params?: Record<string, BktParams>;
  /** Mastery cutoff. Defaults to the shared 0.95. */
  threshold?: number;
}

export class SkillTracker {
  /** P(mastery) per skill. The entire learner state for this layer, plus the step ledger. */
  private masteryBySkill = new Map<string, number>();
  private paramsBySkill = new Map<string, BktParams>();
  private readonly defaults: BktParams;
  private readonly threshold: number;
  /** Steps that have already consumed their first-attempt credit. */
  private scoredSteps = new Set<string>();

  constructor(opts: SkillTrackerOptions = {}) {
    this.defaults = opts.defaultParams ?? DEFAULT_PARAMS;
    this.threshold = opts.threshold ?? MASTERY_THRESHOLD;
    for (const [skillId, p] of Object.entries(opts.params ?? {})) {
      this.paramsBySkill.set(skillId, p);
    }
  }

  /** Params for a skill: explicit override, else the global default. */
  paramsFor(skillId: string): BktParams {
    return this.paramsBySkill.get(skillId) ?? this.defaults;
  }

  /** Install or replace one skill's params. */
  setParams(skillId: string, params: BktParams): void {
    this.paramsBySkill.set(skillId, params);
  }

  /**
   * Current mastery belief for a skill. A skill never seen before sits at its prior `pInit`
   * rather than at 0 — that is what a prior *is*, and returning 0 would understate every
   * unseen skill and wreck selection ordering.
   */
  get(skillId: string): number {
    const known = this.masteryBySkill.get(skillId);
    return known ?? initMastery(this.paramsFor(skillId));
  }

  /** Overwrite a belief outright. For restore paths and tests, not for scoring. */
  set(skillId: string, pMastery: number): void {
    this.masteryBySkill.set(skillId, pMastery);
  }

  /** Every skill with either a belief or authored params. */
  skills(): string[] {
    return [...new Set([...this.masteryBySkill.keys(), ...this.paramsBySkill.keys()])].sort();
  }

  /**
   * Record one observation against one skill. Returns the new mastery belief.
   *
   * `firstAttempt: false` is a no-op by design — later attempts at the same step carry almost no
   * information once the learner has seen feedback, and counting them lets a learner grind a step
   * to mastery by retrying. OATutor gates the same way (`Problem.js:260-263`).
   */
  observe(skillId: string, correct: boolean, opts: ObserveOptions = {}): number {
    const firstAttempt = opts.firstAttempt ?? true;
    const before = this.get(skillId);
    if (!firstAttempt) return before;

    const base = this.paramsFor(skillId);
    // Per-item guess/slip (multigs) applies to this observation only.
    const params: BktParams = opts.itemParams ? { ...base, ...opts.itemParams } : base;

    const after = updateBkt(before, correct, params);
    this.masteryBySkill.set(skillId, after);
    return after;
  }

  /**
   * Record one observation against a step's whole KC set, honouring first-attempt-only scoring.
   *
   * ┌─────────────────────────────────────────────────────────────────────────────────────────┐
   * │ REAL BUG IN THE ORIGINAL — DO NOT "FIX" THIS BACK.                                      │
   * │                                                                                          │
   * │ OATutor `src/components/problem-layout/Problem.js:260-263`:                              │
   * │                                                                                          │
   * │     for (const kc of _kcArray) {                                                         │
   * │         ...                                                                              │
   * │         if (this.doMasteryUpdate && (firstAttempts[cardIndex] === undefined ||            │
   * │                                      firstAttempts[cardIndex] === false)) {              │
   * │             firstAttempts[cardIndex] = true;   // <-- set INSIDE the KC loop              │
   * │             update(this.bktParams[kc], isCorrect);                                       │
   * │         }                                                                                │
   * │     }                                                                                    │
   * │                                                                                          │
   * │ The first-attempt flag is assigned *inside* the loop, so on the second iteration the      │
   * │ guard is already false and every KC after the first is skipped. A step tagged with two    │
   * │ knowledge components only ever trains one of them — silently, and worse the more          │
   * │ carefully the content was tagged.                                                        │
   * │                                                                                          │
   * │ Correct behaviour, implemented here: score EVERY KC on the step, then mark the step       │
   * │ scored once, after the loop. The step ledger lives on the step id — not on a per-KC       │
   * │ flag — which is what makes the bug structurally unable to come back.                      │
   * └─────────────────────────────────────────────────────────────────────────────────────────┘
   */
  observeStep(
    stepId: string,
    skillIds: readonly string[],
    correct: boolean,
    opts: Omit<ObserveOptions, 'firstAttempt'> = {},
  ): boolean {
    if (this.scoredSteps.has(stepId)) return false;

    for (const skillId of dedupe(skillIds)) {
      this.observe(skillId, correct, { ...opts, firstAttempt: true });
    }

    // AFTER the loop. This single line is the bug fix.
    this.scoredSteps.add(stepId);
    return true;
  }

  /** Has this step already consumed its first-attempt credit? */
  isStepScored(stepId: string): boolean {
    return this.scoredSteps.has(stepId);
  }

  /** Forget that a step was scored — for practice recycling (OATutor's `allowRecycle`). */
  resetStep(stepId: string): void {
    this.scoredSteps.delete(stepId);
  }

  /**
   * "Can the learner do this step?" as the **product** of its KC masteries.
   *
   * This is OATutor's aggregation verbatim (`Platform.js:401`, `probMastery *= ...`) and is kept
   * for parity, but see `stepMasteryGeometric` — a product over 5 KCs at 0.8 each is 0.33, which
   * says a well-known 5-skill step is barely known. Prefer the geometric mean for anything
   * that *orders* items; use the product only where joint probability is genuinely what you mean.
   *
   * An empty skill list returns 1 (the empty product) — an untagged step blocks nothing.
   */
  stepMastery(skillIds: readonly string[]): number {
    let out = 1;
    for (const skillId of dedupe(skillIds)) out *= this.get(skillId);
    return out;
  }

  /**
   * Length-independent step mastery — the geometric mean of the KC masteries, recommended by the
   * report (§10.6) over the raw product. A 6-KC step and a 1-KC step at the same average
   * per-skill mastery score the same, which is what makes cross-item ordering meaningful.
   */
  stepMasteryGeometric(skillIds: readonly string[]): number {
    const ids = dedupe(skillIds);
    if (ids.length === 0) return 1;
    // Sum of logs rather than an nth root of a product: the product underflows to 0 for many
    // small factors, and log-space keeps the precision where we can still use it.
    let logSum = 0;
    for (const skillId of ids) {
      const m = this.get(skillId);
      if (m <= 0) return 0;
      logSum += Math.log(m);
    }
    return Math.exp(logSum / ids.length);
  }

  /**
   * The weakest of a set of skills — the remediation target.
   *
   * **Divergence from the original.** OATutor collects every tied-lowest candidate and picks with
   * `chosenProblem[Math.floor(Math.random() * chosenProblem.length)]`
   * (`defaultHeuristic.js:14`). We tie-break on the lowest skill id lexicographically instead.
   *
   * Why: a random tie-break makes the tutor unreproducible. The same learner state produces a
   * different lesson on every launch, "why did it pick that?" is unanswerable after the fact, and
   * no test of selection behaviour can be written that isn't flaky. Ties are also common early on,
   * when every skill still sits at an identical prior — exactly when the choice matters most.
   *
   * Returns null for an empty list.
   */
  weakest(skillIds: readonly string[]): string | null {
    let bestId: string | null = null;
    let bestMastery = Infinity;

    for (const skillId of dedupe(skillIds)) {
      const m = this.get(skillId);
      if (m < bestMastery || (m === bestMastery && bestId !== null && skillId < bestId)) {
        bestId = skillId;
        bestMastery = m;
      }
    }
    return bestId;
  }

  /** The strongest of a set of skills, same deterministic tie-break. */
  strongest(skillIds: readonly string[]): string | null {
    let bestId: string | null = null;
    let bestMastery = -Infinity;

    for (const skillId of dedupe(skillIds)) {
      const m = this.get(skillId);
      if (m > bestMastery || (m === bestMastery && bestId !== null && skillId < bestId)) {
        bestId = skillId;
        bestMastery = m;
      }
    }
    return bestId;
  }

  /** Has this one skill crossed the cutoff? */
  isMastered(skillId: string): boolean {
    return hasMastered(this.get(skillId), this.threshold);
  }

  /** Are all of these skills mastered? An empty set counts as mastered (nothing left to teach). */
  allMastered(skillIds: readonly string[]): boolean {
    return dedupe(skillIds).every(id => this.isMastered(id));
  }

  /** P(next response correct) for a skill — what the ZPD heuristic optimises against. */
  predict(skillId: string, itemParams?: ObserveOptions['itemParams']): number {
    const base = this.paramsFor(skillId);
    return predictCorrect(this.get(skillId), itemParams ? { ...base, ...itemParams } : base);
  }

  /**
   * P(correct) for a whole step: the learner has to get every KC right, so this is the product of
   * the per-skill predictions. Unlike `stepMastery` the product is correct here — these really are
   * independent events that must all land.
   */
  predictStep(skillIds: readonly string[], itemParams?: ObserveOptions['itemParams']): number {
    let out = 1;
    for (const skillId of dedupe(skillIds)) out *= this.predict(skillId, itemParams);
    return out;
  }

  /**
   * Aggregate mastery over a set of objectives — the mean, one function, tested.
   *
   * OATutor had two copies of this and one was broken: `Problem.js:267-283` does
   * `objectives.unshift(0)` then `reduce` with no seed (so the accumulator starts as the number 0)
   * then divides by `length - 1`. The other copy (`Platform.js:417-423`) is the correct mean.
   * Report fix #3: keep exactly one.
   */
  aggregateMastery(skillIds: readonly string[]): number {
    const ids = dedupe(skillIds);
    if (ids.length === 0) return 0;
    let sum = 0;
    for (const skillId of ids) sum += this.get(skillId);
    return sum / ids.length;
  }

  /**
   * Has the learner graduated the given objectives?
   *
   * **Divergence.** OATutor scans *every* skill in `bktParams` rather than the lesson's own
   * objectives (`Platform.js:428-433`), so with a few hundred KCs loaded the branch is effectively
   * unreachable and "graduated" never fires. Report fix #2: scope to the objectives passed in, and
   * honour a per-objective target when the content author set one (`learningObjectives` is a
   * `{ [kc]: number }` map whose value was vestigial in the original).
   */
  hasGraduated(objectives: readonly string[] | Record<string, number>): boolean {
    if (Array.isArray(objectives)) {
      return objectives.length > 0 && objectives.every(id => this.isMastered(id));
    }
    const entries = Object.entries(objectives as Record<string, number>);
    if (entries.length === 0) return false;
    return entries.every(([skillId, target]) =>
      this.get(skillId) >= (Number.isFinite(target) ? target : this.threshold));
  }

  /**
   * Serialize. Persists only skills that actually moved off their prior, which is OATutor's
   * persist-as-diff idea (`App.js:224-232`) — compact, and it lets an authored default change
   * later without being overwritten by a stale copy of itself.
   */
  snapshot(): SkillSnapshot {
    const mastery: Record<string, number> = {};
    for (const [skillId, value] of this.masteryBySkill) {
      if (value !== initMastery(this.paramsFor(skillId))) mastery[skillId] = value;
    }
    return {
      version: 1,
      mastery,
      params: Object.fromEntries(this.paramsBySkill),
      scoredSteps: [...this.scoredSteps].sort(),
    };
  }

  /** Restore from a snapshot, replacing all current state. */
  restore(snap: SkillSnapshot): void {
    this.masteryBySkill = new Map(Object.entries(snap.mastery ?? {}));
    this.paramsBySkill = new Map(Object.entries(snap.params ?? {}));
    this.scoredSteps = new Set(snap.scoredSteps ?? []);
  }

  /** A fresh tracker carrying the same params but no learner history. */
  clone(): SkillTracker {
    const next = new SkillTracker({ defaultParams: this.defaults, threshold: this.threshold });
    next.restore(this.snapshot());
    return next;
  }
}

/** Drop empties and duplicates, preserving first-seen order. OATutor's `cleanArray`. */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
