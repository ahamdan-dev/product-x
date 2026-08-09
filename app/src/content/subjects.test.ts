/**
 * The point of this file is one assertion: content and model agree on the set of subjects.
 *
 * A missing entry does not crash anything — it renders a card with a blank body, or a Next Move with
 * no question in it, which is the kind of defect that survives review and then shows up on stage.
 * Comparing the two id sets is the only way to catch it before then.
 */

import { describe, it, expect } from 'vitest';
import { useApp } from '../state/store';
import {
  SUBJECTS, RING_LABELS, subject, pivotsFor, promptAt, conceptId, districtOf,
} from './subjects';

/** The live district ids, read from the store rather than re-listed here — re-listing is the bug. */
const DISTRICT_IDS = useApp.getState().districts.map(d => d.id);

describe('subject content covers the model', () => {
  it('has exactly one entry per district, no extras and no gaps', () => {
    expect([...SUBJECTS.map(s => s.id)].sort()).toEqual([...DISTRICT_IDS].sort());
  });

  it('resolves copy for every concept id the store actually created', () => {
    const { districts } = useApp.getState();
    for (const d of districts) {
      for (const cid of d.conceptIds) {
        // The store builds `<district>.core`; content must resolve that form, not just the bare id.
        expect(subject(cid), `no copy for concept ${cid}`).toBeDefined();
        expect(subject(cid)!.id).toBe(d.id);
      }
    }
  });

  it('agrees with the store on the concept id format', () => {
    const { districts } = useApp.getState();
    for (const d of districts) expect(d.conceptIds).toContain(conceptId(d.id));
  });
});

describe('every entry is genuinely filled in', () => {
  it.each(SUBJECTS.map(s => [s.id, s] as const))('%s has real copy', (_id, s) => {
    expect(s.summary.length).toBeGreaterThan(30);
    expect(s.pearl.length).toBeGreaterThan(40);
    expect(RING_LABELS[s.ring]).toBeTruthy();
  });

  it.each(SUBJECTS.map(s => [s.id, s] as const))('%s has usable prompts', (_id, s) => {
    // Three is the floor because Today, the focus timer and a card can all be open at once.
    expect(s.prompts.length).toBeGreaterThanOrEqual(3);
    for (const p of s.prompts) {
      expect(p.q.trim().endsWith('?'), `not a question: ${p.q}`).toBe(true);
      expect(p.a.length).toBeGreaterThan(40);
      // An answer that merely restates the question teaches nothing.
      expect(p.a).not.toBe(p.q);
    }
  });

  it('never repeats a prompt across subjects', () => {
    const qs = SUBJECTS.flatMap(s => s.prompts.map(p => p.q));
    expect(new Set(qs).size).toBe(qs.length);
  });

  it('summaries and pearls are not shared between subjects', () => {
    const lines = SUBJECTS.flatMap(s => [s.summary, s.pearl]);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe('pivots are navigable', () => {
  it('point only at subjects that exist', () => {
    for (const s of SUBJECTS) {
      for (const p of s.pivots) {
        expect(DISTRICT_IDS, `${s.id} pivots to unknown ${p}`).toContain(p);
      }
    }
  });

  it('never point back at the subject itself', () => {
    // IMAGINE's whole promise is a *lateral* move, so a self-pivot is a broken feature, not a typo.
    for (const s of SUBJECTS) expect(pivotsFor(s.id)).not.toContain(s.id);
  });

  it('gives every subject somewhere to go', () => {
    for (const s of SUBJECTS) expect(pivotsFor(s.id).length).toBeGreaterThanOrEqual(2);
  });

  it('accepts a .core concept id as well as a district id', () => {
    expect(pivotsFor('cardio.core')).toEqual(pivotsFor('cardio'));
  });

  it('confusedWith names a real subject that is not itself', () => {
    for (const s of SUBJECTS) {
      if (!s.confusedWith) continue;
      expect(DISTRICT_IDS).toContain(s.confusedWith);
      expect(s.confusedWith).not.toBe(s.id);
    }
  });
});

describe('lookup helpers', () => {
  it('round-trips district → concept → district', () => {
    for (const id of DISTRICT_IDS) expect(districtOf(conceptId(id))).toBe(id);
  });

  it('treats a bare district id as already-bare', () => {
    expect(districtOf('renal')).toBe('renal');
  });

  it('returns nothing for an unknown id rather than throwing', () => {
    expect(subject('phrenology')).toBeUndefined();
    expect(pivotsFor('phrenology')).toEqual([]);
    expect(promptAt('phrenology', 0)).toBeUndefined();
  });

  it('picks prompts deterministically and wraps in both directions', () => {
    const n = subject('renal')!.prompts.length;
    expect(promptAt('renal', 0)).toBe(promptAt('renal', n));
    // JS `%` keeps the dividend's sign, so a negative index is the case that actually breaks.
    expect(promptAt('renal', -1)).toBe(promptAt('renal', n - 1));
    expect(promptAt('renal', 3)).toBe(promptAt('renal', 3));
  });
});
