/**
 * Activity — what you have done recently, a focus clock, and what your retention actually looks like.
 *
 * ── Three things this panel was getting wrong ──────────────────────────────────────────────────
 *
 * 1. **"Study Battery" was a gamified metaphor** in a product whose own header says XP, coins and
 *    streaks were explicitly cut. A battery is a resource that depletes as you spend it — the exact
 *    opposite of what the number measures, which is how much of your knowledge is currently retrievable.
 *    It is "Retention" now, and it prints the figure it is computed from instead of hiding a 0..1 mean
 *    behind the word "Holding".
 *
 * 2. **The eyebrow said "This session"** while the list underneath it spanned five days of evidence.
 *    It reads "Last 7 days", which is what the list is filtered to.
 *
 * 3. **"Recent" was a log dump** — eight rows of kind, district and a relative time, with no reading of
 *    them. A log is what you build when you have not decided what the panel is for. It now leads with
 *    what the week amounts to (how many events, across how many subjects, and which subject took the
 *    most of your attention) and the rows carry the source that produced each one, since a school exam
 *    and a flashcard are not the same evidence and the model does not treat them as such.
 */

import { useState, useEffect, useMemo } from 'react';
import { Surface } from '../ui/Surface';
import { useApp, retrievability } from '../state/store';
import type { EvidenceKind } from '../learner/model';
import { sourceLabel } from '../content/subjects';
import {
  createTimer,
  start,
  pause,
  reset,
  tick,
  formatTime,
  remainingMs,
  DEFAULT_DURATION_MS,
  type TimerState,
} from './focusTimer';
import './panels.css';

export interface ActivityCenterProps {
  id: string;
}

