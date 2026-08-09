import { describe, it, expect } from 'vitest';
import {
  TutorBridge, isUnaidedSuccess, isRetrievalOutcome,
  type TutorItem, type TutorOutcome,
} from './bridge';
import { SkillTracker } from './skills';
import { buildHintGraph, HintMachine, type HintSpec } from './hints';
import type { BktParams } from './bkt';
import {
  emptyConcept, ingest, mastery, retrievability, KIND_WEIGHTS, SOURCE_RELIABILITY,
  type ConceptState, type EvidenceKind,
} from '../learner/model';

const PARAMS: BktParams = { pInit: 0.3, pLearn: 0.1, pGuess: 0.2, pSlip: 0.1, pForget: 0 };
const NOW = 1_800_000_000_000;

const HINTS: HintSpec[] = [
  { id: 'h1', kind: 'hint', text: 'a nudge' },
  { id: 'h2', kind: 'scaffold', text: 'a sub-question', answer: ['20'], dependencies: ['h1'] },
  { id: 'h3', kind: 'solution', text: 'the answer', dependencies: ['h2'] },
];

function bridge(): TutorBridge {
  return new TutorBridge({
    tracker: new SkillTracker({ defaultParams: PARAMS }),
    now: () => NOW,
    // Deterministic ids: a replayed session must produce byte-identical evidence.
    nextEventId: (() => { let n = 0; return () => `ev-${++n}`; })(),
  });
}

function withHints(b: TutorBridge, stepId: string): HintMachine {
  const m = new HintMachine(buildHintGraph(HINTS));
  b.attachHints(stepId, m);
  return m;
}

const ITEM: TutorItem = { stepId: 'step-1', skillIds: ['cardio'], demand: 'recall' };

describe('the four outcomes stay distinguishable', () => {
  it('scores an unaided correct answer as correct-first-try', () => {
    const b = bridge();
    withHints(b, 'step-1');
    const r = b.submitAnswer(ITEM, true);
    expect(r.outcome).toBe('correct-first-try');
    expect(r.hintsUsed).toBe(0);
  });

  it('scores a correct answer after a hint as correct-after-hints', () => {
    const b = bridge();
    withHints(b, 'step-1');
    b.requestHint(ITEM, 'h1');
    const r = b.submitAnswer(ITEM, true);
    expect(r.outcome).toBe('correct-after-hints');
    expect(r.hintsUsed).toBe(1);
  });

  it('scores a wrong answer as incorrect', () => {
    const b = bridge();
    expect(b.submitAnswer(ITEM, false).outcome).toBe('incorrect');
  });

  it('scores a pre-answer hint request as hint-requested', () => {
    const b = bridge();
    withHints(b, 'step-1');
    expect(b.requestHint(ITEM, 'h1').outcome).toBe('hint-requested');
  });

  it('emits a different (kind, correct) pair for each of the four', () => {
    const seen = new Map<TutorOutcome, string>();

    const cold = bridge(); withHints(cold, 'step-1');
    seen.set('correct-first-try', sig(cold.submitAnswer(ITEM, true)));

    const helped = bridge(); withHints(helped, 'step-1');
    helped.requestHint(ITEM, 'h1');
    seen.set('correct-after-hints', sig(helped.submitAnswer(ITEM, true)));

    const wrong = bridge();
    seen.set('incorrect', sig(wrong.submitAnswer(ITEM, false)));

    const asked = bridge(); withHints(asked, 'step-1');
    seen.set('hint-requested', sig(asked.requestHint(ITEM, 'h1')));

    // All four signatures distinct — this is the "worthless tutor" test.
    expect(new Set(seen.values()).size).toBe(4);
    expect(seen.get('correct-first-try')).toBe('recalled:true');
    expect(seen.get('correct-after-hints')).toBe('seen:true');
    expect(seen.get('incorrect')).toBe('recalled:false');
    expect(seen.get('hint-requested')).toBe('seen:false');
  });

  function sig(r: { evidence: { kind: EvidenceKind; correct: boolean | null }[] }): string {
    const e = r.evidence[0]!;
    return `${e.kind}:${String(e.correct)}`;
  }

  it('keeps plain exposure distinct from both "seen" outcomes', () => {
    const b = bridge();
    const exposure = b.noteExposure(ITEM);
    expect(exposure[0]!.kind).toBe('seen');
    expect(exposure[0]!.correct).toBeNull();
  });

  it('exposes the distinction as a predicate so callers cannot collapse it', () => {
    expect(isUnaidedSuccess('correct-first-try')).toBe(true);
    expect(isUnaidedSuccess('correct-after-hints')).toBe(false);
    expect(isRetrievalOutcome('correct-first-try')).toBe(true);
    expect(isRetrievalOutcome('incorrect')).toBe(true);
    expect(isRetrievalOutcome('correct-after-hints')).toBe(false);
    expect(isRetrievalOutcome('hint-requested')).toBe(false);
  });
});

