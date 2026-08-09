/**
 * Library — Pins and Flags.
 *
 * Each entry shows a real subject from subjects.ts with its pearl, plus a notes textarea.
 * Empty state is an invitation to act, not a shrug.
 */

import { useState } from 'react';
import { Surface } from '../ui/Surface';
import { SUBJECTS } from '../content/subjects';
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

export function Library({ id }: LibraryProps) {
  // Local state for demo — in production this would be in the store
  const [entries, setEntries] = useState<Entry[]>([
    { kind: 'pin', subjectId: 'cardio', notes: '' },
    { kind: 'flag', subjectId: 'renal', notes: '' },
  ]);

  const [adding, setAdding] = useState<EntryKind | null>(null);

  const pins = entries.filter(e => e.kind === 'pin');
  const flags = entries.filter(e => e.kind === 'flag');

  const updateNotes = (subjectId: string, notes: string) => {
    setEntries(prev =>
      prev.map(e => (e.subjectId === subjectId ? { ...e, notes } : e))
    );
  };

  const removeEntry = (subjectId: string) => {
    setEntries(prev => prev.filter(e => e.subjectId !== subjectId));
  };

  const addEntry = (kind: EntryKind, subjectId: string) => {
    if (entries.some(e => e.subjectId === subjectId)) return;
    setEntries(prev => [...prev, { kind, subjectId, notes: '' }]);
    setAdding(null);
  };

  const availableSubjects = SUBJECTS.filter(
    s => !entries.some(e => e.subjectId === s.id)
  );

  return (
    /* Frosted, not solid. This panel floats over the user's live desktop, so opacity is a
       correctness property: a solid fill here covers the work the student is actually reading. */
    <Surface id={id} title="Library" eyebrow="Pins and flags" glass>
      <div className="x-library">
        {/* Pins */}
        <section className="x-library__section">
          <div className="x-library__header">
            <h3 className="x-library__heading">Pins</h3>
            <button
              className="x-library__add"
              onClick={() => setAdding(adding === 'pin' ? null : 'pin')}
            >
              {adding === 'pin' ? 'Cancel' : '+ Pin'}
            </button>
          </div>

          {adding === 'pin' && (
            <div className="x-library__picker">
              <select
                className="x-library__select"
                onChange={e => {
                  if (e.target.value) addEntry('pin', e.target.value);
                }}
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a subject
                </option>
                {availableSubjects.map(s => (
                  <option key={s.id} value={s.id}>
                    {SUBJECTS.find(x => x.id === s.id)?.summary ?? s.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {pins.length === 0 ? (
            <p className="x-library__empty">
              Pin subjects you're currently focused on. They'll stay here until you unpin them.
            </p>
          ) : (
            <div className="x-library__entries">
              {pins.map(e => (
                <LibraryEntry
                  key={e.subjectId}
                  entry={e}
                  onNotesChange={notes => updateNotes(e.subjectId, notes)}
                  onRemove={() => removeEntry(e.subjectId)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Flags */}
        <section className="x-library__section">
          <div className="x-library__header">
            <h3 className="x-library__heading">Flags</h3>
            <button
              className="x-library__add"
              onClick={() => setAdding(adding === 'flag' ? null : 'flag')}
            >
              {adding === 'flag' ? 'Cancel' : '+ Flag'}
            </button>
          </div>

          {adding === 'flag' && (
            <div className="x-library__picker">
              <select
                className="x-library__select"
                onChange={e => {
                  if (e.target.value) addEntry('flag', e.target.value);
                }}
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a subject
                </option>
                {availableSubjects.map(s => (
                  <option key={s.id} value={s.id}>
                    {SUBJECTS.find(x => x.id === s.id)?.summary ?? s.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {flags.length === 0 ? (
            <p className="x-library__empty">
              Flag subjects that need attention or deeper review. Think of this as your to-do list.
            </p>
          ) : (
            <div className="x-library__entries">
              {flags.map(e => (
                <LibraryEntry
                  key={e.subjectId}
                  entry={e}
                  onNotesChange={notes => updateNotes(e.subjectId, notes)}
                  onRemove={() => removeEntry(e.subjectId)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </Surface>
  );
}

interface LibraryEntryProps {
  entry: Entry;
  onNotesChange: (notes: string) => void;
  onRemove: () => void;
}

function LibraryEntry({ entry, onNotesChange, onRemove }: LibraryEntryProps) {
  const s = SUBJECTS.find(x => x.id === entry.subjectId);
  if (!s) return null;

  return (
    <div className="x-lib-entry">
      <div className="x-lib-entry__header">
        <h4 className="x-lib-entry__title">{s.summary}</h4>
        <button
          className="x-lib-entry__remove"
          onClick={onRemove}
          title="Remove"
        >
          ×
        </button>
      </div>
      <p className="x-lib-entry__pearl">{s.pearl}</p>
      <textarea
        className="x-lib-entry__notes"
        placeholder="Notes"
        value={entry.notes}
        onChange={e => onNotesChange(e.target.value)}
        rows={3}
      />
    </div>
  );
}