/** The window "Recent" covers. Stated in the eyebrow, so the two cannot disagree. */
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function ActivityCenter({ id }: ActivityCenterProps) {
  const concepts = useApp(st => st.concepts);
  const districts = useApp(st => st.districts);

  const [timer, setTimer] = useState<TimerState>(createTimer());
  const [now, setNow] = useState(Date.now());

  // Live clock for the timer and for retrievability, which decays continuously.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setTimer(t => tick(t, now));
  }, [now]);

  /**
   * Concept id → district label.
   *
   * Built once as a map instead of a `districts.find(...)` inside the row loop — that was a scan of 21
   * districts per row, and more importantly it fell back to the user-visible string "Unknown", which is
   * a defect surfaced as content. A concept whose district is genuinely missing is a bug in the seed,
   * not a subject called Unknown, so such rows are dropped from the list instead.
   */
  const districtOfConcept = useMemo(() => {
    const byConcept = new Map<string, string>();
    for (const d of districts) {
      for (const cid of d.conceptIds) byConcept.set(cid, d.label);
    }
    return byConcept;
  }, [districts]);

  /** Everything inside the window, newest first, with a district label resolved. */
  const windowEvents = useMemo(() => {
    const cutoff = now - WINDOW_MS;
    return Object.values(concepts)
      .flatMap(c =>
        c.events.map(e => ({
          ...e,
          conceptId: c.conceptId,
          district: districtOfConcept.get(c.conceptId),
        })),
      )
      .filter((e): e is typeof e & { district: string } => !!e.district && e.at >= cutoff)
      .sort((a, b) => b.at - a.at);
    // `now` ticks 5x/second; recomputing this list that often is wasted work, and the window boundary
    // moving by 200ms cannot change what it contains. Bucketed to the minute instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concepts, districtOfConcept, Math.floor(now / 60_000)]);

  const recent = windowEvents.slice(0, 8);

  /** What the week adds up to. This is the line that turns a log into a reading. */
  const summary = useMemo(() => {
    if (windowEvents.length === 0) return null;
    const bySubject = new Map<string, number>();
    for (const e of windowEvents) bySubject.set(e.district, (bySubject.get(e.district) ?? 0) + 1);
    const ranked = [...bySubject.entries()].sort(
      // Count first, then label — a deterministic order, so a tie does not shuffle between renders.
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    // Guarded rather than asserted: `windowEvents` being non-empty implies `ranked` is too, but that is
    // an argument, not a type. If the invariant ever breaks the summary disappears instead of throwing.
    const top = ranked[0];
    if (!top) return null;
    return { events: windowEvents.length, subjects: bySubject.size, topSubject: top[0], topCount: top[1] };
  }, [windowEvents]);

  // ── Retention ────────────────────────────────────────────────────────────
  const allConcepts = Object.values(concepts);
  const meanR = allConcepts.length > 0
    ? allConcepts.reduce((sum, c) => sum + retrievability(c, now), 0) / allConcepts.length
    : 0;

  /** How many subjects are individually below the point where a retrieval pass is worth it. */
  const slipping = allConcepts.filter(c => retrievability(c, now) < 0.55).length;

  const retentionLabel =
    meanR >= 0.75 ? 'Strong' :
    meanR >= 0.55 ? 'Holding' :
    meanR >= 0.35 ? 'Slipping' :
    'Needs work';

  const retentionReading =
    meanR >= 0.75 ? 'Most of what you have learned is still coming back on demand.' :
    meanR >= 0.55 ? 'The core is still accessible, and the edges are starting to fade.' :
    meanR >= 0.35 ? 'Enough has faded that recall is doing real work. A retrieval pass restores most of it faster than rereading.' :
    'Most of this needs to be pulled back deliberately. Start with the subjects you built highest — they come back quickest.';

  const focusMinutes = Math.round(DEFAULT_DURATION_MS / 60_000);

  return (
    /* Frosted, not solid — this floats over the live desktop, so a solid fill would cover the work
       the student is reading. See Library for the full note. */
    <Surface id={id} title="Activity" eyebrow={`Last ${WINDOW_DAYS} days`} glass>
      <div className="x-activity">
        {/* ── Recent ──────────────────────────────────────────────────────── */}
        <section className="x-activity__section">
          <h3 className="x-activity__heading">Recent</h3>

          {recent.length === 0 ? (
            /* An invitation with the reason attached: says what the panel would show and how to get it. */
            <p className="x-activity__empty">
              Nothing recorded in the last {WINDOW_DAYS} days. Anything you do — a case, a concept check,
              an imported Anki session — lands here with the weight the model gave it.
            </p>
          ) : (
            <>
              {summary && (
                <p className="x-activity__summary">
                  <strong className="x-activity__summaryFigure x-mono">{summary.events}</strong> events
                  across {summary.subjects} {summary.subjects === 1 ? 'subject' : 'subjects'}.
                  Most of it — {summary.topCount} of {summary.events} — was {summary.topSubject}.
                </p>
              )}

              <ul className="x-activity__list">
                {recent.map(e => (
                  <li key={e.id} className="x-activity__item">
                    <span className="x-activity__kind">{kindLabel(e.kind)}</span>
                    <span className="x-activity__district">{e.district}</span>
                    {/* The source, because it is what decides how much the event counted. */}
                    <span className="x-activity__source">{sourceLabel(e.source)}</span>
                    {/* No separator before the time: `.x-activity__time` is pushed to the far right with
                        `margin-left: auto`, so a dot here is not between two things — it strands at the
                        end of the district as "Applied · Renal ·" with nothing following it. Captured
                        that way on every row before this was removed. */}
                    <span className="x-activity__time x-mono">{formatTimeAgo(now - e.at)}</span>
                  </li>
                ))}
              </ul>

              {windowEvents.length > recent.length && (
                <p className="x-activity__more">
                  Showing the 8 most recent of {windowEvents.length}.
                </p>
              )}
            </>
          )}
        </section>

        {/* ── Focus ───────────────────────────────────────────────────────── */}
        <section className="x-activity__section">
          <h3 className="x-activity__heading">Focus</h3>
          <div className="x-timer">
            {/* States what the clock is FOR. A bare 25:00 with Start/Reset does not say whether it is
                a break, a countdown to something, or a study block. */}
            <p className="x-timer__purpose">
              {focusMinutes} minutes on one subject, then a break. The clock does not report to the
              model — only what you actually answer does.
            </p>
            <div className="x-timer__display x-mono">{formatTime(remainingMs(timer, now))}</div>
            <div className="x-timer__controls">
              {timer.running ? (
                <button className="x-timer__btn" onClick={() => setTimer(pause(timer, now))}>
                  Pause
                </button>
              ) : (
                <button className="x-timer__btn" onClick={() => setTimer(start(timer, now))}>
                  {/* "Resume" when there is time already spent, so the control says what will happen. */}
                  {remainingMs(timer, now) < DEFAULT_DURATION_MS && !timer.completed ? 'Resume' : 'Start'}
                </button>
              )}
              <button
                className="x-timer__btn x-timer__btn--secondary"
                onClick={() => setTimer(reset(timer))}
              >
                Reset
              </button>
            </div>
            {timer.completed && (
              <p className="x-timer__complete">
                {focusMinutes} minutes done. Stand up — the next block is worth more after a break.
              </p>
            )}
          </div>
        </section>

        {/* ── Retention ───────────────────────────────────────────────────── */}
        <section className="x-activity__section">
          <h3 className="x-activity__heading">Retention</h3>
          <div className="x-retention">
            <div className="x-retention__head">
              <span className={`x-retention__label is-${retentionLabel.toLowerCase().replace(' ', '-')}`}>
                {retentionLabel}
              </span>
              {/* The actual number. It was computed and then thrown away in favour of one word. */}
              <span className="x-retention__figure x-mono">{Math.round(meanR * 100)}%</span>
            </div>
            <div
              className="x-retention__gauge"
              role="meter"
              aria-valuenow={Math.round(meanR * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Mean recall across all subjects"
            >
              <div className="x-retention__fill" style={{ width: `${meanR * 100}%` }} />
              {/* The line at 55%: below it a retrieval pass is the better use of time than rereading.
                  A gauge with no threshold cannot tell you whether the fill is good. */}
              <div className="x-retention__threshold" />
            </div>
            <p className="x-retention__text">{retentionReading}</p>
            <p className="x-retention__detail">
              Mean chance of recalling a subject right now, across all {allConcepts.length}.
              {slipping > 0 && ` ${slipping} ${slipping === 1 ? 'is' : 'are'} below 55%.`}
            </p>
          </div>
        </section>
      </div>
    </Surface>
  );
}

/**
 * Evidence kinds as a student would say them.
 *
 * Was `kind.charAt(0).toUpperCase() + kind.slice(1)`, which turns `concept-check` into
 * `Concept-check` — a raw enum with a capital letter on it.
 */
function kindLabel(kind: EvidenceKind): string {
  // Keyed by the real `EvidenceKind` union, so a new kind is a type error here rather than a raw
  // enum string leaking onto the screen.
  const LABELS: Record<EvidenceKind, string> = {
    'seen': 'Saw it',
    'recalled': 'Recalled it',
    'distinguished': 'Told it apart',
    'applied': 'Applied it',
    'stable': 'Held over time',
    'fading': 'Going stale',
    'conflicted': 'Sources disagree',
  };
  return LABELS[kind];
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