describe('only values that exist in the EvidenceKind union are emitted', () => {
  const VALID: EvidenceKind[] = [
    'seen', 'recalled', 'distinguished', 'applied', 'stable', 'fading', 'conflicted',
  ];

  it('never invents a kind', () => {
    const b = bridge();
    withHints(b, 'step-1');
    const all = [
      ...b.requestHint(ITEM, 'h1').evidence,
      ...b.submitAnswer(ITEM, true).evidence,
      ...b.noteExposure(ITEM),
      ...bridge().submitAnswer(ITEM, false).evidence,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) {
      expect(VALID).toContain(e.kind);
      // Every emitted kind must have a weights entry, or ingest() silently does nothing.
      expect(KIND_WEIGHTS[e.kind]).toBeDefined();
      expect(SOURCE_RELIABILITY[e.source]).toBeGreaterThan(0);
    }
  });

  it('maps item demand onto the matching retrieval kind', () => {
    const cases: Array<[TutorItem['demand'], EvidenceKind]> = [
      ['recall', 'recalled'],
      ['discriminate', 'distinguished'],
      ['apply', 'applied'],
    ];
    for (const [demand, kind] of cases) {
      const b = bridge();
      const r = b.submitAnswer({ stepId: 's', skillIds: ['k'], demand }, true);
      expect(r.evidence[0]!.kind).toBe(kind);
    }
  });

  it('defaults to recall when demand is unspecified', () => {
    const r = bridge().submitAnswer({ stepId: 's', skillIds: ['k'] }, true);
    expect(r.evidence[0]!.kind).toBe('recalled');
  });

  it('defaults the source to x-tutor and honours an override', () => {
    expect(bridge().submitAnswer(ITEM, true).evidence[0]!.source).toBe('x-tutor');
    const cased = bridge().submitAnswer({ ...ITEM, source: 'x-case' }, true);
    expect(cased.evidence[0]!.source).toBe('x-case');
    // A case is more reliable evidence than the tutor's own drill, which is why source matters.
    expect(SOURCE_RELIABILITY['x-case']).toBeGreaterThan(SOURCE_RELIABILITY['x-tutor']);
  });
});

