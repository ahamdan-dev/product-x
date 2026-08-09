/**
 * The learner model — the actual product.
 *
 * Both source documents converge on this: "The Companion is the interface. The Learner Model is the
 * product." The blueprint forbids collapsing it into one percentage (§15) and requires a
 * resource-agnostic layer above every tool the student already uses (§17).
 *
 * Two specification gaps existed in the source material, and both are filled here with real math
 * rather than left as prose:
 *
 *   - **Decay.** No forgetting curve was specified anywhere. Implemented as an exponential retention
 *     curve whose half-life *grows with stability* — the core insight of modern spaced repetition.
 *     Each successful retrieval lengthens the half-life, so a well-learned concept decays slowly and
 *     a freshly-seen one decays fast.
 *
 *   - **Mastery weighting.** §46 leaves exact weights open ("Dimensions are established. Exact
 *     weighting requires testing"). So the weights live in one exported constant, documented, tunable,
 *     and never hardcoded at a call site — honoring "do not quietly lock these".
 */

/** The 7-state evidence profile, verbatim from the research report. */
export type EvidenceKind =
  | 'seen'          // encountered it
  | 'recalled'      // produced the fact without seeing it
  | 'distinguished' // separated it from tempting alternatives
  | 'applied'       // used it correctly in a novel clinical scenario
  | 'stable'        // done the above repeatedly over time
  | 'fading'        // previous evidence is going stale
  | 'conflicted';   // sources disagree

/** Where evidence came from. Reliability differs, so the source is load-bearing. */
export type EvidenceSource =
  | 'anki' | 'uworld' | 'amboss' | 'school-exam' | 'nbme'
  | 'x-tutor' | 'x-case' | 'x-examiner' | 'x-concept-check' | 'x-exam-sim'
  | 'self-report';

export interface EvidenceEvent {
  id: string;
  conceptId: string;
  kind: EvidenceKind;
  source: EvidenceSource;
  /** Epoch ms. */
  at: number;
  /** Did the learner get it right? null for 'seen' (exposure carries no correctness). */
  correct: boolean | null;
  /** 0..1 item difficulty, if the source reports it. */
  difficulty?: number;
  /** Seconds spent, if known. Used for pacing signals, never for "hours studied" scoring. */
  seconds?: number;
}

/**
 * Source reliability. A student's self-report is weak evidence; a proctored NBME is strong.
 * These are the report's "evidence weighting factors: source quality, reliability" made concrete.
 */
export const SOURCE_RELIABILITY: Record<EvidenceSource, number> = {
  'nbme': 1.00,
  'school-exam': 0.92,
  'uworld': 0.88,
  'x-exam-sim': 0.86,
  'amboss': 0.84,
  'x-case': 0.82,
  'x-examiner': 0.80,
  'x-concept-check': 0.72,
  'anki': 0.64,          // high volume, low per-item signal — recognition, not transfer
  'x-tutor': 0.55,
  'self-report': 0.30,
};

/**
 * How much each evidence kind advances each competency dimension.
 * This is the honest core of "do not collapse everything into one naive percentage": an Anki
 * recall moves retention and comprehension but barely touches clinical reasoning.
 */
export const KIND_WEIGHTS: Record<EvidenceKind, Partial<Record<Dimension, number>>> = {
  seen:           { coverage: 0.85, comprehension: 0.15 },
  recalled:       { retention: 0.70, comprehension: 0.45, coverage: 0.20 },
  distinguished:  { reasoning: 0.55, comprehension: 0.50, retention: 0.25 },
  applied:        { application: 0.85, reasoning: 0.70, comprehension: 0.30 },
  stable:         { retention: 0.60, application: 0.30, comprehension: 0.20 },
  fading:         {},   // negative signal, handled by decay not accrual
  conflicted:     {},   // raises evidenceConflict, handled separately
};

export type Dimension =
  | 'comprehension' | 'retention' | 'application' | 'reasoning' | 'coverage';

/** §46: exact weighting is INTENTIONALLY UNRESOLVED. One tunable constant, never inlined. */
export const MASTERY_WEIGHTS: Record<Dimension, number> = {
  comprehension: 0.20,
  retention: 0.26,     // heaviest: the report's central finding is that retention lags
  application: 0.26,   // equal heaviest: transfer is the real target
  reasoning: 0.18,
  coverage: 0.10,      // lightest on purpose — coverage is exposure, not mastery
};

