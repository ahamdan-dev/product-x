/**
 * Reconciling the shell's panel list against the store.
 *
 * ── The bug this exists to prevent ────────────────────────────────────────────────────────────────
 *
 * Two things track whether a panel is open, and they can disagree:
 *
 *   - the store's `surfaces[id].open`, which every floating surface reads and writes
 *   - the shell's `openPanels` array, which the dock's badge, the dock's toggle, and the hash read
 *
 * `ui/Surface` closes itself — its X button and its Escape handler both call the store's `closeSurface`
 * directly, which is correct: a window should not need its host's permission to close. But the shell
 * never hears about it, so `openPanels` keeps naming a panel that is gone. Measured consequences, all
 * three observed with real input before this module existed:
 *
 *   1. the dock's count badge still read "1" with nothing on screen
 *   2. `togglePanel` saw a phantom "already open" and took the CLOSE branch, so the next dock click
 *      did nothing visible and the panel needed TWO clicks to come back
 *   3. the hash still ended in `/panel/library` after the library had closed, so a reload or a shared
 *      link restored a panel the user had dismissed
 *
 * (2) is the serious one: a panel that closed itself became unreachable from the only control that
 * summons it — the exact orphaning this whole panel layer was built to remove.
 *
 * ── Why reconcile rather than derive ──────────────────────────────────────────────────────────────
 *
 * The obvious repair is to delete `openPanels` and derive everything from the store. That loses the one
 * thing the store does not record: *the order the user opened things in*. The store has an `order`, but
 * it is z-order and `raiseSurface` bumps it on every focus, so reading it would make the dock's list and
 * the hash's "last summoned" panel reshuffle whenever the user clicked between two panels.
 *
 * So the array stays as the ordering memory and the store stays the single authority on open/closed.
 * This function is the join: same order, minus anything the store says is shut.
 */

/**
 * Drop any panel the store no longer holds open, preserving the order of the rest.
 *
 * Returns the ORIGINAL array when nothing changed. That identity check is load-bearing, not a
 * micro-optimisation: this runs from an effect that fires on every store change, and returning a fresh
 * array each time would set state on every render and spin forever.
 *
 * @param prev   panels in the order they were opened
 * @param isOpen the store's verdict for one panel id
 */
export function reconcileOpenPanels<T>(
  prev: readonly T[],
  isOpen: (id: T) => boolean,
): readonly T[] {
  const live = prev.filter(isOpen);
  return live.length === prev.length ? prev : live;
}

/**
 * The panel the hash should name: the most recently summoned one still open, or null.
 *
 * Split out so the rule is stated once and can be tested without a DOM. `null` means the hash carries
 * no panel suffix at all, which is what makes a closed panel disappear from the URL instead of lingering
 * as a link that reopens itself on refresh.
 */
export function hashPanel<T>(open: readonly T[]): T | null {
  return open.length > 0 ? open[open.length - 1]! : null;
}
