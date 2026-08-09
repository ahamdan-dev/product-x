/**
 * PanelId -> lazy component.
 *
 * Split out of `panels.ts` for two reasons, both load-bearing:
 *
 *   1. **Cost.** Every one of these is `lazy()`, the way the Map already is. Imagine and Companion in
 *      particular are expensive — Companion mounts an r3f `Canvas` and pulls three.js — and none of it
 *      should be paid for on Today's first paint by a student who never opens a panel. A static import
 *      here would defeat the whole point, so the registry hands back a factory, not a component.
 *   2. **Testability.** `panels.ts` is imported by a test running in vitest's `node` environment. If
 *      the panel data and the React components lived in one module, that test would transitively load
 *      r3f and the DOM-only code inside it, and would fail for reasons that have nothing to do with
 *      routing. Keeping the components on this side of the line means the data can be asserted on
 *      cheaply and the components are only ever loaded by a browser.
 *
 * The `Record` is exhaustive by type: adding a `PanelId` without adding its component is a compile
 * error rather than a blank panel at runtime.
 */

import { lazy, type ComponentType } from 'react';
import type { PanelId } from './panels';

/**
 * Every panel host passes the same prop: the store id of the floating surface it lives in. Four of
 * the six panels already take exactly this (`{ id }`) and wrap themselves in `ui/Surface`; the other
 * two are wrapped by thin adapters that do the same, so the host has one uniform contract.
 */
export interface PanelHostProps {
  id: string;
}

export const PANEL_COMPONENTS: Record<PanelId, () => Promise<{ default: ComponentType<PanelHostProps> }>> = {
  // These four are already `Surface`-wrapped and already take `{ id }`, but export named rather than
  // default. `lazy()` needs a default, so each is adapted in place rather than by editing a component
  // that is already tested and working.
  activity: () => import('../panels/ActivityCenter').then(m => ({ default: m.ActivityCenter })),
  library:  () => import('../panels/Library').then(m => ({ default: m.Library })),
  settings: () => import('../panels/Settings').then(m => ({ default: m.Settings })),
  sims:     () => import('../panels/SimCatalog').then(m => ({ default: m.SimCatalog })),
  // These two are bare content with their own prop shapes, so they get real adapters.
  imagine:   () => import('../panels/ImaginePanel'),
  companion: () => import('../panels/CompanionPanel'),
};

/** The lazy component for a panel. Memoized per id, because `lazy()` must not be called per render. */
const CACHE = new Map<PanelId, ComponentType<PanelHostProps>>();

export function panelComponent(id: PanelId): ComponentType<PanelHostProps> {
  const hit = CACHE.get(id);
  if (hit) return hit;
  // A fresh `lazy()` on every render would remount the panel — and throw away the timer, the notes
  // being typed, and the flipped cards — on any unrelated state change in the host.
  const made = lazy(PANEL_COMPONENTS[id]);
  CACHE.set(id, made);
  return made;
}