export interface ConceptState {
  conceptId: string;
  districtId: string;
  dimensions: Record<Dimension, number>;   // each 0..1
  /** Retrieval count — drives the growing half-life. */
  successfulRetrievals: number;
  /** Epoch ms of the last correct retrieval. */
  lastRetrievedAt: number | null;
  /** How confident the model is in its own estimate, 0..1. Low = fog. */
  estimateConfidence: number;
  /** Disagreement between sources, 0..1. The report's `conflicted` state. */
  evidenceConflict: number;
  events: EvidenceEvent[];
}

export function emptyConcept(conceptId: string, districtId: string): ConceptState {
  return {
    conceptId, districtId,
    dimensions: { comprehension: 0, retention: 0, application: 0, reasoning: 0, coverage: 0 },
    successfulRetrievals: 0,
    lastRetrievedAt: null,
    estimateConfidence: 0,
    evidenceConflict: 0,
    events: [],
  };
}

/** Base half-life for a concept retrieved exactly once, in ms. ~1.6 days. */
const BASE_HALF_LIFE_MS = 1.6 * 24 * 60 * 60 * 1000;
/** Each additional successful retrieval multiplies the half-life. */
const HALF_LIFE_GROWTH = 1.9;
/** Ceiling so nothing is ever declared permanently known. */
const MAX_HALF_LIFE_MS = 240 * 24 * 60 * 60 * 1000;

/**
 * Minimum attempts before a source is allowed to vote in the conflict measure.
 *
 * Set from measurement, not taste: at a threshold of 2, sixteen of the twenty-one seeded subjects
 * reported conflict above the 0.22 action threshold, because with six or seven sources in play some
 * pair will always land 2/2 against 0/2 by chance alone. That is sampling noise being reported as a
 * finding — the exact failure mode "do not gamify activity, visualize evidence" is meant to prevent.
 */
const MIN_SOURCE_SAMPLE = 4;

/**
 * Shrinkage strength for the conflict measure, in pseudo-attempts.
 *
 * Each source's accuracy is pulled toward the pooled rate as though it had this many extra attempts
 * at the pooled rate. At 6, a source with 4 attempts keeps 40% of its own signal and a source with 40
 * keeps 87% — so real, well-evidenced disagreement survives and thin disagreement does not.
 */
const CONFLICT_PRIOR = 6;

/**
 * Current half-life for a concept. Growing half-life is what separates a real retention model from
 * a decaying progress bar: the fifth correct retrieval buys far more durability than the first.
 */
export function halfLifeMs(c: ConceptState): number {
  if (c.successfulRetrievals <= 0) return BASE_HALF_LIFE_MS * 0.35;
  const h = BASE_HALF_LIFE_MS * Math.pow(HALF_LIFE_GROWTH, c.successfulRetrievals - 1);
  return Math.min(MAX_HALF_LIFE_MS, h);
}

/**
 * Retrievability — probability the learner can retrieve this right now, 0..1.
 * Standard exponential forgetting: R = 2^(-elapsed / halfLife).
 */
export function retrievability(c: ConceptState, now: number): number {
  if (c.lastRetrievedAt === null) return 0;
  const elapsed = Math.max(0, now - c.lastRetrievedAt);
  return Math.pow(2, -elapsed / halfLifeMs(c));
}

/**
 * Composite mastery, 0..1. Retention is multiplied by live retrievability, so mastery *decays with
 * real time* without any scheduled job — reading the model is what applies the decay.
 */
export function mastery(c: ConceptState, now: number): number {
  const r = retrievability(c, now);
  const d = { ...c.dimensions, retention: c.dimensions.retention * r };
  let sum = 0;
  for (const k of Object.keys(MASTERY_WEIGHTS) as Dimension[]) {
    sum += d[k] * MASTERY_WEIGHTS[k];
  }
  return clamp01(sum);
}

/**
 * The six visual development states (§21). Fog is uncertainty, never failure — so a concept with
 * strong evidence that has decayed lands in MAINTENANCE, while a concept we simply know nothing
 * about stays UNFORMED. §21.6: never demolish earned development.
 */
