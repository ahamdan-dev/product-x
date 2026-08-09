/**
 * Library — the subjects you pinned, and the ones you flagged.
 *
 * ── What was wrong with this panel ─────────────────────────────────────────────────────────────
 *
 * The heading of every entry was the subject's `summary` — a full sentence used as a title, so a pin
 * read "The cardiac cycle, pressure–volume relationships, and the murmurs that follow." and the word
 * "Cardiovascular" appeared nowhere in the panel. The subject picker had the same bug, so choosing a
 * subject meant reading a dropdown of paragraphs. Titles are names now; the summary is the line under it.
 *
 * ── Why each entry shows model state ──────────────────────────────────────────────────────────
 *
 * A pin used to be a title, a pearl and an empty notes box — the same three things whether the subject
 * was solid or had not been touched in eight months. That is a bookmark, not a library. Each entry now
 * carries what the learner model actually knows about that subject: live mastery, whether it is holding
 * or slipping, and the single most important finding from `findings()` — the same engine the rest of the
 * product answers "why this?" with. So the panel tells you why the subject deserves your attention
 * rather than just that you once clicked a pin on it.
 *
 * ── One name per action ───────────────────────────────────────────────────────────────────────
 *
 * The add control used to be "+ Pin", then "Cancel", then the list said "Choose a subject" — three names
 * for one flow. It is "Pin a subject" throughout, and the picker is labelled by it.
 *
 * State is local and deliberately so: `store.ts` has no pins collection and belongs to another team.
 * Pins survive while the panel is open, and the panel does not claim otherwise anywhere in its copy.
 */

import { useMemo, useState } from 'react';
import { Surface } from '../ui/Surface';
import { SUBJECTS } from '../content/subjects';
import { useApp } from '../state/store';
import { findings, mastery, retrievability, peakMastery, type ConceptState } from '../learner/model';
import './panels.css';

export interface LibraryProps {
  id: string;
}

type EntryKind = 'pin' | 'flag';

interface Entry {
  kind: EntryKind;
  subjectId: string;
  notes: string;
}

/**
 * The two seeded entries are chosen from the seed profiles, not at random.
 *
 * `learner/seed.ts` gives cardio a strong, well-verified history and renal a strong but *unverified*
 * one — high mastery, low estimate confidence. So a pin and a flag on those two subjects demonstrate
 * the two states this panel exists to distinguish, on first open, with no clicking. A pair of arbitrary
 * subjects would have shown the same layout twice.
 */
const INITIAL_ENTRIES: readonly Entry[] = [
  { kind: 'pin', subjectId: 'cardio', notes: 'Murmur timing still costs me a beat — say systolic/diastolic before naming the valve.' },
  { kind: 'flag', subjectId: 'renal', notes: '' },
];

export function Library({ id }: LibraryProps) {
  const [entries, setEntries] = useState<Entry[]>(() => [...INITIAL_ENTRIES]);
  const [adding, setAdding] = useState<EntryKind | null>(null);

  const pins = entries.filter(e => e.kind === 'pin');
  const flags = entries.filter(e => e.kind === 'flag');

  const updateNotes = (subjectId: string, notes: string) => {
    setEntries(prev => prev.map(e => (e.subjectId === subjectId ? { ...e, notes } : e)));
  };

  const removeEntry = (subjectId: string) => {
    setEntries(prev => prev.filter(e => e.subjectId !== subjectId));
  };

  const addEntry = (kind: EntryKind, subjectId: string) => {
    if (entries.some(e => e.subjectId === subjectId)) return;
    setEntries(prev => [...prev, { kind, subjectId, notes: '' }]);
    setAdding(null);
  };

  const availableSubjects = SUBJECTS.filter(s => !entries.some(e => e.subjectId === s.id));

  return (
    /* Frosted, not solid. This panel floats over the user's live desktop, so opacity is a
       correctness property: a solid fill here covers the work the student is actually reading. */
    <Surface id={id} title="Library" eyebrow="Pins and flags" glass>
      <div className="x-library">
        <Section
          kind="pin"
          heading="Pins"
          addLabel="Pin a subject"
          /* An invitation with a reason, not a mood. It says what a pin is FOR. */
          empty="Pin what you are working on this week. Pinned subjects keep their notes and their current standing in one place, so you are not re-deriving where you left off."
          entries={pins}
          adding={adding === 'pin'}
          available={availableSubjects}
          onToggleAdd={() => setAdding(adding === 'pin' ? null : 'pin')}
          onAdd={subjectId => addEntry('pin', subjectId)}
          onNotesChange={updateNotes}
          onRemove={removeEntry}
        />

        <Section
          kind="flag"
          heading="Flags"
          addLabel="Flag a subject"
          empty="Flag what is not sitting right yet. Anything here is something you have told me to bring back before an exam, whatever the model thinks."
          entries={flags}
          adding={adding === 'flag'}
          available={availableSubjects}
          onToggleAdd={() => setAdding(adding === 'flag' ? null : 'flag')}
          onAdd={subjectId => addEntry('flag', subjectId)}
          onNotesChange={updateNotes}
          onRemove={removeEntry}
        />
      </div>
    </Surface>
  );
}

