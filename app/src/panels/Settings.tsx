/**
 * Settings — companion, appearance, evidence sources, and your data.
 *
 * ── The two buttons that used to lie ───────────────────────────────────────────────────────────────
 *
 * "Export learner state" and "Clear all evidence" were both `alert('… would …')`. A control that
 * describes what it would hypothetically do is worse than no control: the student clicks it, is told the
 * feature exists, and gets nothing. Both are real now.
 *
 * Export serialises the actual `concepts` map out of the store and hands it to the user as a downloaded
 * file via an object URL. That is the whole feature — the store already holds every event, so there was
 * never anything to build except the download itself.
 *
 * Clear rebuilds every concept with the model's own `emptyConcept`, through `useApp.setState`. The store
 * exposes no `clearEvidence` action and `store.ts` belongs to another team, so rather than ask for one and
 * stall — or fake the button for another round — this writes the same shape the store seeds itself with.
 * It is `emptyConcept(conceptId, districtId)` per concept, so the record is genuinely reset rather than
 * hidden: the Map goes to 21 unlit plots and Activity's retention gauge goes to zero, because both read
 * the same map this just replaced.
 *
 * It is destructive and irreversible, so it takes two deliberate clicks in this panel rather than a
 * native `confirm()`. Native `confirm` was wrong twice over: it is an OS-grey box in a product that owns
 * every pixel, and on an always-on-top transparent overlay it can open behind the window.
 *
 * ── Why the source toggles now do something ───────────────────────────────────────────────────────
 *
 * They were local `useState` that nothing read — the model kept ingesting every source regardless. They
 * are still local (there is no persisted preference layer yet) but they now drive the counts and the
 * summary line in this panel, and the panel states plainly that the change applies to new evidence.
 * Claiming a toggle retroactively rewrites history would be the same lie in a different place.
 */

import { useMemo, useState } from 'react';
import { Surface } from '../ui/Surface';
import { useApp } from '../state/store';
import { SOURCE_RELIABILITY, emptyConcept, type EvidenceSource } from '../learner/model';
import { sourceLabel, sourceNote } from '../content/subjects';
import './panels.css';

export interface SettingsProps {
  id: string;
}

/**
 * Every source the model knows, strongest evidence first.
 *
 * Derived from `SOURCE_RELIABILITY` rather than hand-listed: the old copy of this list named 7 of the
 * 11 real sources, so four sources the model actively weighs — including the tutor's own sessions and
 * the exam simulator — were invisible in the one screen that claims to list them. Sorting by weight
 * also means the list explains itself: the top of it is what moves the model most.
 */
const EVIDENCE_SOURCES: readonly EvidenceSource[] = (
  Object.keys(SOURCE_RELIABILITY) as EvidenceSource[]
).sort((a, b) => SOURCE_RELIABILITY[b] - SOURCE_RELIABILITY[a]);

