import { describe, it, expect } from 'vitest';
import {
  buildHintGraph, HintMachine, HintGraphError,
  LOCKED, OPENED_UNANSWERED, SATISFIED,
  type HintSpec,
} from './hints';

/** The README's own three-hint example, rewritten with id dependencies as the report instructs. */
const CIRCLE: HintSpec[] = [
  { id: 'h1', kind: 'hint', title: 'Size of the room', text: 'Consider the shape of the room.' },
  {
    id: 'h2', kind: 'scaffold', title: 'Constricting dimension',
    text: 'What is the maximum diameter?', answer: ['20'], dependencies: ['h1'],
  },
  { id: 'h3', kind: 'solution', title: 'Solution', text: 'r = d/2 = 10', dependencies: ['h2'] },
];

function machine(specs: HintSpec[] = CIRCLE): HintMachine {
  return new HintMachine(buildHintGraph(specs));
}

describe('building the graph resolves ids once, at build time', () => {
  it('rewrites id dependencies into real indices', () => {
    const g = buildHintGraph(CIRCLE);
    expect(g.hints.map(h => h.id)).toEqual(['h1', 'h2', 'h3']);
    expect(g.hints[1]!.dependencies).toEqual([0]);
    expect(g.hints[2]!.dependencies).toEqual([1]);
    expect(g.hints[2]!.dependencyIds).toEqual(['h2']);
  });

  it('never stores -1 for a dependency', () => {
    const g = buildHintGraph(CIRCLE);
    for (const h of g.hints) {
      for (const dep of h.dependencies) {
        expect(dep).toBeGreaterThanOrEqual(0);
        expect(dep).toBeLessThan(g.hints.length);
      }
    }
  });

  it('indexes by id for O(1) lookup', () => {
    const g = buildHintGraph(CIRCLE);
    expect(g.byId.get('h3')).toBe(2);
    expect(g.byId.get('nope')).toBeUndefined();
  });
});

describe('a dangling dependency id throws at build time', () => {
  /**
   * OATutor's `_findHintId` returns -1 on a miss (`ProblemCard.js:175-183`) and the caller stores
   * it (`:83-95`). `hintStatus[-1]` is `undefined`, so the dependency can never be satisfied and
   * the hint is silently unreachable forever — with no diagnostic anywhere. Fail loudly instead.
   */
  it('names the missing id and lists what was available', () => {
    const broken: HintSpec[] = [
      { id: 'h1', kind: 'hint', text: 'a' },
      { id: 'h2', kind: 'solution', text: 'b', dependencies: ['typo-h1'] },
    ];
    expect(() => buildHintGraph(broken)).toThrow(HintGraphError);
    expect(() => buildHintGraph(broken)).toThrow(/typo-h1/);
    expect(() => buildHintGraph(broken)).toThrow(/"h1"/);
  });

  it('throws for a dangling ref inside a scaffold\'s sub-hints too', () => {
    const broken: HintSpec[] = [{
      id: 'h1', kind: 'scaffold', text: 'a', answer: ['1'],
      subHints: [
        { id: 's1', kind: 'hint', text: 'x' },
        { id: 's2', kind: 'hint', text: 'y', dependencies: ['ghost'] },
      ],
    }];
    expect(() => buildHintGraph(broken)).toThrow(/ghost/);
  });

  it('rejects a self-dependency', () => {
    expect(() => buildHintGraph([{ id: 'h1', kind: 'hint', text: 'a', dependencies: ['h1'] }]))
      .toThrow(/depends on itself/);
  });

  it('rejects duplicate ids, which would make resolution ambiguous', () => {
    expect(() => buildHintGraph([
      { id: 'dup', kind: 'hint', text: 'a' },
      { id: 'dup', kind: 'hint', text: 'b' },
    ])).toThrow(/duplicate hint id "dup"/);
  });

  it('rejects a missing id', () => {
    expect(() => buildHintGraph([{ id: '', kind: 'hint', text: 'a' }])).toThrow(/no id/);
  });
});

