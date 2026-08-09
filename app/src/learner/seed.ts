/**
 * Demo learner state — a plausible second-year, six weeks into dedicated study.
 *
 * Why this exists: a fresh install has zero evidence on all 21 concepts, and the world renders that
 * honestly as an unlit grey field of plots. That is *correct* and it is also useless — nobody can
 * evaluate a competency world that is showing "we know nothing about you yet." Worse, it made the
 * board read as broken rather than as empty.
 *
 * So this seeds real evidence through the real `ingest()` pipeline. Nothing here writes a mastery
 * number directly: every value in the world is derived by the same model that will derive it from
 * live study, which means what you see is what the engine actually produces. If the model is wrong,
 * this shows it wrong — that's the point.
 *
 * Deterministic: a seeded PRNG and a fixed reference date, so the board is byte-identical every
 * launch and screenshots are comparable across days.
 */

import {
  emptyConcept, ingest,
  type ConceptState, type EvidenceEvent, type EvidenceKind, type EvidenceSource,
} from './model';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Mulberry32. Small, fast, and — the reason it's here — reproducible. `Math.random()` would make the
 * world different on every launch, so a visual regression would be indistinguishable from noise.
 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A study profile per district. This is a *narrative*, not random noise — it describes a specific
 * believable student, which is what makes the world worth looking at:
 *
 *   `depth`   how much work they've put in (0..1) → drives height
 *   `variety` how many kinds/sources of evidence → drives confidence, i.e. the fog line
 *   `lastDay` days ago they last retrieved it → drives decay, i.e. MAINTENANCE
 *   `split`   accuracy disagreement between sources → drives conflict haze
 *
 * The interesting cases are deliberate: `cardio` is strong and verified; `renal` is strong but
 * *unverified* (high depth, low variety) which is the tall-district-low-fog-line case the Fog Line
 * exists to show; `biochem` was mastered in M1 and has since lapsed; `pharm` and `endo` carry a
 * `split` so two sources genuinely disagree; `derm` and `psych` are untouched, because a world where
 * everything is lit is a world with nothing to say.
 *
 * These numbers were tuned against measured output, not chosen by feel. The check that matters is
 * that all six move kinds appear across the 21 subjects — when every subject classifies the same way
 * the board and the Today queue both go flat, which is how an earlier version of this seed read.
 */
interface Profile {
  depth: number;
  variety: number;
  lastDay: number;
  split?: number;
}

const PROFILES: Record<string, Profile> = {
  // Foundations — done early, some now lapsing. This is what a real M2 looks like.
  cell:       { depth: 0.72, variety: 0.70, lastDay: 24 },
  genetics:   { depth: 0.55, variety: 0.55, lastDay: 31 },
  // Earned properly in M1 and untouched since → MAINTENANCE. 240 days, not 56: thirteen successful
  // retrievals push the half-life to the model's 240-day ceiling, so at eight weeks this was still
  // 83% retrievable and read as ordinary forward work. A real M1 subject last touched a year ago is
  // both more honest and the only way this shows up as the lapse it is meant to demonstrate.
  biochem:    { depth: 0.80, variety: 0.75, lastDay: 240 },

  // Mechanism — active work.
  physiology: { depth: 0.78, variety: 0.85, lastDay: 3 },
  pathology:  { depth: 0.66, variety: 0.72, lastDay: 6 },
  // Anki vs UWorld genuinely disagree. `split` is 0.55 rather than 0.34 because the conflict measure
  // now shrinks each source toward the pooled rate by 6 pseudo-attempts — real disagreement survives
  // that, thin disagreement does not, and this is meant to be real.
  pharm:      { depth: 0.62, variety: 0.42, lastDay: 4, split: 0.55 },
  micro:      { depth: 0.40, variety: 0.35, lastDay: 12 },
  immuno:     { depth: 0.58, variety: 0.62, lastDay: 8 },
  histo:      { depth: 0.30, variety: 0.30, lastDay: 27 },
  anatomy:    { depth: 0.62, variety: 0.45, lastDay: 40 },

  // Organ systems — the current block, plus the ones not reached yet.
  cardio:     { depth: 0.86, variety: 0.90, lastDay: 1 },    // strong AND verified
  resp:       { depth: 0.70, variety: 0.78, lastDay: 2 },
  renal:      { depth: 0.74, variety: 0.22, lastDay: 2 },    // strong, UNVERIFIED — the fog case
  gi:         { depth: 0.44, variety: 0.50, lastDay: 9 },
  endo:       { depth: 0.58, variety: 0.34, lastDay: 7, split: 0.46 },
  neuro:      { depth: 0.36, variety: 0.55, lastDay: 5 },
  msk:        { depth: 0.26, variety: 0.30, lastDay: 18 },
  heme:       { depth: 0.33, variety: 0.42, lastDay: 11 },
  repro:      { depth: 0.14, variety: 0.20, lastDay: 21 },
  psych:      { depth: 0.00, variety: 0.00, lastDay: 0 },    // untouched, and stays that way
  derm:       { depth: 0.00, variety: 0.00, lastDay: 0 },
};