describe('the emitted evidence is accepted by the real learner model', () => {
  it('an unaided success earns retrieval credit and resets the decay clock', () => {
    const b = bridge();
    const r = b.submitAnswer(ITEM, true);
    let c: ConceptState = emptyConcept('cardio', 'district');
    for (const e of r.evidence) c = ingest(c, e);

    expect(c.successfulRetrievals).toBe(1);
    expect(c.lastRetrievedAt).toBe(NOW);
    expect(retrievability(c, NOW)).toBeCloseTo(1, 6);
  });

  /**
   * The crux of the `NEEDS-DECISION` on `SCAFFOLDED_SUCCESS_KIND`: a hint-assisted success must not
   * buy spaced-repetition durability. Emitting `'seen'` achieves that, because `ingest()`'s
   * `isRetrieval` test covers only recalled/distinguished/applied.
   */
  it('a scaffolded success earns NO retrieval credit and no durability', () => {
    const b = bridge();
    withHints(b, 'step-1');
    b.requestHint(ITEM, 'h1');
    const r = b.submitAnswer(ITEM, true);

    let c: ConceptState = emptyConcept('cardio', 'district');
    for (const e of r.evidence) c = ingest(c, e);

    expect(r.outcome).toBe('correct-after-hints');
    expect(c.successfulRetrievals).toBe(0);
    expect(c.lastRetrievedAt).toBeNull();
    expect(c.dimensions.retention).toBe(0);
  });

  it('an unaided success moves retention where a scaffolded one does not', () => {
    const cold = bridge();
    let a: ConceptState = emptyConcept('cardio', 'd');
    for (const e of cold.submitAnswer(ITEM, true).evidence) a = ingest(a, e);

    const helped = bridge();
    withHints(helped, 'step-1');
    helped.requestHint(ITEM, 'h1');
    let bState: ConceptState = emptyConcept('cardio', 'd');
    for (const e of helped.submitAnswer(ITEM, true).evidence) bState = ingest(bState, e);

    expect(a.dimensions.retention).toBeGreaterThan(bState.dimensions.retention);
    expect(mastery(a, NOW)).toBeGreaterThan(mastery(bState, NOW));
  });

  it('a hint request does not decrement durability the way a wrong answer does', () => {
    // Both are negative, but a request for help is weaker evidence than a committed wrong answer.
    const seeded = (): ConceptState => ({
      ...emptyConcept('cardio', 'd'), successfulRetrievals: 3, lastRetrievedAt: NOW - 1000,
    });

    const asked = bridge();
    withHints(asked, 'step-1');
    let afterHint = seeded();
    for (const e of asked.requestHint(ITEM, 'h1').evidence) afterHint = ingest(afterHint, e);

    let afterWrong = seeded();
    for (const e of bridge().submitAnswer(ITEM, false).evidence) afterWrong = ingest(afterWrong, e);

    expect(afterHint.successfulRetrievals).toBe(3);      // untouched
    expect(afterWrong.successfulRetrievals).toBe(2);     // failed retrieval costs durability
  });

  it('emits one event per skill on a multi-skill item, all sharing a timestamp', () => {
    const b = bridge();
    const r = b.submitAnswer({ stepId: 's', skillIds: ['cardio', 'renal', 'endo'] }, true);
    expect(r.evidence).toHaveLength(3);
    expect(r.evidence.map(e => e.conceptId)).toEqual(['cardio', 'renal', 'endo']);
    expect(new Set(r.evidence.map(e => e.at))).toEqual(new Set([NOW]));
    expect(new Set(r.evidence.map(e => e.id)).size).toBe(3);   // ids are unique
  });

  it('maps skills to concepts when they differ', () => {
    const b = bridge();
    const r = b.submitAnswer({
      stepId: 's', skillIds: ['skill-a'], conceptFor: id => `concept:${id}`,
    }, true);
    expect(r.evidence[0]!.conceptId).toBe('concept:skill-a');
  });

  it('passes difficulty through, and omits it when unset', () => {
    expect(bridge().submitAnswer({ ...ITEM, difficulty: 0.8 }, true).evidence[0]!.difficulty)
      .toBe(0.8);
    expect(bridge().submitAnswer(ITEM, true).evidence[0]!.difficulty).toBeUndefined();
  });

  it('deduplicates a repeated skill so the model is not double-credited', () => {
    const r = bridge().submitAnswer({ stepId: 's', skillIds: ['a', 'a', 'b'] }, true);
    expect(r.evidence).toHaveLength(2);
  });
});

describe('requesting a hint measurably lowers subsequent mastery', () => {
  /**
   * The whole point of "hint request = negative evidence" (OATutor `ProblemCard.js:354-357`).
   * Because the hint request consumes the step's first-attempt credit, the later correct answer
   * cannot recover the loss — which is what makes help cost something instead of being free.
   */
  it('leaves BKT mastery strictly lower than answering cold, on identical final answers', () => {
    const cold = bridge();
    withHints(cold, 'step-1');
    cold.submitAnswer(ITEM, true);
    const coldMastery = cold.tracker.get('cardio');

    const helped = bridge();
    withHints(helped, 'step-1');
    helped.requestHint(ITEM, 'h1');
    helped.submitAnswer(ITEM, true);
    const helpedMastery = helped.tracker.get('cardio');

    expect(helpedMastery).toBeLessThan(coldMastery);
    expect(coldMastery).toBeGreaterThan(0.3);      // cold answer moved it up
    expect(helpedMastery).toBeLessThan(0.3);       // the hint booked a wrong answer
  });

  it('reports the mastery drop on the hint request itself', () => {
    const b = bridge();
    withHints(b, 'step-1');
    const r = b.requestHint(ITEM, 'h1');
    expect(r.scored).toBe(true);
    expect(r.masteryAfter['cardio']!).toBeLessThan(r.masteryBefore['cardio']!);
  });

  it('charges the penalty once, no matter how many hints are opened', () => {
    const one = bridge(); withHints(one, 'step-1');
    one.requestHint(ITEM, 'h1');

    const many = bridge(); const m = withHints(many, 'step-1');
    many.requestHint(ITEM, 'h1');
    many.requestHint(ITEM, 'h2');
    many.answerScaffold('step-1', 'h2', true);
    many.requestHint(ITEM, 'h3');
    expect(m.hintsUsed()).toBe(3);

    expect(many.tracker.get('cardio')).toBeCloseTo(one.tracker.get('cardio'), 12);
  });

  it('lowers mastery on EVERY skill of a multi-skill step', () => {
    const b = bridge();
    const multi: TutorItem = { stepId: 'step-1', skillIds: ['cardio', 'renal'] };
    withHints(b, 'step-1');
    b.requestHint(multi, 'h1');
    expect(b.tracker.get('cardio')).toBeLessThan(0.3);
    expect(b.tracker.get('renal')).toBeLessThan(0.3);
  });

  it('does not charge a learner who already solved the step', () => {
    const b = bridge();
    withHints(b, 'step-1');
    b.submitAnswer(ITEM, true);
    const after = b.tracker.get('cardio');
    const r = b.requestHint(ITEM, 'h1');
    expect(r.scored).toBe(false);
    expect(r.evidence).toHaveLength(0);
    expect(b.tracker.get('cardio')).toBe(after);
  });

  it('books nothing for a refused hint request', () => {
    const b = bridge();
    withHints(b, 'step-1');
    // 'h3' is locked behind the scaffold.
    const r = b.requestHint(ITEM, 'h3');
    expect(r.hint?.refusal).toBe('locked');
    expect(r.scored).toBe(false);
    expect(r.evidence).toHaveLength(0);
    expect(b.tracker.get('cardio')).toBe(0.3);
  });

  it('books nothing when there is no hint machine attached', () => {
    const b = bridge();
    const r = b.requestHint(ITEM, 'h1');
    expect(r.hint?.refusal).toBe('unknown-hint');
    expect(b.tracker.get('cardio')).toBe(0.3);
  });

  it('an auto-opened hint costs the learner nothing', () => {
    const b = bridge();
    const m = withHints(b, 'step-1');
    m.noteAutoOpen('h1');                    // platform's decision, not the learner's
    expect(b.tracker.get('cardio')).toBe(0.3);
    // But the answer that follows is still correctly classified as assisted.
    expect(b.submitAnswer(ITEM, true).outcome).toBe('correct-after-hints');
  });
});

