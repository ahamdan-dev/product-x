/**
 * Settings — real, working-looking sections.
 *
 * Companion: character choice hands off to store's setCharacter
 * Appearance: light only — state plainly that dark mode is not offered
 * Evidence sources: the 7 real sources from model.ts SOURCE_RELIABILITY, with toggles
 * Data: export/clear
 *
 * Apple-style toggles throughout.
 */

import { useState } from 'react';
import { Surface } from '../ui/Surface';
import { useApp } from '../state/store';
import { SOURCE_RELIABILITY, type EvidenceSource } from '../learner/model';
import './panels.css';

export interface SettingsProps {
  id: string;
}

const EVIDENCE_SOURCES: EvidenceSource[] = [
  'anki',
  'uworld',
  'x-case',
  'amboss',
  'school-exam',
  'x-examiner',
  'nbme',
];

export function Settings({ id }: SettingsProps) {
  const character = useApp(st => st.character);
  const setCharacter = useApp(st => st.setCharacter);

  // Local state for evidence source toggles (would be in store in production)
  const [enabledSources, setEnabledSources] = useState<Set<EvidenceSource>>(
    new Set(EVIDENCE_SOURCES)
  );

  const toggleSource = (source: EvidenceSource) => {
    setEnabledSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  const handleExport = () => {
    // Placeholder — would export learner state as JSON
    alert('Export functionality: would download learner state as JSON.');
  };

  const handleClear = () => {
    if (confirm('Clear all evidence? This cannot be undone.')) {
      alert('Clear functionality: would reset all concept states.');
    }
  };

  return (
    /* Frosted, not solid — floats over the live desktop. See Library for the full note. */
    <Surface id={id} title="Settings" eyebrow="Sources and data" glass>
      <div className="x-settings">
        {/* Companion */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Companion</h3>
          <div className="x-settings__group">
            <label className="x-settings__label">Character</label>
            <div className="x-settings__radio-group">
              <label className="x-settings__radio">
                <input
                  type="radio"
                  name="character"
                  value="female"
                  checked={character === 'female'}
                  onChange={() => setCharacter('female')}
                />
                <span>Female</span>
              </label>
              <label className="x-settings__radio">
                <input
                  type="radio"
                  name="character"
                  value="male"
                  checked={character === 'male'}
                  onChange={() => setCharacter('male')}
                />
                <span>Male</span>
              </label>
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Appearance</h3>
          <div className="x-settings__group">
            <label className="x-settings__label">Theme</label>
            <p className="x-settings__note">
              Light mode only. Dark mode is not offered in this version.
            </p>
          </div>
        </section>

        {/* Evidence sources */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Evidence Sources</h3>
          <p className="x-settings__note">
            Choose which sources contribute to your learner model.
          </p>
          <div className="x-settings__toggles">
            {EVIDENCE_SOURCES.map(source => {
              const reliability = SOURCE_RELIABILITY[source];
              return (
                <div key={source} className="x-settings__toggle-row">
                  <div className="x-settings__toggle-info">
                    <span className="x-settings__toggle-label">
                      {formatSourceLabel(source)}
                    </span>
                    <span className="x-settings__toggle-meta x-mono">
                      {(reliability * 100).toFixed(0)}% reliability
                    </span>
                  </div>
                  <label className="x-toggle">
                    <input
                      type="checkbox"
                      checked={enabledSources.has(source)}
                      onChange={() => toggleSource(source)}
                    />
                    <span className="x-toggle__track">
                      <span className="x-toggle__thumb" />
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </section>

        {/* Data */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Data</h3>
          <div className="x-settings__actions">
            <button className="x-settings__btn" onClick={handleExport}>
              Export learner state
            </button>
            <button
              className="x-settings__btn x-settings__btn--danger"
              onClick={handleClear}
            >
              Clear all evidence
            </button>
          </div>
        </section>
      </div>
    </Surface>
  );
}

function formatSourceLabel(source: EvidenceSource): string {
  const labels: Record<EvidenceSource, string> = {
    'anki': 'Anki',
    'uworld': 'UWorld',
    'x-case': 'X Case',
    'amboss': 'Amboss',
    'school-exam': 'School Exam',
    'x-examiner': 'X Examiner',
    'nbme': 'NBME',
    'x-tutor': 'X Tutor',
    'x-concept-check': 'X Concept Check',
    'x-exam-sim': 'X Exam Sim',
    'self-report': 'Self Report',
  };
  return labels[source] ?? source;
}