describe('a cyclic DAG throws at build time, with the path', () => {
  it('catches a two-hint cycle and prints it', () => {
    const cyclic: HintSpec[] = [
      { id: 'a', kind: 'hint', text: '1', dependencies: ['b'] },
      { id: 'b', kind: 'hint', text: '2', dependencies: ['a'] },
    ];
    expect(() => buildHintGraph(cyclic)).toThrow(HintGraphError);
    expect(() => buildHintGraph(cyclic)).toThrow(/cycle/);
    expect(() => buildHintGraph(cyclic)).toThrow(/a -> b -> a/);
  });

  it('catches a longer cycle and prints every node on it', () => {
    const cyclic: HintSpec[] = [
      { id: 'a', kind: 'hint', text: '1', dependencies: ['c'] },
      { id: 'b', kind: 'hint', text: '2', dependencies: ['a'] },
      { id: 'c', kind: 'hint', text: '3', dependencies: ['b'] },
    ];
    let message = '';
    try { buildHintGraph(cyclic); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/cycle/);
    for (const id of ['a', 'b', 'c']) expect(message).toContain(id);
  });

  it('catches a cycle inside a scaffold\'s sub-hints', () => {
    expect(() => buildHintGraph([{
      id: 'h1', kind: 'scaffold', text: 'a', answer: ['1'],
      subHints: [
        { id: 's1', kind: 'hint', text: 'x', dependencies: ['s2'] },
        { id: 's2', kind: 'hint', text: 'y', dependencies: ['s1'] },
      ],
    }])).toThrow(/cycle/);
  });

  it('accepts a legitimate diamond — shared dependencies are not a cycle', () => {
    expect(() => buildHintGraph([
      { id: 'a', kind: 'hint', text: '1' },
      { id: 'b', kind: 'hint', text: '2', dependencies: ['a'] },
      { id: 'c', kind: 'hint', text: '3', dependencies: ['a'] },
      { id: 'd', kind: 'solution', text: '4', dependencies: ['b', 'c'] },
    ])).not.toThrow();
  });
});

describe('shape validation', () => {
  it('rejects a scaffold with no answer — it could never reach status 1', () => {
    expect(() => buildHintGraph([{ id: 'h', kind: 'scaffold', text: 'a' }]))
      .toThrow(/has no answer/);
  });

  it('rejects an answer on a non-scaffold', () => {
    expect(() => buildHintGraph([{ id: 'h', kind: 'hint', text: 'a', answer: ['1'] }]))
      .toThrow(/only scaffolds are answerable/);
  });

  it('rejects subHints on a plain hint', () => {
    expect(() => buildHintGraph([{
      id: 'h', kind: 'hint', text: 'a',
      subHints: [{ id: 's', kind: 'hint', text: 'x' }],
    }])).toThrow(/only scaffolds may nest/);
  });

  it('allows exactly one level of scaffold nesting', () => {
    expect(() => buildHintGraph([{
      id: 'h', kind: 'scaffold', text: 'a', answer: ['1'],
      subHints: [{ id: 's', kind: 'hint', text: 'x' }],
    }])).not.toThrow();
  });

  it('rejects two levels — README.md:596-598 says one is the limit', () => {
    expect(() => buildHintGraph([{
      id: 'h', kind: 'scaffold', text: 'a', answer: ['1'],
      subHints: [{
        id: 's', kind: 'scaffold', text: 'x', answer: ['2'],
        subHints: [{ id: 'ss', kind: 'hint', text: 'deep' }],
      }],
    }])).toThrow(/one level/);
  });
});