describe('scaffolds are formative', () => {
  it('answering a scaffold touches neither BKT nor the learner model', () => {
    const b = bridge();
    withHints(b, 'step-1');
    b.requestHint(ITEM, 'h1');
    const afterHint = b.tracker.get('cardio');

    b.requestHint(ITEM, 'h2');
    expect(b.answerScaffold('step-1', 'h2', false)?.ok).toBe(false);
    expect(b.answerScaffold('step-1', 'h2', true)?.ok).toBe(true);
    expect(b.tracker.get('cardio')).toBe(afterHint);
  });

  it('returns null for a step with no hint machine', () => {
    expect(bridge().answerScaffold('nope', 'h2', true)).toBeNull();
  });
});

describe('first-attempt-only scoring holds through the bridge', () => {
  it('ignores a retry after a wrong first answer', () => {
    const b = bridge();
    const first = b.submitAnswer(ITEM, false);
    expect(first.scored).toBe(true);
    const afterWrong = b.tracker.get('cardio');

    const retry = b.submitAnswer(ITEM, true);
    expect(retry.scored).toBe(false);
    expect(b.tracker.get('cardio')).toBe(afterWrong);
    // The outcome is still reported honestly even though it did not score.
    expect(retry.outcome).toBe('correct-first-try');
  });

  it('reports before/after snapshots that are equal when nothing scored', () => {
    const b = bridge();
    b.submitAnswer(ITEM, true);
    const again = b.submitAnswer(ITEM, true);
    expect(again.masteryBefore).toEqual(again.masteryAfter);
  });

  it('still scores a different step', () => {
    const b = bridge();
    b.submitAnswer(ITEM, true);
    const other = b.submitAnswer({ ...ITEM, stepId: 'step-2' }, true);
    expect(other.scored).toBe(true);
  });
});

describe('determinism', () => {
  it('a replayed session produces byte-identical evidence', () => {
    const run = () => {
      const b = bridge();
      withHints(b, 'step-1');
      const out = [
        ...b.requestHint(ITEM, 'h1').evidence,
        ...b.submitAnswer(ITEM, true).evidence,
        ...b.submitAnswer({ ...ITEM, stepId: 'step-2' }, false).evidence,
      ];
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });

  it('hands out its tracker so selection can read the same state', () => {
    const b = bridge();
    b.submitAnswer(ITEM, true);
    expect(b.tracker.get('cardio')).toBeGreaterThan(0.3);
    expect(b.hintsFor('step-1')).toBeNull();
    withHints(b, 'step-1');
    expect(b.hintsFor('step-1')).not.toBeNull();
  });
});
