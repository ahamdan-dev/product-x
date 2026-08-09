/**
 * The hint machine — a dependency DAG with ternary satisfaction.
 *
 * This is the one piece of OATutor worth porting almost intact, because the mechanism is subtle and
 * correct: each hint holds one of three values, and a hint unlocks only when **every** dependency
 * is exactly satisfied.
 *
 *   `0`   locked / untouched                       (`ProblemCard.js:144`)
 *   `0.5` scaffold opened but not yet answered     (`ProblemCard.js:364`)
 *   `1`   satisfied — hint read, or scaffold solved (`ProblemCard.js:364`, `:402`)
 *
 * The important consequence, from `HintSystem.js:72-81`: `0.5` does not satisfy a dependency. An
 * opened-but-unanswered scaffold therefore **blocks everything downstream of it**, including the
 * solution. That is the entire mechanism preventing a learner from speed-running a chain of hints
 * to the answer without engaging with any of them, and it is preserved exactly.
 *
 * Divergences from the original, each at the code that implements it:
 *   1. Dependencies are authored as ids and resolved to indices **once**, at build time, with a
 *      hard error on an unresolvable id. OATutor's `_findHintId` returns `-1` and carries on.
 *   2. Cycles are detected at build time and throw with the cycle path.
 *   3. Nesting depth is validated, not assumed.
 */

export type HintKind = 'hint' | 'scaffold' | 'solution' | 'bottomOut';

/** The ternary satisfaction value. Named because `0.5` on its own reads like a typo. */
export type HintStatus = 0 | 0.5 | 1;

export const LOCKED = 0 satisfies HintStatus;
export const OPENED_UNANSWERED = 0.5 satisfies HintStatus;
export const SATISFIED = 1 satisfies HintStatus;

/** A hint as authored. Dependencies are ids — never indices. */
export interface HintSpec {
  id: string;
  kind: HintKind;
  /** Ids of hints that must be fully satisfied before this one unlocks. */
  dependencies?: readonly string[];
  title?: string;
  text?: string;
  /** Accepted answers. Present iff `kind === 'scaffold'` — a scaffold is an answerable hint. */
  answer?: readonly string[];
  /** Nested help, allowed on scaffolds only, and exactly one level deep. */
  subHints?: readonly HintSpec[];
}

/** A hint after the graph is built. `dependencies` are now real indices into `hints`. */
export interface ResolvedHint {
  id: string;
  kind: HintKind;
  index: number;
  title: string;
  text: string;
  answer: readonly string[];
  /** Resolved once, at build time. Every entry is a valid index — never `-1`. */
  dependencies: readonly number[];
  /** Kept for error messages and telemetry. */
  dependencyIds: readonly string[];
  /** One level of nesting, its own little graph. Null for everything except scaffolds. */
  subGraph: HintGraph | null;
}

export interface HintGraph {
  hints: readonly ResolvedHint[];
  byId: ReadonlyMap<string, number>;
  /** Depth of this graph: 0 for a step's own hints, 1 for a scaffold's sub-hints. */
  depth: number;
}

export class HintGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HintGraphError';
  }
}

export interface BuildOptions {
  /**
   * Append a synthesized bottom-out hint that gives the answer away, depending on **every** prior
   * hint so it is unreachable until the whole chain is satisfied (OATutor
   * `ProblemCard.js:101-112`). Guarantees no dead end without offering a shortcut.
   */
  bottomOut?: { id?: string; title?: string; text: string };
  /** Internal: nesting depth, for the one-level validation. */
  depth?: number;
}

/**
 * Build and validate a hint graph. Throws on any structural problem — this is content-build-time
 * validation, and every one of these conditions is an authoring mistake that would otherwise
 * surface as bizarre runtime behaviour.
 */
