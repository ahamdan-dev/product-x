/**
 * Item selection — "what should the learner do next?"
 *
 * The seam is the one good idea in OATutor's selector: the policy is injected, not hardcoded
 * (`src/App.js:70-82` treatment-maps `heuristic` alongside the BKT params). We keep the seam and
 * throw away the implementation, because the original policy is a bare argmin with a random
 * tie-break (`defaultHeuristic.js`) and its A/B counterpart differs from it by one character.
 *
 * Three policies ship here. They are genuinely different pedagogies, not tuning knobs, and the
 * trade-off of each is documented at its definition. Default is `weakestFirst` for parity with
 * the original; `zoneOfProximalDevelopment` is the one to actually use.
 */

import { MASTERY_THRESHOLD } from './bkt';
import type { SkillTracker } from './skills';
import { retrievability, type ConceptState } from '../learner/model';

/** One selectable item — a step, a card, a case. Content-shaped fields stay out of here. */
export interface Candidate {
  id: string;
  /** Knowledge components this item exercises. Empty means untagged. */
  skillIds: readonly string[];
  /**
   * Learner-model states for this item's concepts, if the caller resolved them. Only
   * `spacedRetrieval` needs these; the other policies ignore the field.
   */
  conceptStates?: readonly ConceptState[];
  /** Per-item guess/slip (pyBKT `multigs`). An MCQ's pGuess is not a free-text item's pGuess. */
  itemParams?: { pGuess?: number; pSlip?: number };
  /** Author-declared difficulty 0..1, used only as a last-resort tie-break. */
  difficulty?: number;
}

/**
 * A selection policy. Returns the chosen candidate, or null when there is genuinely nothing to
 * pick — never throws, and never returns undefined.
 *
 * OATutor's returned `chosenProblem[Math.floor(Math.random() * 0)]` → `undefined` on an empty
 * list (`defaultHeuristic.js:14`), and the caller then compared `chosenProblem == null` to detect
 * it. Returning an explicit `null` from a typed signature makes that path checkable.
 */
export type SelectionHeuristic = (
  candidates: Candidate[],
  tracker: SkillTracker,
) => Candidate | null;

/** Target success rate for `zoneOfProximalDevelopment`. See the note there for why ~0.7. */
export const ZPD_TARGET = 0.7;

export interface SelectOptions {
  threshold?: number;
  /** Item ids already completed this session — skipped unless recycling. */
  completed?: ReadonlySet<string>;
  /** Clock for retrievability. Injected so tests aren't wall-clock dependent. */
  now?: number;
}

/**
 * Shared front half of every policy: drop what is already done, then prefer items that still have
 * something to teach.
 *
 * "Never return an item whose every skill is already mastered, unless nothing else remains" is
 * implemented as a two-tier fallback rather than a hard filter, because a hard filter turns a
 * fully-mastered pool into a dead end. OATutor's equivalent is `probMastery >= MASTERY_THRESHOLD`
 * → `continue` (`defaultHeuristic.js:9`), which does dead-end and is why the platform needs a
 * separate `exhausted` state and an `allowRecycle` escape hatch.
 */
function tiers(
  candidates: Candidate[],
  tracker: SkillTracker,
  opts: SelectOptions,
  /**
   * Escape hatch for a policy that has a legitimate reason to keep a BKT-mastered item in play.
   *
   * Only `spacedRetrieval` uses it, and it has to: BKT with `pForget = 0` cannot represent a skill
   * that was genuinely learned and has since decayed, so such a skill sits at 0.99 forever and the
   * mastery filter below would drop it — silently deleting the one thing the review policy exists
   * to find. Retrievability is a real, independent signal that the item still has work in it, so
   * "already mastered" is not true of it in the sense that matters here.
   */
  rescue?: (c: Candidate) => boolean,
): { pool: Candidate[]; wasFallback: boolean } {
  const threshold = opts.threshold ?? MASTERY_THRESHOLD;
  const completed = opts.completed;

  const live = completed ? candidates.filter(c => !completed.has(c.id)) : candidates.slice();
  if (live.length === 0) return { pool: [], wasFallback: false };

  const unmastered = live.filter(c =>
    c.skillIds.length === 0
    || !c.skillIds.every(id => tracker.get(id) >= threshold)
    || (rescue?.(c) ?? false));

  return unmastered.length > 0
    ? { pool: unmastered, wasFallback: false }
    : { pool: live, wasFallback: true };
}

