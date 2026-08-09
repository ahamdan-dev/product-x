/**
 * IMAGINE, hosted in a floating panel.
 *
 * `Imagine` itself is finished and tested and is deliberately not touched here. What it lacks is the
 * two things only a host can know: *which subject the learner is currently on*, and *what a pin should
 * do*. This adapter answers both, and it is the entire reason Imagine was unreachable — the component
 * existed, but nothing knew how to supply its props.
 *
 * ── The subject is derived, never invented ────────────────────────────────────────────────────
 *
 * The learner is "on" whatever district they focused on the Map. If they have not focused one, we do
 * NOT pick a subject at random and imply it is what they were studying — we pick the first subject
 * that genuinely has lateral pivots to offer and say so, in one line, above the picker. The pivots
 * themselves come from `subjects.ts` via `getPivotOptions`; nothing on this panel is written for
 * effect.
 *
 * ── Pins are session-only, and it says so ─────────────────────────────────────────────────────
 *
 * There is no shared pin store yet: the Library panel keeps its own entries and the app store has no
 * pin collection. Wiring a fake one — a pin that animates and then evaporates, or one that claims the
 * Library received it — is exactly the fake capability the brief forbids. So the pin count is real and
 * live, the footer states plainly that these are session-only and that the Library does not see them
 * yet, and no promise is made that is not kept.
 */

import { useMemo, useState } from 'react';
import { Surface } from '../ui/Surface';
import { useApp } from '../state/store';
import { Imagine } from '../imagine/Imagine';
import { getPivotOptions } from '../imagine/pivots';
import { subject } from '../content/subjects';
import './panels.css';

export interface ImaginePanelProps {
  id: string;
}

export default function ImaginePanel({ id }: ImaginePanelProps) {
  const districts = useApp(st => st.districts);
  const focused = useApp(st => st.focusedDistrict);

  const [pinned, setPinned] = useState<string[]>([]);

  /**
   * The subject to pivot from, and whether it was the learner's own choice.
   *
   * A subject with no pivots would render an empty picker, which reads as broken rather than as
   * honest — so the fallback is not "the first district" but "the first district that actually has
   * something to offer".
   */
  const { fromId, derived } = useMemo(() => {
    if (focused && getPivotOptions(focused).length > 0) {
      return { fromId: focused, derived: false };
    }
    const firstWithPivots = districts.find(d => getPivotOptions(d.id).length > 0);
    return { fromId: firstWithPivots?.id ?? null, derived: true };
  }, [focused, districts]);

  const from = fromId ? subject(fromId) : undefined;

  /**
   * Display names live in the store, not in `subjects.ts` — which deliberately has no `label`, so that
   * one list of display names cannot drift from another. So the *name* comes from the district and the
   * *sentence* comes from the subject copy: "Cell & Molecular" is what the learner recognises,
   * "Organelles, membrane transport…" is the reminder underneath it.
   */
  const fromLabel = useMemo(
    () => (fromId ? districts.find(d => d.id === fromId)?.label : undefined),
    [fromId, districts],
  );

  /**
   * Resolve a pivot's district name for the chips.
   *
   * `getPivotOptions` returns the subject *summary* as its label, because it is pure and cannot reach
   * the store. A full sentence is not a chip — it forced every pivot to render as a full-width stacked
   * card. Passing this resolver down lets the chip show a name and keep the sentence as its tooltip.
   */
  const labelOf = useMemo(() => {
    const byId = new Map(districts.map(d => [d.id, d.label]));
    return (districtId: string) => byId.get(districtId);
  }, [districts]);

  return (
    <Surface id={id} title="Imagine" eyebrow="Lateral pivots" glass>
      <div className="x-imagine-panel">
        {fromId && from ? (
          <>
            {/* No trailing punctuation added after `summary` — it is already a full sentence, and
                appending a period produced a visible ".." in the first capture. */}
            <p className="x-imagine-panel__from">
              Pivoting from <strong>{fromLabel ?? from.summary}</strong>
              {derived
                ? ' — the first subject that offers pivots. Focus a district on the Map to pivot from what you are actually studying.'
                : ' — the district you have focused on the Map.'}{' '}
              <span className="x-imagine-panel__summary">{from.summary}</span>
            </p>

            <Imagine
              currentSubjectId={fromId}
              labelOf={labelOf}
              onPin={cardId =>
                setPinned(prev =>
                  prev.includes(cardId) ? prev.filter(c => c !== cardId) : [...prev, cardId],
                )
              }
            />

            <p className="x-imagine-panel__honest">
              {pinned.length === 0
                ? 'Pinned cards are kept for this session only — there is no shared pin store yet, so the Library panel does not see them.'
                : `${pinned.length} card${pinned.length === 1 ? '' : 's'} pinned this session. These are not saved and the Library panel does not see them yet.`}
            </p>
          </>
        ) : (
          /* Reachable only if subjects.ts declares no pivots at all. Stated, not hidden. */
          <p className="x-imagine-panel__honest">
            No subject in the curriculum currently declares a lateral pivot, so there is nothing to
            offer here.
          </p>
        )}
      </div>
    </Surface>
  );
}