export function buildHintGraph(specs: readonly HintSpec[], opts: BuildOptions = {}): HintGraph {
  const depth = opts.depth ?? 0;
  const all: HintSpec[] = [...specs];

  if (opts.bottomOut) {
    // Depends on every authored hint, so it sits at the end of the chain by construction.
    all.push({
      id: opts.bottomOut.id ?? `${all[0]?.id ?? 'hint'}-bottom-out`,
      kind: 'bottomOut',
      title: opts.bottomOut.title ?? 'Answer',
      text: opts.bottomOut.text,
      dependencies: specs.map(s => s.id),
    });
  }

  // --- ids must exist and be unique -------------------------------------------------------------
  const byId = new Map<string, number>();
  all.forEach((spec, index) => {
    if (!spec.id) {
      throw new HintGraphError(`hint at index ${index} has no id; ids are required and must be stable`);
    }
    if (byId.has(spec.id)) {
      throw new HintGraphError(
        `duplicate hint id "${spec.id}" at indices ${byId.get(spec.id)} and ${index}`);
    }
    byId.set(spec.id, index);
  });

  // --- shape validation -------------------------------------------------------------------------
  for (const spec of all) {
    const isScaffold = spec.kind === 'scaffold';
    if (isScaffold && (!spec.answer || spec.answer.length === 0)) {
      throw new HintGraphError(
        `scaffold "${spec.id}" has no answer; a scaffold is an answerable hint, so without an ` +
        `answer it can never reach status 1 and would deadlock everything depending on it`);
    }
    if (!isScaffold && spec.answer && spec.answer.length > 0) {
      throw new HintGraphError(
        `hint "${spec.id}" is kind "${spec.kind}" but declares an answer; only scaffolds are answerable`);
    }
    if (spec.subHints && spec.subHints.length > 0) {
      if (!isScaffold) {
        throw new HintGraphError(
          `hint "${spec.id}" is kind "${spec.kind}" but has subHints; only scaffolds may nest`);
      }
      if (depth >= 1) {
        // README.md:596-598 — "the scaffolds's scaffolds cannot contain any help items".
        throw new HintGraphError(
          `scaffold "${spec.id}" nests more than one level deep; scaffolds nest exactly one level`);
      }
    }
  }

  // --- dependency resolution: ids -> indices, ONCE ----------------------------------------------
  const resolved: ResolvedHint[] = all.map((spec, index) => {
    const dependencyIds = spec.dependencies ?? [];
    const dependencies = dependencyIds.map(depId => {
      const target = byId.get(depId);
      if (target === undefined) {
        // OATutor's `_findHintId` returns -1 here and the caller stores it (ProblemCard.js:83-95).
        // `hintStatus[-1]` is then `undefined`, `undefined === 1` is false... except that a hint
        // whose *only* dependency is dangling stays permanently locked, while the report notes the
        // dual failure: mismatched authoring silently unlocks or silently deadlocks, with no
        // diagnostic either way. Fail loudly at build time instead.
        throw new HintGraphError(
          `hint "${spec.id}" depends on unknown hint id "${depId}". ` +
          `Known ids: ${[...byId.keys()].map(k => `"${k}"`).join(', ')}`);
      }
      if (target === index) {
        throw new HintGraphError(`hint "${spec.id}" depends on itself`);
      }
      return target;
    });

    return {
      id: spec.id,
      kind: spec.kind,
      index,
      title: spec.title ?? '',
      text: spec.text ?? '',
      answer: spec.answer ?? [],
      dependencies,
      dependencyIds,
      subGraph: spec.subHints && spec.subHints.length > 0
        ? buildHintGraph(spec.subHints, { depth: depth + 1 })
        : null,
    };
  });

  detectCycle(resolved);

  return { hints: resolved, byId, depth };
}

/**
 * Depth-first cycle detection over the resolved graph. Throws with the actual cycle path, because
 * "there is a cycle in your hints" is not an actionable error message for a content author.
 */
