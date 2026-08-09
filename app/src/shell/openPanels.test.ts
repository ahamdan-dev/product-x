/**
 * Tests for the shell/store reconciliation that keeps a self-closed panel reachable.
 *
 * These are regression tests for a measured bug, not hypotheticals. Before `reconcileOpenPanels`
 * existed, closing the Library with its own X button left the dock badge reading "1", left the hash
 * pointing at `/panel/library`, and — the real damage — made the next dock click close a panel that was
 * already gone, so the panel took two clicks to come back. The last case is the orphaning the panel
 * layer exists to prevent, so it gets an explicit test that walks the whole sequence.
 */

import { describe, it, expect } from 'vitest';
import { hashPanel, reconcileOpenPanels } from './openPanels';

/** A store stand-in: the set of ids currently open. */
const openSet = (...ids: string[]) => {
  const s = new Set(ids);
  return (id: string) => s.has(id);
};

describe('reconcileOpenPanels', () => {
  it('keeps every panel the store still holds open, in the order they were opened', () => {
    const prev = ['library', 'activity', 'settings'];
    expect(reconcileOpenPanels(prev, openSet('library', 'activity', 'settings')))
      .toEqual(['library', 'activity', 'settings']);
  });

  it('drops a panel that closed itself', () => {
    const prev = ['library', 'activity'];
    expect(reconcileOpenPanels(prev, openSet('activity'))).toEqual(['activity']);
  });

  it('drops several at once', () => {
    const prev = ['library', 'activity', 'settings', 'imagine'];
    expect(reconcileOpenPanels(prev, openSet('activity'))).toEqual(['activity']);
  });

  it('preserves open order rather than the store\'s iteration order', () => {
    // The store's `order` is z-order and is bumped by focus, so it must not be what decides this.
    const prev = ['settings', 'library', 'activity'];
    expect(reconcileOpenPanels(prev, openSet('activity', 'settings'))).toEqual(['settings', 'activity']);
  });

  it('empties out when the last panel closes itself', () => {
    expect(reconcileOpenPanels(['library'], openSet())).toEqual([]);
  });

  /**
   * The identity check is load-bearing: this runs from an effect keyed on the store, so returning a new
   * array when nothing changed would set state on every store change and never settle.
   */
  it('returns the very same array when nothing changed, so the effect cannot loop', () => {
    const prev = ['library', 'activity'];
    expect(reconcileOpenPanels(prev, openSet('library', 'activity'))).toBe(prev);
  });

  it('returns the same empty array when there was nothing open', () => {
    const prev: readonly string[] = [];
    expect(reconcileOpenPanels(prev, openSet())).toBe(prev);
  });

  it('does not invent panels the shell never opened', () => {
    // The store holds non-panel surfaces too (the companion, world cards). Reconciling must only ever
    // remove, never add, or unrelated surfaces would leak into the dock.
    expect(reconcileOpenPanels(['library'], openSet('library', 'companion', 'someCard')))
      .toEqual(['library']);
  });
});

describe('hashPanel', () => {
  it('names the most recently summoned panel', () => {
    expect(hashPanel(['library', 'activity'])).toBe('activity');
  });

  it('is null when nothing is open, so the hash carries no panel suffix', () => {
    expect(hashPanel([])).toBeNull();
  });

  it('promotes the survivor when the panel named in the hash closes', () => {
    const prev = ['library', 'activity'];
    expect(hashPanel(prev)).toBe('activity');
    const after = reconcileOpenPanels(prev, openSet('library'));
    expect(hashPanel(after)).toBe('library');
  });
});

describe('the orphaning sequence that prompted this module', () => {
  /**
   * Walks exactly what the probe did with real mouse input:
   * open Library from the dock, close it with its own X, then click the same dock item again.
   */
  it('lets the dock reopen a panel that closed itself, on the FIRST click', () => {
    let open = new Set<string>();
    let list: readonly string[] = [];

    // The shell's toggle, as written: consult the reconciled list.
    const reconcile = () => { list = reconcileOpenPanels(list, id => open.has(id)); };
    const toggle = (id: string) => {
      reconcile();
      if (list.includes(id)) {
        open.delete(id);
        list = list.filter(p => p !== id);
      } else {
        open.add(id);
        list = list.includes(id) ? list : [...list, id];
      }
    };

    // 1. Dock click opens it.
    toggle('library');
    expect(list).toEqual(['library']);
    expect(hashPanel(list)).toBe('library');

    // 2. The panel closes ITSELF — store only, the shell is not told.
    open.delete('library');

    // 3. Reconciling is what makes the next read honest. Badge and hash both clear.
    reconcile();
    expect(list).toEqual([]);
    expect(hashPanel(list)).toBeNull();

    // 4. One dock click brings it back — not two.
    toggle('library');
    expect(list).toEqual(['library']);
    expect(open.has('library')).toBe(true);
  });

  it('still reopens correctly when one of two panels closes itself', () => {
    let open = new Set(['library', 'activity']);
    let list: readonly string[] = ['library', 'activity'];

    open.delete('library');
    list = reconcileOpenPanels(list, id => open.has(id));

    expect(list).toEqual(['activity']);
    // Activity is untouched and the hash follows it, rather than clearing entirely.
    expect(hashPanel(list)).toBe('activity');
  });
});