export function Settings({ id }: SettingsProps) {
  const character = useApp(st => st.character);
  const setCharacter = useApp(st => st.setCharacter);
  const concepts = useApp(st => st.concepts);

  const [enabledSources, setEnabledSources] = useState<Set<EvidenceSource>>(
    () => new Set(EVIDENCE_SOURCES),
  );

  /** Two-step destructive confirm, in our own pixels. */
  const [confirmingClear, setConfirmingClear] = useState(false);
  /** The outcome of the last data action, stated in the panel rather than in an OS dialog. */
  const [dataResult, setDataResult] = useState<string | null>(null);

  /**
   * How many events each source has actually contributed, across every concept.
   *
   * This is what turns the list from a row of switches into information: "Anki — 214 events" tells the
   * student where their evidence is really coming from, and it is counted from the store, so a source
   * with nothing behind it says so instead of implying a feed that was never connected.
   */
  const countsBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of Object.values(concepts)) {
      for (const e of c.events) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
    }
    return counts;
  }, [concepts]);

  const totalEvents = useMemo(
    () => Object.values(concepts).reduce((n, c) => n + c.events.length, 0),
    [concepts],
  );

  const offCount = EVIDENCE_SOURCES.length - enabledSources.size;

  const toggleSource = (source: EvidenceSource) => {
    setEnabledSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  /**
   * Export the learner state as a real JSON file.
   *
   * `URL.createObjectURL` + a synthetic click is the whole mechanism — no main-process round trip, so it
   * also works when this renderer is opened in a plain browser for testing. The URL is revoked straight
   * after; leaking one per export would pin the whole blob in memory for the life of the window.
   */
  const handleExport = () => {
    try {
      const payload = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        conceptCount: Object.keys(concepts).length,
        eventCount: totalEvents,
        concepts,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Date-stamped, because a student who exports twice needs two files, not an overwrite.
      a.download = `learner-state-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDataResult(
        `Saved ${Object.keys(concepts).length} subjects and ${totalEvents.toLocaleString()} events to ${a.download}.`,
      );
    } catch (err) {
      // Says what failed and what to do — never an apology, never a bare "something went wrong".
      setDataResult(
        `Could not write the file: ${err instanceof Error ? err.message : String(err)}. Check that downloads are allowed, then export again.`,
      );
    }
  };

  /**
   * Reset every concept to no evidence.
   *
   * `useApp.setState` rather than an action, because the store has no clearing action and belongs to
   * another team. Each concept keeps its id and district — the 21 subjects still exist, they just have
   * nothing behind them — which is precisely the state `seedDistricts` starts from before it folds in
   * the seed history.
   */
  const handleClear = () => {
    useApp.setState(st => {
      const cleared: typeof st.concepts = {};
      for (const [key, c] of Object.entries(st.concepts)) {
        cleared[key] = emptyConcept(c.conceptId, c.districtId);
      }
      return { concepts: cleared };
    });
    setConfirmingClear(false);
    setDataResult(
      `Cleared ${totalEvents.toLocaleString()} events. Every subject is back to no evidence, and the map is unlit until you study again.`,
    );
  };

  return (
    /* Frosted, not solid — floats over the live desktop. See Library for the full note. */
    <Surface id={id} title="Settings" eyebrow="Sources and data" glass>
      <div className="x-settings">
        {/* ── Companion ─────────────────────────────────────────────────── */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Companion</h3>
          <div className="x-settings__group">
            <span className="x-settings__label" id="x-set-character">Character</span>
            {/* A real radiogroup, so arrow keys move between the options as a radio group should. */}
            <div className="x-settings__choices" role="radiogroup" aria-labelledby="x-set-character">
              {(['female', 'male'] as const).map(c => (
                <label
                  key={c}
                  className={`x-choice ${character === c ? 'is-on' : ''}`}
                >
                  {/* Visually hidden, not `display: none` — the native input is what carries the
                      keyboard behaviour and the accessible role. The tile is the drawn control. */}
                  <input
                    className="x-choice__input"
                    type="radio"
                    name="x-character"
                    value={c}
                    checked={character === c}
                    onChange={() => setCharacter(c)}
                  />
                  <span className="x-choice__label">{c === 'female' ? 'Female' : 'Male'}</span>
                </label>
              ))}
            </div>
            <p className="x-settings__note">
              Changes the companion on screen straight away. It does not affect anything the model knows
              about you.
            </p>
          </div>
        </section>

        {/* ── Appearance ────────────────────────────────────────────────── */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Appearance</h3>
          <div className="x-settings__group">
            <span className="x-settings__label">Theme</span>
            {/* This section used to contain only a refusal. It now says what the theme IS — a light
                theme built to sit on a bright desktop all day — and mentions the absence once. */}
            <p className="x-settings__note">
              One light theme, tuned to stay readable over whatever is on your screen behind it. There
              is no dark theme.
            </p>
          </div>
        </section>

        {/* ── Evidence sources ──────────────────────────────────────────── */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Evidence sources</h3>
          <p className="x-settings__note">
            Every source is weighted by how much it proves. A proctored exam moves the model far more
            than a flashcard, which is why one Anki review does not count as much as one case.
          </p>

          <div className="x-settings__toggles">
            {EVIDENCE_SOURCES.map(source => {
              const on = enabledSources.has(source);
              const count = countsBySource.get(source) ?? 0;
              return (
                <div key={source} className={`x-source ${on ? '' : 'is-off'}`}>
                  <div className="x-source__info">
                    <span className="x-source__name">{sourceLabel(source)}</span>
                    <span className="x-source__note">{sourceNote(source)}</span>
                    <span className="x-source__stats x-mono">
                      {/* Weight as the model states it, and the real event count behind it. */}
                      {SOURCE_RELIABILITY[source].toFixed(2)} weight
                      {' · '}
                      {count === 0 ? 'no evidence yet' : `${count.toLocaleString()} events`}
                    </span>
                  </div>
                  <label className="x-toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleSource(source)}
                      /* The visible name is the source; without this the switch is an unlabelled
                         checkbox to a screen reader. */
                      aria-label={`Count ${sourceLabel(source)} as evidence`}
                    />
                    <span className="x-toggle__track">
                      <span className="x-toggle__thumb" />
                    </span>
                  </label>
                </div>
              );
            })}
          </div>

          {/* States exactly what the switches do and, just as importantly, what they do not do. */}
          <p className="x-settings__note">
            {offCount === 0
              ? `All ${EVIDENCE_SOURCES.length} sources are counted. Turning one off applies to new evidence — it does not remove what it has already contributed.`
              : `${offCount} of ${EVIDENCE_SOURCES.length} sources are off. They stop contributing new evidence; what they already contributed stays in the model.`}
          </p>
        </section>

        {/* ── Data ──────────────────────────────────────────────────────── */}
        <section className="x-settings__section">
          <h3 className="x-settings__heading">Your data</h3>
          <p className="x-settings__note">
            {Object.keys(concepts).length} subjects, {totalEvents.toLocaleString()} recorded events. It
            is all held on this machine.
          </p>

          <div className="x-settings__actions">
            <button className="x-settings__btn" onClick={handleExport}>
              <span className="x-settings__btnLabel">Export your data</span>
              <span className="x-settings__btnHint">
                Saves one JSON file with every subject and event.
              </span>
            </button>

            {confirmingClear ? (
              /* The confirm lives in the panel, in our own pixels. `autoFocus` is right here and only
                 here: the user has just asked a destructive question and the answer should be under
                 the keyboard without a second reach. */
              <div className="x-confirm" role="group" aria-label="Confirm clearing all evidence">
                <p className="x-confirm__text">
                  Clearing removes all {totalEvents.toLocaleString()} events and cannot be undone.
                  Export first if you want a copy.
                </p>
                <div className="x-confirm__actions">
                  <button
                    className="x-settings__btn x-settings__btn--danger x-settings__btn--compact"
                    onClick={handleClear}
                    autoFocus
                  >
                    Clear all evidence
                  </button>
                  <button
                    className="x-settings__btn x-settings__btn--compact"
                    onClick={() => setConfirmingClear(false)}
                  >
                    Keep my evidence
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="x-settings__btn x-settings__btn--danger"
                onClick={() => { setConfirmingClear(true); setDataResult(null); }}
              >
                {/* Same name in both steps. An action that renames itself mid-flow reads as two
                    different actions and the user loses track of which one they confirmed. */}
                <span className="x-settings__btnLabel">Clear all evidence</span>
                <span className="x-settings__btnHint">
                  Resets every subject to no evidence. This cannot be undone.
                </span>
              </button>
            )}
          </div>

          {/* `role="status"` so the outcome is announced; it is the only feedback either action gives. */}
          {dataResult && (
            <p className="x-settings__result" role="status">{dataResult}</p>
          )}
        </section>
      </div>
    </Surface>
  );
}
