/**
 * Tests for the Next Move ranking.
 *
 * This is the file that has to be right, because the ranking is the product's central claim: "Today
 * tells you what to do next, and it can justify it." A plausible-looking but wrong ordering is
 * invisible in code review and indefensible on stage.
 *
 * The interesting assertions are the *inversions* — the cases where the obvious ranking is wrong:
 * a decaying strength must outrank a never-started weakness, and "you are done here" must never head
 * the list even though it is a legitimate recommendation.
 */

import { describe, it, expect } from 'vitest';
import {
  emptyConcept, ingest, retrievability,
  type ConceptState, type EvidenceEvent, type EvidenceKind, type EvidenceSource,
} from '../learner/model';
import { nextMoves, classify, headline, KIND_LABEL, KIND_VERB, pearlFor } from './nextMove';
import { useApp } from '../state/store';

const DAY = 24 * 60 * 60 * 1000;
/** A fixed reference time. Injected everywhere so nothing here depends on the wall clock. */
const NOW = 1_780_000_000_000;

/** Build a concept with `n` events of one kind/source, all `daysAgo` old. */
function build(
  id: string,
  opts: {
    n: number;
    kind?: EvidenceKind;
    source?: EvidenceSource;
    daysAgo?: number;
    correct?: boolean | null;
    spread?: number;
  },
): ConceptState {
  const { n, kind = 'recalled', source = 'anki', daysAgo = 1, correct = true, spread = 30 } = opts;
  let c = emptyConcept(id, id.split('.')[0]!);
  for (let i = 0; i < n; i++) {
    // Oldest first, ending at `daysAgo` — order matters because the model tracks lastRetrievedAt.
    const t = n === 1 ? 1 : i / (n - 1);
    const at = NOW - (daysAgo + (1 - t) * spread) * DAY;
    const e: EvidenceEvent = {
      id: `${id}.e${i}`, conceptId: id, kind, source, at,
      correct: kind === 'seen' ? null : correct,
      difficulty: 0.5, seconds: 40,
    };
    c = ingest(c, e);
  }
  return c;
}

/** A district wrapper, matching the store's shape. */
function d(id: string, label = id) {
  return { id, label, conceptIds: [`${id}.core`] };
}

describe('classify picks the kind of work a concept needs', () => {
  it('calls an evidence-poor concept a probe', () => {
    const c = build('derm.core', { n: 1 });
    expect(c.estimateConfidence).toBeLessThan(0.25);
    expect(classify(c, NOW)).toBe('probe');
  });

  it('calls a well-evidenced, stale, formerly-strong concept a restore', () => {
    // Deep varied work, then a long silence: the biochem case in the seed.
    //
    // The gap has to be genuinely long. My first version of this test used two months and asserted
    // 'restore'; the model returned 'leave', and the model was right — forty successful retrievals
    // drive the half-life to its 240-day ceiling, so at eight weeks this material is still ~83%
    // retrievable. Nothing was wrong except the premise. A year is what actually lapses.
    let c = emptyConcept('biochem.core', 'biochem');
    const sources: EvidenceSource[] = ['anki', 'uworld', 'x-case', 'amboss', 'nbme'];
    const kinds: EvidenceKind[] = ['recalled', 'distinguished', 'applied', 'stable'];
    for (let i = 0; i < 40; i++) {
      c = ingest(c, {
        id: `b${i}`, conceptId: 'biochem.core',
        kind: kinds[i % kinds.length]!, source: sources[i % sources.length]!,
        at: NOW - (400 - i) * DAY, correct: true, difficulty: 0.5, seconds: 40,
      });
    }
    expect(retrievability(c, NOW)).toBeLessThan(0.55);
    expect(classify(c, NOW)).toBe('restore');
  });

  it('never returns leave for a concept the model is unsure about', () => {
    // Guards the ordering inside `classify`: the confidence gate must run before the mastery gate,
    // or one lucky answer on an unknown concept would be reported as "stop studying this".
    const c = build('psych.core', { n: 1, kind: 'stable' });
    expect(classify(c, NOW)).toBe('probe');
  });
});

