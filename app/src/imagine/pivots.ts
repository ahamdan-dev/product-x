/**
 * IMAGINE pivot logic — pure, testable, and generic.
 *
 * Given a (from, to) subject pair, produce the four flip-card modules that teach the lateral pivot:
 * retrieval prompt, pearl, discriminator ("confused with"), and the connecting bridge back to origin.
 *
 * Each module is self-contained and carries enough data for a card to render it without further lookups.
 */

import { subject, promptAt } from '../content/subjects';

export type ModuleKind = 'prompt' | 'pearl' | 'discriminator' | 'bridge';

export interface PivotModule {
  kind: ModuleKind;
  /** Human-readable title for the card header */
  title: string;
  /** Primary content — the question (for prompt), the pearl text, discriminator text, or bridge text */
  content: string;
  /** Secondary content — the answer for a prompt card, or undefined for other kinds */
  secondary?: string;
  /** Optional district label for context */
  districtLabel?: string;
}

/**
 * Build the four modules for a lateral pivot from `fromId` to `toId`.
 *
 * Returns exactly four non-empty modules:
 *  1. Retrieval prompt (question front / answer back)
 *  2. Pearl (the high-yield hook)
 *  3. Discriminator (confused with X → here's how to tell them apart)
 *  4. Bridge (how this connects back to where you came from)
 *
 * If the target subject has no `confusedWith`, the discriminator slot is substituted with a second
 * prompt at a different index — so the learner still gets four real cards, never an empty one.
 */
export function buildPivotModules(fromId: string, toId: string): PivotModule[] {
  const from = subject(fromId);
  const to = subject(toId);

  if (!from || !to) return [];

  const modules: PivotModule[] = [];

  // Module 1: Retrieval prompt (deterministic pick at index 0)
  const prompt0 = promptAt(to.id, 0);
  if (prompt0) {
    modules.push({
      kind: 'prompt',
      title: 'Retrieval Prompt',
      content: prompt0.q,
      secondary: prompt0.a,
    });
  }

  // Module 2: Pearl
  modules.push({
    kind: 'pearl',
    title: 'High-Yield Pearl',
    content: to.pearl,
  });

  // Module 3: Discriminator OR fallback to a second prompt
  if (to.confusedWith) {
    const confusedSubject = subject(to.confusedWith);
    const confusedLabel = confusedSubject?.summary ?? to.confusedWith;
    modules.push({
      kind: 'discriminator',
      title: 'Distinguished From',
      content: `Often confused with ${confusedLabel}`,
      secondary: `The key difference: ${getDifferentiator(to.id, to.confusedWith)}`,
    });
  } else {
    // No confusedWith → substitute a second retrieval prompt at index 1
    const prompt1 = promptAt(to.id, 1);
    if (prompt1) {
      modules.push({
        kind: 'prompt',
        title: 'Retrieval Prompt',
        content: prompt1.q,
        secondary: prompt1.a,
      });
    }
  }

  // Module 4: Bridge — how this connects back to the origin subject
  modules.push({
    kind: 'bridge',
    title: 'Connection',
    content: `How this connects back to ${from.summary}`,
    secondary: getBridgeText(from.id, to.id),
  });

  return modules;
}

/**
 * Synthesize a discriminator between two subjects based on their content.
 *
 * This is a placeholder that uses the target subject's pearl as the discriminating evidence.
 * In a real system, this would pull from a structured discriminator dataset.
 */
function getDifferentiator(targetId: string, confusedId: string): string {
  const target = subject(targetId);
  const confused = subject(confusedId);

  if (!target || !confused) return 'distinct mechanisms';

  // Use the pearl as the discriminating hook — it's already written to capture the key insight
  return target.pearl;
}

/**
 * Synthesize a bridge explanation between two subjects based on their shared pivots or ring.
 *
 * This is a placeholder that reasons from the subjects' declared pivots.
 * In a real system, this would be explicit bridge copy in subjects.ts.
 */
function getBridgeText(fromId: string, toId: string): string {
  const from = subject(fromId);
  const to = subject(toId);

  if (!from || !to) return 'These subjects share foundational concepts.';

  // Check if they explicitly reference each other
  if (from.pivots.includes(to.id)) {
    return `${from.summary} depends on understanding ${to.summary} — the pivot is direct.`;
  }

  // Check if they share a ring (both foundations, both mechanism, or both systems)
  if (from.ring === to.ring) {
    return `Both belong to the ${from.ring} layer, where ${to.summary.toLowerCase()} provides complementary mechanisms.`;
  }

  // Fallback: vertical connection across rings
  return `${from.summary} builds on ${to.summary} — a vertical connection across the curriculum rings.`;
}

/**
 * Given a subject id, return its pivots with a one-line reason for each.
 *
 * This is what the pivot picker shows: choosable chips with rationale.
 */
export interface PivotOption {
  id: string;
  label: string;
  reason: string;
}

export function getPivotOptions(fromId: string): PivotOption[] {
  const from = subject(fromId);
  if (!from) return [];

  return from.pivots.map(pivotId => {
    const to = subject(pivotId);
    if (!to) return null;

    // Generate a one-line reason based on the relationship
    let reason = 'Related subject';
    if (from.ring === to.ring) {
      reason = 'Same domain, complementary mechanisms';
    } else if (from.pivots.includes(to.id) && to.pivots.includes(from.id)) {
      reason = 'Reciprocal connection';
    } else {
      reason = 'Foundational dependency';
    }

    return {
      id: to.id,
      label: to.summary,
      reason,
    };
  }).filter((opt): opt is PivotOption => opt !== null);
}