function detectCycle(hints: readonly ResolvedHint[]): void {
  const UNVISITED = 0, IN_PROGRESS = 1, DONE = 2;
  const mark = new Array<number>(hints.length).fill(UNVISITED);
  const stack: number[] = [];

  const visit = (index: number): void => {
    if (mark[index] === DONE) return;
    if (mark[index] === IN_PROGRESS) {
      const start = stack.indexOf(index);
      const path = [...stack.slice(start), index].map(i => hints[i]!.id);
      throw new HintGraphError(`hint dependency cycle: ${path.join(' -> ')}`);
    }
    mark[index] = IN_PROGRESS;
    stack.push(index);
    for (const dep of hints[index]!.dependencies) visit(dep);
    stack.pop();
    mark[index] = DONE;
  };

  for (let i = 0; i < hints.length; i++) visit(i);
}

/** Why a `requestHint` call did nothing. */
export type HintRefusal = 'unknown-hint' | 'locked' | 'already-satisfied';

export interface HintOutcome {
  ok: boolean;
  refusal?: HintRefusal;
  hintId: string | null;
  kind: HintKind | null;
  status: HintStatus;
  /**
   * True when this request booked negative evidence against the step's skills. Mirrors OATutor
   * `ProblemCard.js:354-357`: the *first* help request on an unsolved step counts as a wrong
   * answer. The caller (see `bridge.ts`) is responsible for actually applying it.
   */
  bookedNegativeEvidence: boolean;
  /** Ids of the unsatisfied dependencies, when the refusal was `locked`. */
  blockedBy?: string[];
}

export interface HintMachineOptions {
  /**
   * Should the first help request book negative evidence? OATutor always does
   * (`ProblemCard.js:354-357`) — including for hints it auto-opened itself
   * (`HintSystem.js:51-57`), which penalises the learner for something the platform decided.
   * Configurable here, and `noteAutoOpen` exists so an auto-opened hint can skip the penalty.
   */
  penalizeFirstHint?: boolean;
}

/**
 * Runtime state for one step's hints. Owns the ternary status array and nothing else — no content,
 * no rendering, no learner model. It reports what happened and lets the bridge decide what that
 * means for the learner model.
 */
export class HintMachine {
  private readonly graph: HintGraph;
  private status: HintStatus[];
  private subStatus: HintStatus[][];
  private stepSolved = false;
  private penaltyBooked = false;
  private readonly penalize: boolean;

  constructor(graph: HintGraph, opts: HintMachineOptions = {}) {
    this.graph = graph;
    this.penalize = opts.penalizeFirstHint ?? true;
    this.status = new Array<HintStatus>(graph.hints.length).fill(LOCKED);
    this.subStatus = graph.hints.map(h =>
      new Array<HintStatus>(h.subGraph?.hints.length ?? 0).fill(LOCKED));
  }

  get hints(): readonly ResolvedHint[] { return this.graph.hints; }

  /** A copy — callers must not be able to reach in and set a status directly. */
  statuses(): HintStatus[] { return [...this.status]; }

  statusOf(hintId: string): HintStatus | null {
    const index = this.graph.byId.get(hintId);
    return index === undefined ? null : this.status[index]!;
  }

  /** How many hints the learner has touched at all. Drives "correct after hints" in the bridge. */
  hintsUsed(): number { return this.status.filter(s => s > LOCKED).length;}

  usedAnyHint(): boolean { return this.hintsUsed() > 0; }

  /** True once the learner has answered the step correctly. Exempts them from the hint penalty. */
  isStepSolved(): boolean { return this.stepSolved; }

  /**
   * Is this hint locked? Hint at index 0 is always open — the entry point to the chain
   * (`HintSystem.js:73-75`). Everything else requires every dependency at exactly `1`.
   */
  isLocked(index: number): boolean {
    if (index === 0) return false;
    const hint = this.graph.hints[index];
    if (!hint) return true;
    return !hint.dependencies.every(dep => this.status[dep] === SATISFIED);
  }

  isLockedById(hintId: string): boolean {
    const index = this.graph.byId.get(hintId);
    return index === undefined ? true : this.isLocked(index);
  }