export type WorldState =
  | 'UNFORMED' | 'FOUNDATION' | 'DEVELOPING' | 'FUNCTIONAL' | 'MASTERED' | 'MAINTENANCE';

export function worldState(c: ConceptState, now: number): WorldState {
  // Not enough evidence to say anything — this is fog, not failure.
  if (c.estimateConfidence < 0.25) return 'UNFORMED';

  const live = mastery(c, now);
  const peak = peakMastery(c);

  // Earned it once, lost retrievability since: maintenance, never demolition.
  if (peak >= 0.70 && live < peak - 0.18) return 'MAINTENANCE';

  if (live < 0.20) return 'UNFORMED';
  if (live < 0.40) return 'FOUNDATION';
  if (live < 0.62) return 'DEVELOPING';
  if (live < 0.82) return 'FUNCTIONAL';
  return 'MASTERED';
}

/** Mastery ignoring decay — the high-water mark that must never be taken away visually. */
export function peakMastery(c: ConceptState): number {
  let sum = 0;
  for (const k of Object.keys(MASTERY_WEIGHTS) as Dimension[]) {
    sum += c.dimensions[k] * MASTERY_WEIGHTS[k];
  }
  return clamp01(sum);
}

/**
 * Ingest one evidence event. Pure — returns a new state, never mutates.
 * Learning rate falls as evidence accumulates, so the first correct answer moves the model a lot
 * and the fortieth barely moves it. Without this, grinding Anki would fake mastery — exactly the
 * failure the report names ("Do not gamify activity").
 */
export function ingest(c: ConceptState, e: EvidenceEvent): ConceptState {
  const next: ConceptState = {
    ...c,
    dimensions: { ...c.dimensions },
    events: [...c.events, e],
  };

  const reliability = SOURCE_RELIABILITY[e.source];
  const weights = KIND_WEIGHTS[e.kind];

  // Harder items that were answered correctly are worth more.
  const difficultyBonus = e.correct === true ? 1 + (e.difficulty ?? 0.5) * 0.5 : 1;

  for (const [dim, w] of Object.entries(weights) as [Dimension, number][]) {
    const cur = next.dimensions[dim];
    // Diminishing returns: gain shrinks as the dimension approaches 1.
    const headroom = 1 - cur;
    const gain = w * reliability * difficultyBonus * headroom * 0.34;

    if (e.correct === false) {
      // Wrong answers pull back, gently, and only on the dimensions the item tested.
      next.dimensions[dim] = clamp01(cur - w * reliability * 0.16);
    } else {
      next.dimensions[dim] = clamp01(cur + gain);
    }
  }

  // A correct retrieval resets the decay clock and lengthens the half-life.
  const isRetrieval = e.kind === 'recalled' || e.kind === 'distinguished' || e.kind === 'applied';
  if (isRetrieval && e.correct === true) {
    next.successfulRetrievals = c.successfulRetrievals + 1;
    next.lastRetrievedAt = e.at;
  } else if (isRetrieval && e.correct === false) {
    // A failed retrieval shortens durability without erasing history.
    next.successfulRetrievals = Math.max(0, c.successfulRetrievals - 1);
    next.lastRetrievedAt = e.at;
  }

  // Confidence in our own estimate grows with the count and reliability of evidence, and
  // requires *variety* — ten Anki reps tell us less than one Anki rep plus one case.
  const kinds = new Set(next.events.map(x => x.kind));
  const sources = new Set(next.events.map(x => x.source));
  const volume = 1 - Math.exp(-next.events.length / 6);
  const variety = Math.min(1, (kinds.size / 4) * 0.5 + (sources.size / 3) * 0.5);
  next.estimateConfidence = clamp01(volume * 0.55 + variety * 0.45);

  next.evidenceConflict = computeConflict(next);
  return next;
}

/**
 * Evidence conflict — the `conflicted` state. The report's canonical example: UWorld 88% with Anki
 * retention 54% must NOT average to 71%; the disagreement itself is the finding.
 * Measured as the spread of per-source accuracy, weighted by reliability.
 */