/** Sources ordered so `variety` selects a widening set rather than a random one. */
const SOURCE_LADDER: EvidenceSource[] = [
  'anki', 'uworld', 'x-case', 'amboss', 'school-exam', 'x-examiner', 'nbme',
];

/** Kinds ordered by how much they demand of the learner — depth walks up this ladder. */
const KIND_LADDER: EvidenceKind[] = ['seen', 'recalled', 'distinguished', 'applied', 'stable'];

/**
 * Build one concept's history and fold it through `ingest`.
 *
 * Events are laid down oldest-first across the profile's study window so the model's own
 * diminishing-returns and half-life logic sees a real chronology. Feeding them in reverse would
 * produce the same dimension totals but a wrong `lastRetrievedAt`, and therefore wrong decay.
 */
function buildConcept(
  conceptId: string,
  districtId: string,
  p: Profile,
  now: number,
  rand: () => number,
): ConceptState {
  let c = emptyConcept(conceptId, districtId);
  if (p.depth <= 0) return c;                       // untouched stays untouched

  // Event count scales with depth. 4 → 26 events is the realistic band for one core concept.
  const count = Math.round(4 + p.depth * 22);
  // Variety picks how far up the source ladder this concept reaches. At least one source always.
  const sourceSpan = Math.max(1, Math.round(p.variety * SOURCE_LADDER.length));
  const kindSpan = Math.max(1, Math.round(0.5 + p.depth * (KIND_LADDER.length - 1)));

  // The study window: from first exposure until the last retrieval.
  const windowStart = now - (p.lastDay + 10 + p.depth * 70) * DAY;
  const windowEnd = now - p.lastDay * DAY;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : i / (count - 1);
    const at = Math.round(windowStart + (windowEnd - windowStart) * t);

    const source = SOURCE_LADDER[Math.floor(rand() * sourceSpan)] ?? 'anki';
    // Harder kinds appear later in the timeline — you don't apply a concept before you've seen it.
    const kindIdx = Math.min(KIND_LADDER.length - 1, Math.floor(t * kindSpan + rand() * 0.9));
    const kind = KIND_LADDER[kindIdx] ?? 'seen';

    // Accuracy rises with depth and over time. `split` makes one source disagree with the rest,
    // which is what puts a real number in `evidenceConflict` instead of a hand-set constant.
    let pCorrect = 0.42 + p.depth * 0.44 + t * 0.12;
    if (p.split && source === 'anki') pCorrect += p.split;
    else if (p.split && source === 'uworld') pCorrect -= p.split * 0.7;

    const correct = kind === 'seen' ? null : rand() < Math.min(0.97, Math.max(0.05, pCorrect));

    const e: EvidenceEvent = {
      id: `${conceptId}.seed.${i}`,
      conceptId,
      kind,
      source,
      at,
      correct,
      difficulty: 0.3 + rand() * 0.5,
      seconds: Math.round(20 + rand() * 90),
    };
    c = ingest(c, e);
  }

  return c;
}

/**
 * Seed every district's core concept. `now` is injected rather than read from the clock so tests and
 * screenshots can pin it; production passes the real time so decay is live from the first frame.
 */
export function seedLearner(
  districts: Array<{ id: string; conceptIds: string[] }>,
  now: number,
): Record<string, ConceptState> {
  const out: Record<string, ConceptState> = {};
  // One PRNG for the whole seed, advanced in district order — deterministic given the district list.
  const rand = prng(0x5EED_1);

  for (const d of districts) {
    const p = PROFILES[d.id] ?? { depth: 0, variety: 0, lastDay: 0 };
    for (const conceptId of d.conceptIds) {
      out[conceptId] = buildConcept(conceptId, d.id, p, now, rand);
    }
  }
  return out;
}

/** Exported for the test that asserts the seed produces a genuinely varied world. */
export const SEED_PROFILES = PROFILES;