  /** Unsatisfied dependency ids for a hint — the "you still need to finish X" message. */
  blockers(index: number): string[] {
    const hint = this.graph.hints[index];
    if (!hint) return [];
    return hint.dependencies
      .filter(dep => this.status[dep] !== SATISFIED)
      .map(dep => this.graph.hints[dep]!.id);
  }

  /** Every hint the learner could open right now. */
  available(): ResolvedHint[] {
    return this.graph.hints.filter(h => !this.isLocked(h.index) && this.status[h.index] !== SATISFIED);
  }

  /**
   * Record that the learner answered the step. Call this before/after hint requests as it happens —
   * a solved step stops the hint penalty from ever applying (`isCorrect !== true` in
   * `ProblemCard.js:354`).
   */
  noteAnswer(correct: boolean): void {
    if (correct) this.stepSolved = true;
  }

  /**
   * Open a hint the *platform* chose to open (`unlockFirstHint` / `giveHintOnIncorrect`,
   * `HintSystem.js:51-57`). Identical to `requestHint` except it never books negative evidence:
   * the learner didn't ask, so charging them for it is indefensible.
   */
  noteAutoOpen(hintId: string): HintOutcome {
    return this.open(hintId, false);
  }

  /**
   * The learner asked for a hint.
   *
   * Books negative evidence on the first help request against an unsolved step. OATutor guards this
   * with `hintsFinished.reduce((a, b) => a + b) === 0 && isCorrect !== true`
   * (`ProblemCard.js:354-357`) — i.e. nothing touched yet, and not already solved. We use an
   * explicit `penaltyBooked` latch rather than re-deriving it from the status sum, because the sum
   * is also 0 after a graph with zero hints, and because the latch survives a scaffold being
   * re-opened.
   */
  requestHint(hintId: string): HintOutcome {
    return this.open(hintId, this.penalize);
  }

  private open(hintId: string, mayPenalize: boolean): HintOutcome {
    const index = this.graph.byId.get(hintId);
    if (index === undefined) {
      return {
        ok: false, refusal: 'unknown-hint', hintId: null, kind: null,
        status: LOCKED, bookedNegativeEvidence: false,
      };
    }
    const hint = this.graph.hints[index]!;

    if (this.isLocked(index)) {
      return {
        ok: false, refusal: 'locked', hintId, kind: hint.kind,
        status: this.status[index]!, bookedNegativeEvidence: false,
        blockedBy: this.blockers(index),
      };
    }
    if (this.status[index] === SATISFIED) {
      return {
        ok: false, refusal: 'already-satisfied', hintId, kind: hint.kind,
        status: SATISFIED, bookedNegativeEvidence: false,
      };
    }

    const shouldBook = mayPenalize && !this.penaltyBooked && !this.stepSolved;
    if (shouldBook) this.penaltyBooked = true;

    // A scaffold is answerable, so opening it only gets it to 0.5 — and 0.5 blocks its dependents.
    // Everything else is satisfied by being read.
    this.status[index] = hint.kind === 'scaffold' ? OPENED_UNANSWERED : SATISFIED;

    return {
      ok: true, hintId, kind: hint.kind,
      status: this.status[index]!, bookedNegativeEvidence: shouldBook,
    };
  }

  /**
   * Answer a scaffold. `0.5 → 1` on a correct answer only (`ProblemCard.js:399-405`).
   *
   * Scaffold answers deliberately do **not** drive a BKT update in the original, and we keep that:
   * a scaffold is formative, it decomposes the step the learner already got wrong, and scoring it
   * would charge them twice for the same failure.
   */
  answerScaffold(hintId: string, correct: boolean): HintOutcome {
    const index = this.graph.byId.get(hintId);
    if (index === undefined) {
      return {
        ok: false, refusal: 'unknown-hint', hintId: null, kind: null,
        status: LOCKED, bookedNegativeEvidence: false,
      };
    }
    const hint = this.graph.hints[index]!;
    if (hint.kind !== 'scaffold') {
      return {
        ok: false, refusal: 'unknown-hint', hintId, kind: hint.kind,
        status: this.status[index]!, bookedNegativeEvidence: false,
      };
    }
    if (this.isLocked(index)) {
      return {
        ok: false, refusal: 'locked', hintId, kind: hint.kind,
        status: this.status[index]!, bookedNegativeEvidence: false,
        blockedBy: this.blockers(index),
      };
    }

    if (correct) this.status[index] = SATISFIED;
    return {
      ok: correct, hintId, kind: hint.kind,
      status: this.status[index]!, bookedNegativeEvidence: false,
    };
  }

