/**
 * The bridge — where the tutor stops being a generic BKT library and becomes part of this product.
 *
 * Two learner models coexist here on purpose, and they answer different questions:
 *
 *   - **BKT** (`skills.ts`) answers "can they do this *right now*, given how they've performed on
 *     this skill". It is per-opportunity, has no clock, and is what drives item selection.
 *   - **The learner model** (`../learner/model.ts`) answers "what do they actually know, across
 *     five competency dimensions, decaying in real elapsed time, weighted by how trustworthy each
 *     source is". It is the product.
 *
 * The bridge's whole job is to translate a tutor event into evidence the second model will accept,
 * without lying to it. The central requirement: **a tutor that scores "got it after three hints"
 * the same as "got it cold" is worthless.** That distinction is preserved twice over — once in
 * which BKT observation gets booked, and once in which `EvidenceKind` is emitted.
 */

import type { EvidenceEvent, EvidenceKind, EvidenceSource } from '../learner/model';
import { SkillTracker } from './skills';
import { HintMachine, type HintOutcome } from './hints';

/**
 * The four tutor outcomes that must stay distinguishable downstream. This is the vocabulary the
 * task defines, and every one of them maps to a different `(kind, correct)` pair below.
 */
export type TutorOutcome =
  | 'correct-first-try'      // solved it cold, unaided
  | 'correct-after-hints'    // solved it, but with scaffolding
  | 'incorrect'              // attempted and got it wrong
  | 'hint-requested';        // asked for help before producing an answer

/**
 * What kind of cognitive work the item demanded. This selects which `EvidenceKind` an unaided
 * success maps to, because "recalled a fact" and "applied it in a novel vignette" are not the same
 * achievement and the learner model weights them very differently (`KIND_WEIGHTS`).
 */
export type ItemDemand =
  | 'recall'        // produce the fact -> 'recalled'
  | 'discriminate'  // pick it out of tempting alternatives -> 'distinguished'
  | 'apply';        // use it in a novel clinical scenario -> 'applied'

/** `ItemDemand` -> the retrieval `EvidenceKind` it evidences. All three exist in the union. */
const DEMAND_TO_KIND: Record<ItemDemand, EvidenceKind> = {
  recall: 'recalled',
  discriminate: 'distinguished',
  apply: 'applied',
};

/**
 * NEEDS-DECISION: scaffolded success has no dedicated `EvidenceKind`, so it is emitted as `'seen'`
 * with `correct: true`.
 *
 * The problem: `EvidenceKind` has no value meaning "produced it, but only with help". The four
 * outcomes must stay distinguishable in the emitted evidence, and the honest reading of a
 * hint-assisted success is that it demonstrates *exposure and some comprehension* but explicitly
 * **not** unaided retrieval.
 *
 * `'seen'` carries exactly that weighting already — `KIND_WEIGHTS.seen` is
 * `{ coverage: 0.85, comprehension: 0.15 }`, with no retention and no application credit. Better
 * still, `ingest()`'s `isRetrieval` test covers only `recalled | distinguished | applied`, so
 * emitting `'seen'` means a scaffolded success does **not** reset the decay clock and does **not**
 * increment `successfulRetrievals`. That is precisely the desired behaviour: help you to the answer
 * and you have not earned spaced-repetition durability.
 *
 * The deviation: `model.ts` documents `correct` as "null for 'seen' (exposure carries no
 * correctness)". We set `correct: true` here so that scaffolded success is distinguishable from
 * plain exposure (`'seen'` + `null`) and from a failed start (`'seen'` + `false`). Nothing in
 * `ingest()` breaks — a non-null `correct` on `'seen'` simply enables the difficulty bonus and
 * feeds `computeConflict`, both of which are correct for something the learner actually answered.
 *
 * The alternative was adding an eighth kind (`'scaffolded'`) to the union, which would touch
 * `KIND_WEIGHTS`, the 7-state profile the research report specifies verbatim, and every exhaustive
 * switch over `EvidenceKind` in the codebase. Not a call to make silently from inside the tutor —
 * hence this marker rather than a quiet edit.
 */
const SCAFFOLDED_SUCCESS_KIND: EvidenceKind = 'seen';

/**
 * NEEDS-DECISION: a hint request before answering is emitted as `'seen'` with `correct: false`.
 *
 * Same gap, negative side. Asking for help before producing anything is a real negative signal —
 * OATutor books it as a wrong answer (`ProblemCard.js:354-357`) and we keep that on the BKT side.
 * But it is *weaker* evidence than a scored wrong answer: the learner never committed to anything,
 * so we don't know whether they'd have got it.
 *
 * `'seen'` + `correct: false` gives it the shape we want: `ingest()` pulls back coverage and
 * comprehension a little, and because `'seen'` is not a retrieval kind it does **not** decrement
 * `successfulRetrievals` the way a failed retrieval does. A wrong *answer* should cost durability;
 * a request for help shouldn't cost quite as much. Closest existing kind, no invented values.
 */