describe('ranking puts the most expensive thing to ignore first', () => {
  it('ranks a decaying strength above a never-started weakness', () => {
    // The inversion that matters. Weakest-first would put `fresh` first; that is wrong, because
    // `lapsed` is actively losing ground that was already paid for.
    let lapsed = emptyConcept('biochem.core', 'biochem');
    const kinds: EvidenceKind[] = ['recalled', 'distinguished', 'applied', 'stable'];
    const sources: EvidenceSource[] = ['anki', 'uworld', 'x-case', 'nbme'];
    for (let i = 0; i < 40; i++) {
      lapsed = ingest(lapsed, {
        id: `l${i}`, conceptId: 'biochem.core',
        kind: kinds[i % 4]!, source: sources[i % 4]!,
        // A year, for the same reason as above: the half-life ceiling means a shorter gap has not
        // actually lapsed yet, and asserting otherwise would be testing a fiction.
        at: NOW - (400 - i) * DAY, correct: true, difficulty: 0.5, seconds: 40,
      });
    }

    const moves = nextMoves(
      [d('biochem', 'Biochemistry'), d('repro', 'Reproductive')],
      { 'biochem.core': lapsed, 'repro.core': build('repro.core', { n: 2, daysAgo: 20 }) },
      NOW,
    );

    expect(moves[0]!.id).toBe('biochem');
    expect(moves[0]!.kind).toBe('restore');
  });

  it('never heads the list with "leave it"', () => {
    // 'leave' is honest advice, but a surface whose top line is "do nothing" has failed at its job.
    let strong = emptyConcept('cardio.core', 'cardio');
    const kinds: EvidenceKind[] = ['recalled', 'distinguished', 'applied', 'stable'];
    const sources: EvidenceSource[] = ['anki', 'uworld', 'x-case', 'amboss', 'nbme', 'x-examiner'];
    for (let i = 0; i < 40; i++) {
      strong = ingest(strong, {
        id: `s${i}`, conceptId: 'cardio.core',
        kind: kinds[i % 4]!, source: sources[i % 6]!,
        at: NOW - (40 - i) * DAY, correct: true, difficulty: 0.5, seconds: 40,
      });
    }
    const moves = nextMoves(
      [d('cardio', 'Cardiovascular'), d('micro', 'Microbiology')],
      { 'cardio.core': strong, 'micro.core': build('micro.core', { n: 8, daysAgo: 12 }) },
      NOW,
    );
    if (moves.some(m => m.kind === 'leave')) {
      expect(moves[0]!.kind).not.toBe('leave');
    }
  });

  it('is a total order that does not depend on input order', () => {
    const concepts = {
      'cardio.core': build('cardio.core', { n: 20, daysAgo: 1 }),
      'renal.core': build('renal.core', { n: 14, daysAgo: 2 }),
      'derm.core': build('derm.core', { n: 1, daysAgo: 40 }),
    };
    const a = nextMoves([d('cardio'), d('renal'), d('derm')], concepts, NOW).map(m => m.id);
    const b = nextMoves([d('derm'), d('renal'), d('cardio')], concepts, NOW).map(m => m.id);
    expect(a).toEqual(b);
  });

  it('is deterministic across calls', () => {
    const concepts = { 'renal.core': build('renal.core', { n: 12 }) };
    const one = nextMoves([d('renal', 'Renal')], concepts, NOW);
    const two = nextMoves([d('renal', 'Renal')], concepts, NOW);
    expect(one).toEqual(two);
  });
});

describe('every move is defensible and complete', () => {
  const districts = useApp.getState().districts;
  const concepts = useApp.getState().concepts;
  const moves = nextMoves(districts, concepts, Date.now());

  it('produces one move per seeded district', () => {
    expect(moves.length).toBe(districts.length);
  });

  it('gives every move real copy, a real duration and a real prompt', () => {
    for (const m of moves) {
      expect(m.interpretation.length, m.id).toBeGreaterThan(20);
      expect(m.action.length, m.id).toBeGreaterThan(15);
      expect(KIND_LABEL[m.kind]).toBeTruthy();
      expect(KIND_VERB[m.kind]).toBeTruthy();
      expect(m.minutes).toBeGreaterThanOrEqual(0);
      // Content coverage is what makes a card renderable — a move with no prompt is a dead card.
      expect(m.prompt?.q, `no prompt for ${m.id}`).toBeTruthy();
      expect(pearlFor(m.id), `no pearl for ${m.id}`).toBeTruthy();
    }
  });

  it('cites evidence whenever the model had any to cite', () => {
    for (const m of moves) {
      // The one legitimate case for an empty citation is a subject with no evidence at all.
      if (m.confidence >= 0.25) expect(m.because.length, m.id).toBeGreaterThan(0);
    }
  });

  it('reports mastery and confidence in range', () => {
    for (const m of moves) {
      expect(m.mastery).toBeGreaterThanOrEqual(0);
      expect(m.mastery).toBeLessThanOrEqual(1);
      expect(m.confidence).toBeGreaterThanOrEqual(0);
      expect(m.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('surfaces the seed\'s deliberate cases rather than averaging them away', () => {
    const byId = new Map(moves.map(m => [m.id, m]));
    // renal is seeded strong-but-unverified; psych and derm are untouched. If the ranking smoothed
    // these out, the whole demo narrative would be gone.
    expect(byId.get('psych')!.kind).toBe('probe');
    expect(byId.get('derm')!.kind).toBe('probe');
    expect(byId.get('renal')!.confidence).toBeLessThan(byId.get('cardio')!.confidence);
  });
});

describe('headline', () => {
  it('splits lead from the rest without dropping anything', () => {
    const concepts = {
      'cardio.core': build('cardio.core', { n: 20 }),
      'renal.core': build('renal.core', { n: 12 }),
    };
    const moves = nextMoves([d('cardio'), d('renal')], concepts, NOW);
    const { lead, rest } = headline(moves);
    expect(lead).toBe(moves[0]);
    expect(rest.length).toBe(moves.length - 1);
  });

  it('handles an empty list rather than throwing', () => {
    const { lead, rest } = headline([]);
    expect(lead).toBeUndefined();
    expect(rest).toEqual([]);
  });
});