describe('the unlocking rule', () => {
  it('leaves hint 0 always open', () => {
    const m = machine();
    expect(m.isLocked(0)).toBe(false);
    expect(m.isLockedById('h1')).toBe(false);
  });

  it('locks everything downstream until its dependencies are satisfied', () => {
    const m = machine();
    expect(m.isLockedById('h2')).toBe(true);
    expect(m.isLockedById('h3')).toBe(true);
    m.requestHint('h1');
    expect(m.isLockedById('h2')).toBe(false);
  });

  it('refuses to open a locked hint and reports what is blocking it', () => {
    const m = machine();
    const out = m.requestHint('h3');
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('locked');
    expect(out.blockedBy).toEqual(['h2']);
    expect(m.statusOf('h3')).toBe(LOCKED);
  });

  it('requires EVERY dependency, not just one', () => {
    const m = new HintMachine(buildHintGraph([
      { id: 'a', kind: 'hint', text: '1' },
      { id: 'b', kind: 'hint', text: '2' },
      { id: 'c', kind: 'solution', text: '3', dependencies: ['a', 'b'] },
    ]));
    m.requestHint('a');
    expect(m.isLockedById('c')).toBe(true);   // 'b' is still locked
    m.requestHint('b');
    expect(m.isLockedById('c')).toBe(false);
  });

  it('reports unknown hints rather than throwing', () => {
    const out = machine().requestHint('does-not-exist');
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('unknown-hint');
  });

  it('refuses to re-satisfy an already-satisfied hint', () => {
    const m = machine();
    m.requestHint('h1');
    const again = m.requestHint('h1');
    expect(again.ok).toBe(false);
    expect(again.refusal).toBe('already-satisfied');
  });
});

describe('an opened-unanswered scaffold BLOCKS its dependents', () => {
  /**
   * The single most important behaviour in this file. `HintSystem.js:72-81` requires every
   * dependency at exactly `1`, and opening a scaffold only reaches `0.5`
   * (`ProblemCard.js:364`). That is the mechanism that stops a learner from clicking straight
   * through a hint chain to the solution without engaging with the scaffold.
   */
  it('sits at 0.5 when opened, not 1', () => {
    const m = machine();
    m.requestHint('h1');
    const out = m.requestHint('h2');
    expect(out.ok).toBe(true);
    expect(out.status).toBe(OPENED_UNANSWERED);
    expect(m.statusOf('h2')).toBe(0.5);
  });

  it('keeps the solution locked while the scaffold is at 0.5', () => {
    const m = machine();
    m.requestHint('h1');
    m.requestHint('h2');
    expect(m.isLockedById('h3')).toBe(true);
    expect(m.requestHint('h3').refusal).toBe('locked');
  });

  it('a WRONG scaffold answer leaves it at 0.5 and the solution still locked', () => {
    const m = machine();
    m.requestHint('h1');
    m.requestHint('h2');
    const out = m.answerScaffold('h2', false);
    expect(out.ok).toBe(false);
    expect(m.statusOf('h2')).toBe(OPENED_UNANSWERED);
    expect(m.isLockedById('h3')).toBe(true);
  });

  it('only a CORRECT scaffold answer promotes 0.5 -> 1 and unlocks downstream', () => {
    const m = machine();
    m.requestHint('h1');
    m.requestHint('h2');
    const out = m.answerScaffold('h2', true);
    expect(out.ok).toBe(true);
    expect(m.statusOf('h2')).toBe(SATISFIED);
    expect(m.isLockedById('h3')).toBe(false);
    expect(m.requestHint('h3').ok).toBe(true);
  });

  it('cannot be bypassed by any ordering of requests — the chain is the only way through', () => {
    const m = machine();
    // Hammer every hint in every order; without answering the scaffold, h3 must never open.
    for (let i = 0; i < 20; i++) {
      for (const id of ['h3', 'h2', 'h1', 'h3', 'h2']) m.requestHint(id);
    }
    expect(m.statusOf('h3')).toBe(LOCKED);
    expect(m.statusOf('h2')).toBe(OPENED_UNANSWERED);
  });

  it('a plain hint is satisfied merely by being read, unlike a scaffold', () => {
    const m = machine();
    expect(m.requestHint('h1').status).toBe(SATISFIED);
  });

  it('refuses to answer a scaffold that is still locked', () => {
    const m = machine();
    expect(m.answerScaffold('h2', true).refusal).toBe('locked');
    expect(m.statusOf('h2')).toBe(LOCKED);
  });

  it('refuses to "answer" a non-scaffold', () => {
    const m = machine();
    expect(m.answerScaffold('h1', true).ok).toBe(false);
  });
});