const HINT_REQUEST_KIND: EvidenceKind = 'seen';

/** The default source for anything the tutor itself observed. */
const DEFAULT_SOURCE: EvidenceSource = 'x-tutor';

/** One item the tutor can present. Content lives elsewhere; this is only what the engine needs. */
export interface TutorItem {
  /** Step id. Also the key for first-attempt bookkeeping and the hint machine. */
  stepId: string;
  /** Knowledge components this step exercises — the Q-matrix row. */
  skillIds: readonly string[];
  /** What kind of work it demands. Defaults to `recall`. */
  demand?: ItemDemand;
  /**
   * Which product surface this item belongs to. Governs `SOURCE_RELIABILITY`, so it materially
   * changes how much the evidence counts. Defaults to `x-tutor`.
   */
  source?: EvidenceSource;
  /** 0..1 authored difficulty, passed through to the evidence. */
  difficulty?: number;
  /** Per-item guess/slip (pyBKT `multigs`) — an MCQ's pGuess is not free text's pGuess. */
  itemParams?: { pGuess?: number; pSlip?: number };
  /**
   * Skill id -> concept id, when they differ. Evidence is booked per *concept*; skills and concepts
   * are 1:1 in the current content model, so this defaults to identity.
   */
  conceptFor?: (skillId: string) => string;
}

/** What one tutor interaction did, to both models. */
export interface TutorReport {
  outcome: TutorOutcome;
  /** Evidence to feed to `ingest()`. One event per skill/concept the item touched. */
  evidence: EvidenceEvent[];
  /** BKT mastery per skill, before and after. Same keys. */
  masteryBefore: Record<string, number>;
  masteryAfter: Record<string, number>;
  /** Did this interaction actually move BKT? False once a step's first-attempt credit is spent. */
  scored: boolean;
  /** How many hints the learner had opened when this happened. */
  hintsUsed: number;
  /** Present on hint requests: the raw hint-machine result, including refusals. */
  hint?: HintOutcome;
}

export interface TutorBridgeOptions {
  tracker?: SkillTracker;
  /** Injected clock. Evidence timestamps must be deterministic under test. */
  now?: () => number;
  /**
   * Evidence id factory. Defaults to a monotonic per-session counter rather than a random id, so
   * a replayed session produces byte-identical evidence — the same reason selection is
   * deterministic.
   */
  nextEventId?: () => string;
}

/**
 * Wires the hint machine and the skill tracker together and emits learner-model evidence.
 *
 * Owns no content and no UI. One instance per learner session.
 */
export class TutorBridge {
  readonly tracker: SkillTracker;
  private readonly now: () => number;
  private readonly nextEventId: () => string;
  private machines = new Map<string, HintMachine>();
  private seq = 0;

  constructor(opts: TutorBridgeOptions = {}) {
    this.tracker = opts.tracker ?? new SkillTracker();
    this.now = opts.now ?? (() => Date.now());
    this.nextEventId = opts.nextEventId ?? (() => `tutor-${++this.seq}`);
  }

  /** Attach a built hint graph's machine to a step, so hint requests can be routed to it. */
  attachHints(stepId: string, machine: HintMachine): void {
    this.machines.set(stepId, machine);
  }

  hintsFor(stepId: string): HintMachine | null {
    return this.machines.get(stepId) ?? null;
  }

  /**
   * The learner submitted an answer.
   *
   * Outcome resolution is the whole point of this method: a correct answer is
   * `correct-first-try` only if the learner had not opened a single hint. Once they have, the same
   * keystrokes are `correct-after-hints` and are evidenced completely differently.
   */
  submitAnswer(item: TutorItem, correct: boolean): TutorReport {
    const machine = this.machines.get(item.stepId);
    const hintsUsed = machine?.hintsUsed() ?? 0;
    machine?.noteAnswer(correct);

    const outcome: TutorOutcome = correct
      ? (hintsUsed > 0 ? 'correct-after-hints' : 'correct-first-try')
      : 'incorrect';

    const masteryBefore = this.snapshotOf(item.skillIds);
    // First-attempt-only scoring, and — critically — every KC on the step, not just the first.
    const scored = this.tracker.observeStep(item.stepId, item.skillIds, correct, {
      itemParams: item.itemParams,
    });
    const masteryAfter = this.snapshotOf(item.skillIds);

    return {
      outcome,
      evidence: this.evidenceFor(item, outcome),
      masteryBefore,
      masteryAfter,
      scored,
      hintsUsed,
    };
  }

