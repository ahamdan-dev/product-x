/**
 * Next Move — the answer to "What should I do next?"
 *
 * This is the engine behind the Today surface, and it is deliberately pure: districts and concepts in,
 * a ranked list of moves out. No React, no clock reads, no store access. That is what makes it
 * testable, and it is the only reason the ranking can be trusted on stage.
 *
 * Two rules it exists to enforce:
 *
 * 1. **Every move cites its evidence.** The recommendation text comes from `findings()` in the learner
 *    model, which already returns an interpretation, an action, and the evidence ids that justify it.
 *    Nothing here writes a new reason — if the model cannot justify a move, the move does not appear.
 *    That is the "Why this?" affordance being structural rather than decorative.
 *
 * 2. **Ranking is by cost of NOT doing it, not by weakness.** Weakest-first is the obvious ranking and
 *    it is wrong: the weakest subject is often one that has barely been started, where an hour buys
 *    little, while a subject that was mastered and is now slipping loses real earned ground every day
 *    it is left. So a decaying strength outranks a never-started weakness. `spacedRetrieval` in the
 *    tutor engine makes the same argument at item level; this applies it at subject level.
 */

import {
  findings, mastery, peakMastery, retrievability, worldState,
  type ConceptState, type Finding, type WorldState,
} from '../learner/model';
import { subject, promptAt, type Prompt } from '../content/subjects';

/**
 * Why this move is being recommended. Ordered by urgency, and each one is a genuinely different
 * *kind* of problem needing a different *kind* of work — which is the point. A single "priority"
 * number would collapse them and lose the instruction.
 */
export type MoveKind =
  /** Sources disagree. More questions will not settle it; transfer evidence will. */
  | 'settle'
  /** Earned once, slipping now. Retrieval, not relearning. */
  | 'restore'
  /** Can explain it, has not applied it. The comprehension–application gap. */
  | 'apply'
  /** Actively developing. Ordinary forward work. */
  | 'build'
  /** Not enough evidence to say anything. A short check buys information. */
  | 'probe'
  /** Holding across the board. The honest recommendation is to stop. */
  | 'leave';

/** How urgent each kind is. Higher wins. See the file header for why decay outranks weakness. */
const KIND_URGENCY: Record<MoveKind, number> = {
  settle: 5,
  restore: 4,
  apply: 3,
  build: 2,
  probe: 1,
  leave: 0,
};

/** Minutes each kind of work actually takes. Shown to the learner, so it must be honest. */
const KIND_MINUTES: Record<MoveKind, number> = {
  settle: 20,   // two novel cases
  restore: 8,   // a retrieval pass, scaled below by how far it has slipped
  apply: 15,    // one case where the concept is not named
  build: 25,    // a full focus block
  probe: 5,     // a short check
  leave: 0,
};

export interface Move {
  /** District id — `subject()` and the store's `DISTRICTS` both key on this. */
  id: string;
  /** The concept id the evidence actually lives under. */
  conceptId: string;
  label: string;
  kind: MoveKind;
  /** What is going on, in learner-model terms. Never a raw statistic. */
  interpretation: string;
  /** What to do about it. */
  action: string;
  /** Evidence ids justifying this. Powers "Why this?" — never empty for a model-derived move. */
  because: readonly string[];
  /** Honest estimate, minutes. */
  minutes: number;
  /** Live mastery 0..1, for the conviction ramp. */
  mastery: number;
  /** Estimate confidence 0..1 — the fog line. Low means "we do not know", not "you are bad". */
  confidence: number;
  /** The world state this subject is in, so Today and the Map agree. */
  state: WorldState;
  /** A real retrieval prompt to open with, so the move is one click from actual work. */
  prompt?: Prompt;
  /** Ranking score. Exposed for tests and debugging, not for display. */
  score: number;
}

/**
 * Classify a concept into the one kind of work it most needs.
 *
 * Order matters: the checks run most-urgent-first and the first match wins, because a subject whose
 * sources disagree AND which is slipping should be *settled* first — resolving the disagreement tells
 * you whether the slipping is even real.
 */
export function classify(c: ConceptState, now: number): MoveKind {
  if (c.estimateConfidence < 0.25) return 'probe';
  if (c.evidenceConflict > 0.22) return 'settle';

  const live = mastery(c, now);
  const peak = peakMastery(c);
  const r = retrievability(c, now);

  if (peak >= 0.70 && r < 0.55) return 'restore';

  const { comprehension, application } = c.dimensions;
  if (comprehension > 0.62 && application < comprehension - 0.24) return 'apply';

  if (live >= 0.82 && c.evidenceConflict <= 0.22) return 'leave';
  return 'build';
}

/**
 * Score a move. Urgency dominates; the rest breaks ties within a kind.
 *
 * The `decayGap` term is what makes this more than a sort by kind: between two subjects both slipping,
 * the one that has lost more of what it had earned goes first, because that is where the most work is
 * about to be wasted.
 */
function score(c: ConceptState, kind: MoveKind, now: number): number {
  const live = mastery(c, now);
  const peak = peakMastery(c);
  const decayGap = Math.max(0, peak - live);

  // Urgency is scaled well clear of the tie-breakers so a kind can never be out-ranked by them.
  let s = KIND_URGENCY[kind] * 100;

  s += decayGap * 40;              // earned ground actively being lost
  s += c.evidenceConflict * 30;    // unresolved disagreement is expensive to leave
  s += (1 - c.estimateConfidence) * 10;  // we would rather know than guess

  // 'leave' is a real recommendation, but it must never head the list. Force it below everything.
  if (kind === 'leave') s = Math.min(s, 50);

  return s;
}