describe('hint requests book negative evidence — once', () => {
  it('books on the first request against an unsolved step', () => {
    const m = machine();
    expect(m.requestHint('h1').bookedNegativeEvidence).toBe(true);
  });

  it('does not book again on later requests', () => {
    const m = machine();
    m.requestHint('h1');
    expect(m.requestHint('h2').bookedNegativeEvidence).toBe(false);
    m.answerScaffold('h2', true);
    expect(m.requestHint('h3').bookedNegativeEvidence).toBe(false);
  });

  it('exempts a learner who already solved the step', () => {
    const m = machine();
    m.noteAnswer(true);
    expect(m.requestHint('h1').bookedNegativeEvidence).toBe(false);
  });

  it('does not exempt a learner who answered WRONG', () => {
    const m = machine();
    m.noteAnswer(false);
    expect(m.requestHint('h1').bookedNegativeEvidence).toBe(true);
  });

  it('books nothing for a refused request', () => {
    const m = machine();
    expect(m.requestHint('h3').bookedNegativeEvidence).toBe(false);
    expect(m.requestHint('ghost').bookedNegativeEvidence).toBe(false);
    // The penalty is still available for a legitimate request afterwards.
    expect(m.requestHint('h1').bookedNegativeEvidence).toBe(true);
  });

  it('never books when the penalty is configured off', () => {
    const m = new HintMachine(buildHintGraph(CIRCLE), { penalizeFirstHint: false });
    expect(m.requestHint('h1').bookedNegativeEvidence).toBe(false);
    expect(m.requestHint('h1').ok).toBe(false);        // still satisfied, just unpenalised
    expect(m.statusOf('h1')).toBe(SATISFIED);
  });

  /**
   * OATutor auto-opens hint 0 under `unlockFirstHint` / `giveHintOnIncorrect`
   * (`HintSystem.js:51-57`) and routes it through the same `unlockHint`, so the platform's own
   * decision penalises the learner. The report flags this as a design decision to be deliberate
   * about; we split the two paths.
   */
  it('an auto-opened hint opens without penalising the learner', () => {
    const m = machine();
    const out = m.noteAutoOpen('h1');
    expect(out.ok).toBe(true);
    expect(out.bookedNegativeEvidence).toBe(false);
    expect(m.statusOf('h1')).toBe(SATISFIED);
    // And the penalty has not been silently consumed — a real request still books.
    expect(m.requestHint('h2').bookedNegativeEvidence).toBe(true);
  });
});

describe('bottom-out hints', () => {
  it('depends on every authored hint, so it is last in the chain', () => {
    const g = buildHintGraph(CIRCLE, { bottomOut: { text: 'The answer is 10' } });
    const bottom = g.hints.at(-1)!;
    expect(bottom.kind).toBe('bottomOut');
    expect(bottom.dependencyIds).toEqual(['h1', 'h2', 'h3']);
  });

  it('is unreachable until the whole chain including the scaffold is satisfied', () => {
    const g = buildHintGraph(CIRCLE, { bottomOut: { id: 'bo', text: 'The answer is 10' } });
    const m = new HintMachine(g);
    m.requestHint('h1');
    m.requestHint('h2');
    expect(m.isLockedById('bo')).toBe(true);          // scaffold still at 0.5
    m.answerScaffold('h2', true);
    expect(m.isLockedById('bo')).toBe(true);          // h3 not read yet
    m.requestHint('h3');
    expect(m.isLockedById('bo')).toBe(false);
  });

  it('guarantees no dead end — some hint is always eventually reachable', () => {
    const g = buildHintGraph(CIRCLE, { bottomOut: { text: 'answer' } });
    const m = new HintMachine(g);
    let guard = 0;
    while (m.available().length > 0 && guard++ < 50) {
      const next = m.available()[0]!;
      m.requestHint(next.id);
      if (next.kind === 'scaffold') m.answerScaffold(next.id, true);
    }
    expect(m.statuses().every(s => s === SATISFIED)).toBe(true);
  });
});