interface SectionProps {
  kind: EntryKind;
  heading: string;
  addLabel: string;
  empty: string;
  entries: Entry[];
  adding: boolean;
  available: typeof SUBJECTS;
  onToggleAdd: () => void;
  onAdd: (subjectId: string) => void;
  onNotesChange: (subjectId: string, notes: string) => void;
  onRemove: (subjectId: string) => void;
}

/**
 * One section, so Pins and Flags cannot drift apart.
 *
 * They were two copies of forty near-identical lines, which is how the picker ended up with the same
 * bug twice. One component, two call sites.
 */
function Section({
  kind, heading, addLabel, empty, entries, adding, available,
  onToggleAdd, onAdd, onNotesChange, onRemove,
}: SectionProps) {
  const districts = useApp(st => st.districts);
  const pickerId = `x-lib-picker-${kind}`;

  /** District id → display label, from the store. One source of names, as everywhere else. */
  const labelOf = useMemo(() => {
    const byId = new Map(districts.map(d => [d.id, d.label]));
    return (subjectId: string) => byId.get(subjectId) ?? subjectId;
  }, [districts]);

  return (
    <section className="x-library__section">
      <div className="x-library__header">
        <h3 className="x-library__heading">
          {heading}
          {/* The count, so the heading reports rather than just labels. */}
          {entries.length > 0 && <span className="x-library__count x-mono">{entries.length}</span>}
        </h3>
        <button
          className="x-library__add"
          onClick={onToggleAdd}
          aria-expanded={adding}
          aria-controls={pickerId}
        >
          {/* Same name open or closed. The chevron carries the state, not the label. */}
          <span className="x-library__addIcon" aria-hidden="true">{adding ? '−' : '+'}</span>
          {addLabel}
        </button>
      </div>

      {adding && (
        <div className="x-library__picker" id={pickerId}>
          {available.length === 0 ? (
            /* Says what happened and what to do about it. Never a blank dropdown. */
            <p className="x-library__pickerNote">
              Every subject is already pinned or flagged. Remove one to add another.
            </p>
          ) : (
            <>
              <label className="x-library__pickerLabel" htmlFor={`${pickerId}-select`}>
                {addLabel}
              </label>
              <select
                className="x-library__select"
                id={`${pickerId}-select`}
                onChange={e => { if (e.target.value) onAdd(e.target.value); }}
                defaultValue=""
              >
                <option value="" disabled>
                  {available.length} subjects available
                </option>
                {/* Names, not sentences. Sorted by the label the student reads, so the list is
                    scannable — subject order in `SUBJECTS` is ring order, which means nothing here. */}
                {[...available]
                  .sort((a, b) => labelOf(a.id).localeCompare(labelOf(b.id)))
                  .map(s => (
                    <option key={s.id} value={s.id}>{labelOf(s.id)}</option>
                  ))}
              </select>
            </>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="x-library__empty">{empty}</p>
      ) : (
        <div className="x-library__entries">
          {entries.map(e => (
            <LibraryEntry
              key={e.subjectId}
              entry={e}
              label={labelOf(e.subjectId)}
              onNotesChange={notes => onNotesChange(e.subjectId, notes)}
              onRemove={() => onRemove(e.subjectId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface LibraryEntryProps {
  entry: Entry;
  label: string;
  onNotesChange: (notes: string) => void;
  onRemove: () => void;
}

function LibraryEntry({ entry, label, onNotesChange, onRemove }: LibraryEntryProps) {
  const concepts = useApp(st => st.concepts);
  const s = SUBJECTS.find(x => x.id === entry.subjectId);

  /**
   * The concept behind this subject.
   *
   * `seedDistricts` gives each district exactly one concept, `<id>.core`. Read straight rather than
   * scanning every district's `conceptIds`, and treated as optional so a subject with no concept yet
   * degrades to the copy-only entry instead of throwing.
   */
  const concept: ConceptState | undefined = concepts[`${entry.subjectId}.core`];

  const now = Date.now();
  const standing = useMemo(
    () => (concept ? readStanding(concept, now, label) : null),
    // `now` is read once per render on purpose: this panel has no live clock, and a subject's standing
    // does not visibly move over the seconds a panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [concept, label],
  );

  if (!s) return null;

  return (
    <article className="x-lib-entry">
      <div className="x-lib-entry__header">
        <div className="x-lib-entry__ident">
          {/* The NAME is the title. The sentence moved below it, where a sentence belongs. */}
          <h4 className="x-lib-entry__title">{label}</h4>
          <p className="x-lib-entry__summary">{s.summary}</p>
        </div>
        <button
          className="x-lib-entry__remove"
          onClick={onRemove}
          /* Was a bare "×" with a `title` — an unnamed button to a screen reader. Names the subject
             so a list of five removes is five distinct controls. */
          aria-label={`Remove ${label} from your ${entry.kind === 'pin' ? 'pins' : 'flags'}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {standing && (
        <div className="x-lib-entry__standing">
          <div className="x-lib-entry__meter" aria-hidden="true">
            <div className="x-lib-entry__meterFill" style={{ width: `${standing.mastery * 100}%` }} />
            {/* The high-water mark, drawn where mastery peaked. The gap between the fill and this
                tick IS the forgetting — the one thing a bare percentage cannot show. */}
            {standing.peak > standing.mastery + 0.02 && (
              <div className="x-lib-entry__meterPeak" style={{ left: `${standing.peak * 100}%` }} />
            )}
          </div>
          <div className="x-lib-entry__standingRow">
            <span className={`x-lib-entry__state is-${standing.tone}`}>{standing.state}</span>
            <span className="x-lib-entry__figures x-mono">
              {Math.round(standing.mastery * 100)}% mastery · {Math.round(standing.recall * 100)}% recall
            </span>
          </div>
          {/* Interpretation then action — the same order `findings()` uses, because it is the finding. */}
          <p className="x-lib-entry__reading">{standing.interpretation}</p>
          <p className="x-lib-entry__action">{standing.action}</p>
        </div>
      )}

      <p className="x-lib-entry__pearl">{s.pearl}</p>

      <label className="x-lib-entry__notesLabel" htmlFor={`x-lib-notes-${entry.subjectId}`}>
        Your notes
      </label>
      <textarea
        className="x-lib-entry__notes"
        id={`x-lib-notes-${entry.subjectId}`}
        /* A placeholder that models the behaviour we want, rather than repeating the label. */
        placeholder="What tripped you up, in your own words"
        value={entry.notes}
        onChange={e => onNotesChange(e.target.value)}
        rows={3}
      />
    </article>
  );
}

interface Standing {
  mastery: number;
  peak: number;
  recall: number;
  state: string;
  tone: 'holding' | 'slipping' | 'thin';
  interpretation: string;
  action: string;
}

/**
 * The subject's standing, in the model's own terms.
 *
 * Interpretation and action come from `findings()` where it has something to say — most severe first,
 * so a conflict outranks a "stop studying this". Where it is silent (a subject in the middle with no
 * finding triggered) the fallback still states the mastery figure's meaning rather than repeating it,
 * because a number with no reading is the thing this panel is meant to stop doing.
 */
function readStanding(c: ConceptState, now: number, label: string): Standing {
  const live = mastery(c, now);
  const peak = peakMastery(c);
  const recall = retrievability(c, now);

  const RANK = { critical: 0, notable: 1, informational: 2 } as const;
  const top = [...findings(c, now, label)].sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];

  const thin = c.estimateConfidence < 0.35;
  const slipping = peak >= 0.7 && recall < 0.55;

  const state = thin ? 'Not enough evidence' : slipping ? 'Slipping' : live >= 0.7 ? 'Holding' : 'Building';
  const tone: Standing['tone'] = thin ? 'thin' : slipping ? 'slipping' : 'holding';

  return {
    mastery: live,
    peak,
    recall,
    state,
    tone,
    interpretation:
      top?.interpretation ??
      `${label} is at ${Math.round(live * 100)}% and the estimate is steady — no source disagrees and nothing is overdue.`,
    action: top?.action ?? 'Nothing needed here this week. Spend the time on a subject that is moving.',
  };
}