/** Minutes for a move, adjusted where the model can be more specific than the kind's default. */
function minutesFor(c: ConceptState, kind: MoveKind, now: number): number {
  if (kind !== 'restore') return KIND_MINUTES[kind];
  // Matches `findings()`: the further retrievability has fallen, the longer the pass. Floor of 4 —
  // below that it is not a study block, it is a glance.
  return Math.max(4, Math.round(8 * retrievability(c, now)));
}

/**
 * The finding that best explains a move.
 *
 * `findings()` can return several; picking by severity rather than by array position means the copy
 * shown to the learner is the most consequential one, not whichever check happened to run first.
 */
function bestFinding(fs: readonly Finding[]): Finding | undefined {
  const RANK = { critical: 0, notable: 1, informational: 2 } as const;
  return [...fs].sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
}

/** Fallback copy for the rare case where `findings()` returns nothing for a live concept. */
const FALLBACK: Record<MoveKind, { interpretation: string; action: string }> = {
  settle:  { interpretation: 'Your sources disagree here.', action: 'Two novel cases will settle it.' },
  restore: { interpretation: 'This is slipping from where you had it.', action: 'A short retrieval pass, not a reread.' },
  apply:   { interpretation: 'You can explain this but have not used it.', action: 'One case where it is not named.' },
  build:   { interpretation: 'This is developing and moving in the right direction.', action: 'Keep going — one focus block.' },
  probe:   { interpretation: 'There is not enough evidence yet to know where you stand.', action: 'A short check tells me more than a reread.' },
  leave:   { interpretation: 'This is holding across recall, reasoning and application.', action: 'Stop studying this — your time is worth more elsewhere.' },
};

export interface District {
  id: string;
  label: string;
  conceptIds: string[];
}

/**
 * Rank every district into a move. Pure: `now` is injected so tests and screenshots can pin it.
 *
 * Districts with no evidence at all are included as `probe` moves rather than dropped — "I do not
 * know anything about your dermatology yet" is genuinely useful, and silently omitting untouched
 * subjects would make the list look complete when it is not.
 */
export function nextMoves(
  districts: readonly District[],
  concepts: Record<string, ConceptState>,
  now: number,
): Move[] {
  const moves: Move[] = [];

  for (const d of districts) {
    // One concept per district today (`<id>.core`), but written to fold several so adding
    // sub-concepts later does not require rewriting the ranking.
    const cs = d.conceptIds
      .map(id => concepts[id])
      .filter((c): c is ConceptState => !!c);
    if (cs.length === 0) continue;

    // The concept in the most urgent state represents its district.
    const rep = cs.reduce((worst, c) =>
      score(c, classify(c, now), now) > score(worst, classify(worst, now), now) ? c : worst);

    const kind = classify(rep, now);
    const fs = findings(rep, now, d.label);
    const f = bestFinding(fs);
    const fb = FALLBACK[kind];

    /**
     * Evidence for the "Why this?" disclosure.
     *
     * `findings()` deliberately has no branch for ordinary forward work — it reports problems, and a
     * concept that is simply developing normally is not a problem. That left `build` moves with an
     * empty citation, so the one move type a learner sees most often was the one that could not
     * justify itself. Falling back to the concept's own recent event ids fixes that: the citation is
     * the same evidence the model actually used, just not routed through a finding.
     */
    const because = f?.because ?? rep.events.slice(-6).map(e => e.id);

    // Deterministic prompt choice, keyed to the subject id — see `promptAt`. A random pick would make
    // a visual regression indistinguishable from noise.
    const prompt = promptAt(d.id, d.label.length);

    moves.push({
      id: d.id,
      conceptId: rep.conceptId,
      label: d.label,
      kind,
      interpretation: f?.interpretation ?? fb.interpretation,
      action: f?.action ?? fb.action,
      because,
      minutes: minutesFor(rep, kind, now),
      mastery: mastery(rep, now),
      confidence: rep.estimateConfidence,
      state: worldState(rep, now),
      ...(prompt ? { prompt } : {}),
      score: score(rep, kind, now),
    });
  }

  // Descending score; label as the tie-break so the order is stable rather than dependent on input
  // order, which would make the list shuffle between runs for no visible reason.
  return moves.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/**
 * The single headline move plus the runners-up.
 *
 * Today shows ONE recommendation prominently. A list of nine equal options is not an answer to "what
 * should I do next?" — it is the same decision handed back to the learner with extra steps.
 */
export function headline(moves: readonly Move[]): { lead: Move | undefined; rest: Move[] } {
  return { lead: moves[0], rest: moves.slice(1) };
}

/** Human label for a kind. UI copy lives with the engine so the two cannot disagree. */
export const KIND_LABEL: Record<MoveKind, string> = {
  settle: 'Settle a disagreement',
  restore: 'Restore',
  apply: 'Apply it',
  build: 'Build',
  probe: 'Find out',
  leave: 'Leave it',
};

/** One-word verb for the action button. */
export const KIND_VERB: Record<MoveKind, string> = {
  settle: 'Run two cases',
  restore: 'Start retrieval',
  apply: 'Open a case',
  build: 'Start a block',
  probe: 'Quick check',
  leave: 'Skip',
};

/** A subject's pearl, for the card back. Kept here so Today imports one module, not two. */
export function pearlFor(id: string): string | undefined {
  return subject(id)?.pearl;
}