  /**
   * The learner asked for a hint.
   *
   * Books negative evidence on the first help request against an unsolved step, matching
   * OATutor `ProblemCard.js:354-357`. Because that consumes the step's first-attempt credit, a
   * later correct answer cannot recover the loss — which is exactly what makes hint use *cost*
   * something instead of being free.
   *
   * A refused request (locked, unknown, already open) books nothing.
   */
  requestHint(item: TutorItem, hintId: string): TutorReport {
    const machine = this.machines.get(item.stepId);
    if (!machine) {
      return this.inertReport('hint-requested', item, {
        ok: false, refusal: 'unknown-hint', hintId: null, kind: null,
        status: 0, bookedNegativeEvidence: false,
      });
    }

    const hintsUsedBefore = machine.hintsUsed();
    const hint = machine.requestHint(hintId);

    if (!hint.bookedNegativeEvidence) {
      // Either refused, or the step already paid its penalty / was already solved.
      const report = this.inertReport('hint-requested', item, hint);
      report.hintsUsed = hintsUsedBefore;
      return report;
    }

    const masteryBefore = this.snapshotOf(item.skillIds);
    const scored = this.tracker.observeStep(item.stepId, item.skillIds, false, {
      itemParams: item.itemParams,
    });
    const masteryAfter = this.snapshotOf(item.skillIds);

    return {
      outcome: 'hint-requested',
      evidence: this.evidenceFor(item, 'hint-requested'),
      masteryBefore,
      masteryAfter,
      scored,
      hintsUsed: hintsUsedBefore,
      hint,
    };
  }

  /** Answer a scaffold. Formative by design: touches neither BKT nor the learner model. */
  answerScaffold(stepId: string, hintId: string, correct: boolean): HintOutcome | null {
    return this.machines.get(stepId)?.answerScaffold(hintId, correct) ?? null;
  }

  /**
   * Pure exposure — the learner read the material without being assessed. `'seen'` with
   * `correct: null`, which is the convention `model.ts` documents, and what keeps the two
   * `'seen'` outcomes above distinguishable from an ordinary read.
   */
  noteExposure(item: TutorItem): EvidenceEvent[] {
    return this.buildEvents(item, SCAFFOLDED_SUCCESS_KIND, null);
  }

  /**
   * The `(kind, correct)` mapping table, and the only place outcomes become evidence.
   *
   * | outcome              | kind                        | correct | retrieval? |
   * |----------------------|-----------------------------|---------|------------|
   * | correct-first-try    | recalled/distinguished/applied | true  | yes        |
   * | correct-after-hints  | seen                        | true    | no         |
   * | incorrect            | recalled/distinguished/applied | false | yes        |
   * | hint-requested       | seen                        | false   | no         |
   *
   * All four rows are distinct, and the two `'seen'` rows are distinct from plain exposure
   * (`seen` + `null`). The asymmetry is deliberate: only unaided work is booked as retrieval, so
   * only unaided work earns durability from `ingest()`.
   */
  private evidenceFor(item: TutorItem, outcome: TutorOutcome): EvidenceEvent[] {
    const demandKind = DEMAND_TO_KIND[item.demand ?? 'recall'];

    switch (outcome) {
      case 'correct-first-try':
        return this.buildEvents(item, demandKind, true);
      case 'correct-after-hints':
        return this.buildEvents(item, SCAFFOLDED_SUCCESS_KIND, true);
      case 'incorrect':
        return this.buildEvents(item, demandKind, false);
      case 'hint-requested':
        return this.buildEvents(item, HINT_REQUEST_KIND, false);
    }
  }

  private buildEvents(
    item: TutorItem,
    kind: EvidenceKind,
    correct: boolean | null,
  ): EvidenceEvent[] {
    const at = this.now();
    const source = item.source ?? DEFAULT_SOURCE;
    const toConcept = item.conceptFor ?? ((skillId: string) => skillId);

    const out: EvidenceEvent[] = [];
    const seen = new Set<string>();
    for (const skillId of item.skillIds) {
      if (!skillId || seen.has(skillId)) continue;
      seen.add(skillId);
      const event: EvidenceEvent = {
        id: this.nextEventId(),
        conceptId: toConcept(skillId),
        kind,
        source,
        at,
        correct,
      };
      if (item.difficulty !== undefined) event.difficulty = item.difficulty;
      out.push(event);
    }
    return out;
  }

  private snapshotOf(skillIds: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const skillId of skillIds) {
      if (skillId) out[skillId] = this.tracker.get(skillId);
    }
    return out;
  }

  private inertReport(outcome: TutorOutcome, item: TutorItem, hint: HintOutcome): TutorReport {
    const snap = this.snapshotOf(item.skillIds);
    return {
      outcome,
      evidence: [],
      masteryBefore: snap,
      masteryAfter: snap,
      scored: false,
      hintsUsed: this.machines.get(item.stepId)?.hintsUsed() ?? 0,
      hint,
    };
  }
}

/**
 * Was this outcome unaided? The single predicate the rest of the app should use rather than
 * re-deriving the distinction, so "got it cold" and "got it with help" can never collapse into
 * one code path by accident.
 */
export function isUnaidedSuccess(outcome: TutorOutcome): boolean {
  return outcome === 'correct-first-try';
}

/** Does this outcome evidence genuine retrieval, i.e. should it earn durability? */
export function isRetrievalOutcome(outcome: TutorOutcome): boolean {
  return outcome === 'correct-first-try' || outcome === 'incorrect';
}