  // --- sub-hints: identical machine, one level down --------------------------------------------

  private subGraphOf(parentId: string): { parentIndex: number; graph: HintGraph } | null {
    const parentIndex = this.graph.byId.get(parentId);
    if (parentIndex === undefined) return null;
    const graph = this.graph.hints[parentIndex]!.subGraph;
    return graph ? { parentIndex, graph } : null;
  }

  /** Sub-hint lock check — same rule, over the scaffold's own status array (`SubHintSystem.js:43-50`). */
  isSubLocked(parentId: string, subIndex: number): boolean {
    const found = this.subGraphOf(parentId);
    if (!found) return true;
    if (subIndex === 0) return false;
    const sub = found.graph.hints[subIndex];
    if (!sub) return true;
    const statuses = this.subStatus[found.parentIndex] ?? [];
    return !sub.dependencies.every(dep => statuses[dep] === SATISFIED);
  }

  subStatuses(parentId: string): HintStatus[] {
    const found = this.subGraphOf(parentId);
    if (!found) return [];
    return [...(this.subStatus[found.parentIndex] ?? [])];
  }

  /** Open a sub-hint. Sub-hints never book evidence — they sit inside an already-penalised step. */
  requestSubHint(parentId: string, subId: string): HintOutcome {
    const found = this.subGraphOf(parentId);
    if (!found) {
      return {
        ok: false, refusal: 'unknown-hint', hintId: null, kind: null,
        status: LOCKED, bookedNegativeEvidence: false,
      };
    }
    const subIndex = found.graph.byId.get(subId);
    if (subIndex === undefined) {
      return {
        ok: false, refusal: 'unknown-hint', hintId: null, kind: null,
        status: LOCKED, bookedNegativeEvidence: false,
      };
    }
    const sub = found.graph.hints[subIndex]!;
    const statuses = this.subStatus[found.parentIndex]!;

    if (this.isSubLocked(parentId, subIndex)) {
      return {
        ok: false, refusal: 'locked', hintId: subId, kind: sub.kind,
        status: statuses[subIndex]!, bookedNegativeEvidence: false,
      };
    }
    statuses[subIndex] = sub.kind === 'scaffold' ? OPENED_UNANSWERED : SATISFIED;
    return {
      ok: true, hintId: subId, kind: sub.kind,
      status: statuses[subIndex]!, bookedNegativeEvidence: false,
    };
  }

  /** Serialize the machine — the per-step engagement trace, and what a resume needs. */
  serialize(): { status: HintStatus[]; subStatus: HintStatus[][]; stepSolved: boolean; penaltyBooked: boolean } {
    return {
      status: [...this.status],
      subStatus: this.subStatus.map(s => [...s]),
      stepSolved: this.stepSolved,
      penaltyBooked: this.penaltyBooked,
    };
  }

  restore(state: ReturnType<HintMachine['serialize']>): void {
    // Length-checked: a content edit that changed the hint count must not silently misalign.
    if (state.status.length === this.status.length) this.status = [...state.status];
    this.subStatus = this.subStatus.map((cur, i) => {
      const incoming = state.subStatus[i];
      return incoming && incoming.length === cur.length ? [...incoming] : cur;
    });
    this.stepSolved = state.stepSolved;
    this.penaltyBooked = state.penaltyBooked;
  }
}