export function computeConflict(c: ConceptState): number {
  const bySource = new Map<EvidenceSource, { right: number; total: number }>();
  for (const e of c.events) {
    if (e.correct === null) continue;
    const s = bySource.get(e.source) ?? { right: 0, total: 0 };
    s.total++;
    if (e.correct) s.right++;
    bySource.set(e.source, s);
  }

  const rates: Array<{ rate: number; n: number }> = [];
  let pooledRight = 0, pooledTotal = 0;
  for (const [src, s] of bySource) {
    // Four, not two. Two data points is not a trend either: a source that goes 2/2 against one that
    // goes 0/2 produces a raw spread of 1.0 from pure sampling noise, and with six or seven sources
    // in play that happens on nearly every concept. Requiring four is the difference between this
    // measure reporting real disagreement and it reporting the number of sources.
    if (s.total < MIN_SOURCE_SAMPLE) continue;
    if (SOURCE_RELIABILITY[src] < 0.5) continue;      // ignore weak sources in conflict math
    rates.push({ rate: s.right / s.total, n: s.total });
    pooledRight += s.right;
    pooledTotal += s.total;
  }
  if (rates.length < 2 || pooledTotal === 0) return 0;

  /**
   * Shrink each source's rate toward the pooled rate in proportion to how little data it has. This is
   * a standard shrinkage estimator, and it is what makes the measure sample-size aware: a source with
   * four attempts barely moves off the pooled rate, while a source with forty is trusted as-is. The
   * canonical case the report demands — UWorld 88% against Anki retention 54% over many attempts —
   * survives untouched, because at that volume shrinkage is negligible.
   */
  const pooled = pooledRight / pooledTotal;
  const smoothed = rates.map(r =>
    (r.rate * r.n + pooled * CONFLICT_PRIOR) / (r.n + CONFLICT_PRIOR));

  return clamp01(Math.max(...smoothed) - Math.min(...smoothed));
}

/** A human-readable finding. §39: "data → interpretation → action". */
export interface Finding {
  conceptId: string;
  severity: 'critical' | 'notable' | 'informational';
  /** The interpretation — never a raw statistic. */
  interpretation: string;
  /** The action. §8.5: recommendations must be actionable. */
  action: string;
  /** Evidence ids that justify this. Powers the mandatory "Why this?" affordance. */
  because: string[];
}

/**
 * Generate findings. This is the "Why this?" engine — every recommendation must be justifiable in
 * learner-model terms, citing specific evidence. The report: "That explanation is the product."
 */
export function findings(c: ConceptState, now: number, label: string): Finding[] {
  const out: Finding[] = [];
  const live = mastery(c, now);
  const peak = peakMastery(c);
  const r = retrievability(c, now);
  const recent = c.events.slice(-6).map(e => e.id);

  if (c.estimateConfidence < 0.25) {
    out.push({
      conceptId: c.conceptId, severity: 'informational',
      interpretation: `There isn't enough evidence yet to know where you stand on ${label}.`,
      action: `A short retrieval check would tell me more than another pass of reading.`,
      because: recent,
    });
    return out;   // don't stack findings on top of ignorance
  }

  if (c.evidenceConflict > 0.22) {
    out.push({
      conceptId: c.conceptId, severity: 'critical',
      interpretation:
        `Your sources disagree on ${label}. Immediate recall looks stronger than what happens ` +
        `when the same idea shows up inside a case.`,
      action: `More questions won't settle this. I want transfer evidence — two novel cases.`,
      because: recent,
    });
  }

  if (peak >= 0.70 && r < 0.55) {
    out.push({
      conceptId: c.conceptId, severity: 'notable',
      interpretation: `You had ${label} solid. It's been long enough that it's slipping.`,
      action: `A ${Math.max(4, Math.round(8 * r))}-minute retrieval pass restores it. Don't relearn it.`,
      because: recent,
    });
  }

  const { comprehension, application } = c.dimensions;
  if (comprehension > 0.62 && application < comprehension - 0.24) {
    out.push({
      conceptId: c.conceptId, severity: 'critical',
      interpretation:
        `You can explain ${label}. You haven't yet shown you can use it when the vignette ` +
        `hides which concept applies.`,
      action: `Skip the explanation. Do a case where ${label} isn't named.`,
      because: recent,
    });
  }

  if (live >= 0.82 && c.evidenceConflict <= 0.22) {
    out.push({
      conceptId: c.conceptId, severity: 'informational',
      interpretation: `${label} is holding across recall, reasoning, and application.`,
      action: `Stop studying this. Your time is worth more elsewhere.`,
      because: recent,
    });
  }

  return out;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