describe('sub-hints are the same machine, one level down', () => {
  const NESTED: HintSpec[] = [{
    id: 'h1', kind: 'scaffold', text: 'outer', answer: ['20'],
    subHints: [
      { id: 's1', kind: 'hint', text: 'inner 1' },
      { id: 's2', kind: 'solution', text: 'inner 2', dependencies: ['s1'] },
    ],
  }];

  it('locks a sub-hint until its own dependencies are satisfied', () => {
    const m = new HintMachine(buildHintGraph(NESTED));
    expect(m.isSubLocked('h1', 0)).toBe(false);
    expect(m.isSubLocked('h1', 1)).toBe(true);
    m.requestSubHint('h1', 's1');
    expect(m.isSubLocked('h1', 1)).toBe(false);
  });

  it('tracks sub-status independently of the parent', () => {
    const m = new HintMachine(buildHintGraph(NESTED));
    m.requestSubHint('h1', 's1');
    expect(m.subStatuses('h1')).toEqual([SATISFIED, LOCKED]);
    expect(m.statusOf('h1')).toBe(LOCKED);
  });

  it('never books evidence — the step already paid when the scaffold opened', () => {
    const m = new HintMachine(buildHintGraph(NESTED));
    expect(m.requestSubHint('h1', 's1').bookedNegativeEvidence).toBe(false);
  });

  it('returns an inert result for a parent with no sub-graph', () => {
    const m = machine();
    expect(m.requestSubHint('h1', 'whatever').refusal).toBe('unknown-hint');
    expect(m.subStatuses('h1')).toEqual([]);
  });
});

describe('engagement bookkeeping', () => {
  it('counts every touched hint, including a scaffold only at 0.5', () => {
    const m = machine();
    expect(m.hintsUsed()).toBe(0);
    expect(m.usedAnyHint()).toBe(false);
    m.requestHint('h1');
    expect(m.hintsUsed()).toBe(1);
    m.requestHint('h2');
    expect(m.hintsUsed()).toBe(2);
    expect(m.usedAnyHint()).toBe(true);
  });

  it('lists what is available right now', () => {
    const m = machine();
    expect(m.available().map(h => h.id)).toEqual(['h1']);
    m.requestHint('h1');
    expect(m.available().map(h => h.id)).toEqual(['h2']);
  });

  it('hands out a copy of the statuses, not the live array', () => {
    const m = machine();
    const snap = m.statuses();
    snap[0] = SATISFIED;
    expect(m.statusOf('h1')).toBe(LOCKED);
  });

  it('round-trips through serialize/restore', () => {
    const m = machine();
    m.requestHint('h1');
    m.requestHint('h2');
    const state = m.serialize();

    const fresh = machine();
    fresh.restore(state);
    expect(fresh.statuses()).toEqual([SATISFIED, OPENED_UNANSWERED, LOCKED]);
    expect(fresh.isLockedById('h3')).toBe(true);
    // The penalty latch survives, so a resumed step can't be re-charged.
    expect(fresh.requestHint('h3').bookedNegativeEvidence).toBe(false);
  });

  it('ignores a restore whose length no longer matches the content', () => {
    const m = machine();
    m.restore({ status: [SATISFIED], subStatus: [], stepSolved: false, penaltyBooked: false });
    expect(m.statuses()).toEqual([LOCKED, LOCKED, LOCKED]);
  });
});