/** Retrievability at or below this counts as "due for review" and rescues a mastered item. */
export const REVIEW_DUE_BELOW = 0.9;

/**
 * Deterministic argmin over a score. Ties break on candidate id, lexicographically.
 *
 * Every policy in this file routes through here, so "the tutor makes the same choice twice" is one
 * property of one function instead of a claim about three. That is the whole reason the original's
 * `Math.random()` tie-break had to go: a reproducible tutor can be tested, replayed, and explained
 * to the learner after the fact.
 */
function argminBy(pool: Candidate[], score: (c: Candidate) => number): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = Infinity;

  for (const c of pool) {
    const s = score(c);
    if (Number.isNaN(s)) continue;
    if (s < bestScore || (s === bestScore && best !== null && c.id < best.id)) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/**
 * **weakestFirst** — remediate. Picks the item whose skills the learner knows least.
 *
 * This is OATutor's `defaultHeuristic` (argmin of step mastery), minus the random tie-break.
 *
 * Trade-off: it is relentless. The learner spends every minute on their worst area, which is
 * correct triage but is also the most demoralising possible schedule — predicted success on the
 * chosen item is near the floor by construction, so the learner mostly fails. It is the right
 * policy for a short pre-exam gap-fill and the wrong one for daily study. Uses the geometric mean
 * rather than the raw product so a 6-KC item isn't automatically ranked weakest (report fix #6).
 */
export function weakestFirst(
  candidates: Candidate[],
  tracker: SkillTracker,
  opts: SelectOptions = {},
): Candidate | null {
  const { pool } = tiers(candidates, tracker, opts);
  return argminBy(pool, c => tracker.stepMasteryGeometric(c.skillIds));
}

/**
 * **zoneOfProximalDevelopment** — the hardest thing they can still probably do.
 *
 * Picks the item whose predicted P(correct) is closest to `ZPD_TARGET` (default 0.7). Neither
 * source repo has this; it is the pedagogically strongest of the three and should be the default
 * for ordinary study.
 *
 * Why ~0.7 and not 0.5 or 0.95: an item the learner is certain to get right carries no information
 * and no learning; an item they are certain to fail teaches nothing either and costs morale. The
 * informative band sits above chance and below certainty, and success rates in the 0.6–0.8 range
 * are where desirable difficulty and learner persistence overlap. The exact number is a tunable
 * constant on purpose — it is an empirical question, not a derived one.
 *
 * Trade-off: it will happily avoid a learner's worst skill for a long time, because a skill near
 * zero mastery yields a predicted P(correct) near `pGuess`, which is far from target. That is
 * usually right — you cannot build on a foundation that isn't there — but it means ZPD alone never
 * triages. Pair it with `weakestFirst` when a deadline is close.
 */
export function zoneOfProximalDevelopment(
  candidates: Candidate[],
  tracker: SkillTracker,
  opts: SelectOptions & { target?: number } = {},
): Candidate | null {
  const { pool } = tiers(candidates, tracker, opts);
  const target = opts.target ?? ZPD_TARGET;
  // Distance to target, so argmin picks "closest to target" with the same tie-break as everyone.
  return argminBy(pool, c => Math.abs(tracker.predictStep(c.skillIds, c.itemParams) - target));
}

/**
 * **spacedRetrieval** — due for review. Picks the item whose skills are least retrievable *right
 * now*, reading `retrievability()` from the existing learner model.
 *
 * This is the one policy that consults real elapsed time rather than the BKT belief, and it is the
 * only one that can catch a skill the learner genuinely earned and is now quietly losing — BKT
 * with `pForget = 0` cannot represent that at all, since its mastery never falls without a wrong
 * answer.
 *
 * Trade-off: it optimises durability, not progress. Left to run alone it will re-drill known
 * material forever and never introduce anything new, because a never-seen concept has
 * `lastRetrievedAt === null` and `retrievability()` returns 0 for it — which reads as *maximally*
 * urgent. That is arguably correct for an unseen concept and definitely wrong as a review signal,
 * so unseen concepts are separated out below and deprioritised: review means reviewing something.
 *
 * Requires `conceptStates` on the candidate. Items without them are treated as having nothing due.
 */
export function spacedRetrieval(
  candidates: Candidate[],
  tracker: SkillTracker,
  opts: SelectOptions = {},
): Candidate | null {
  const now = opts.now ?? Date.now();

  // See `rescue` on `tiers`: a mastered-but-decayed item is precisely this policy's target, so it
  // must survive the mastery filter that the other two policies want.
  const isDue = (c: Candidate): boolean =>
    (c.conceptStates ?? []).some(s =>
      s.lastRetrievedAt !== null && retrievability(s, now) < REVIEW_DUE_BELOW);

  const { pool } = tiers(candidates, tracker, opts, isDue);

  return argminBy(pool, c => {
    const states = c.conceptStates ?? [];
    let worst = Infinity;
    let sawSeen = false;

    for (const state of states) {
      if (state.lastRetrievedAt === null) continue;      // never retrieved: not a review candidate
      sawSeen = true;
      const r = retrievability(state, now);
      if (r < worst) worst = r;
    }
    // Nothing reviewable on this item — rank it after everything that is genuinely due, but
    // still ahead of nothing, so an all-unseen pool still returns a pick instead of null.
    return sawSeen ? worst : 2;
  });
}

/** The default policy, for parity with OATutor's `defaultHeuristic`. */
export const defaultHeuristic: SelectionHeuristic = (candidates, tracker) =>
  weakestFirst(candidates, tracker);

/**
 * Bind options into a bare `SelectionHeuristic`, so a configured policy can be stored and swapped
 * like the original's treatment mapping without the call site knowing which one it holds.
 */
export function configure(
  policy: (c: Candidate[], t: SkillTracker, o: SelectOptions & { target?: number }) => Candidate | null,
  opts: SelectOptions & { target?: number } = {},
): SelectionHeuristic {
  return (candidates, tracker) => policy(candidates, tracker, opts);
}

/** Every shipped policy, by name — the registry a settings screen or an experiment reads from. */
export const HEURISTICS = {
  weakestFirst,
  zoneOfProximalDevelopment,
  spacedRetrieval,
} as const;

export type HeuristicName = keyof typeof HEURISTICS;

/**
 * Select with an explicit exhaustion signal, which is what a session runner actually needs:
 * OATutor conflated "nothing left" with `undefined` and then had to re-derive the reason
 * (`Platform.js:437-451`).
 */
export interface SelectionResult {
  item: Candidate | null;
  /** True when every candidate was already mastered and we returned one anyway. */
  fallback: boolean;
  /** True when the pool was empty or fully completed. */
  exhausted: boolean;
}

export function select(
  candidates: Candidate[],
  tracker: SkillTracker,
  policy: (c: Candidate[], t: SkillTracker, o: SelectOptions) => Candidate | null = weakestFirst,
  opts: SelectOptions = {},
): SelectionResult {
  const { pool, wasFallback } = tiers(candidates, tracker, opts);
  if (pool.length === 0) return { item: null, fallback: false, exhausted: true };
  const item = policy(candidates, tracker, opts);
  return { item, fallback: wasFallback, exhausted: item === null };
}
