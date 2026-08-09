/**
 * Activity Center — recent evidence, focus timer, and study battery.
 *
 * Real content, no placeholders:
 *   - Recent shows the last 8 evidence events from the store, rendered as human lines
 *   - Focus Timer is a live 25:00 countdown
 *   - Study Battery reads mean retrievability and states what it means
 *
 * No XP, no coins, no streak counter — explicitly cut from the product.
 */

import { useState, useEffect } from 'react';
import { Surface } from '../ui/Surface';
import { useApp, retrievability } from '../state/store';
import {
  createTimer,
  start,
  pause,
  reset,
  tick,
  formatTime,
  remainingMs,
  type TimerState,
} from './focusTimer';
import './panels.css';

export interface ActivityCenterProps {
  id: string;
}

export function ActivityCenter({ id }: ActivityCenterProps) {
  const concepts = useApp(st => st.concepts);
  const districts = useApp(st => st.districts);

  const [timer, setTimer] = useState<TimerState>(createTimer());
  const [now, setNow] = useState(Date.now());

  // Live clock for timer and retrievability
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, []);

  // Tick the timer every render with current time
  useEffect(() => {
    setTimer(t => tick(t, now));
  }, [now]);

  // All recent evidence across all concepts, sorted newest first
  const allEvents = Object.values(concepts)
    .flatMap(c => c.events.map(e => ({ ...e, conceptId: c.conceptId })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);

  // Study battery: mean retrievability across all concepts
  const allConcepts = Object.values(concepts);
  const meanR = allConcepts.length > 0
    ? allConcepts.reduce((sum, c) => sum + retrievability(c, now), 0) / allConcepts.length
    : 0;

  const batteryLabel =
    meanR >= 0.75 ? 'Strong' :
    meanR >= 0.55 ? 'Holding' :
    meanR >= 0.35 ? 'Slipping' :
    'Needs work';

  const batteryExplanation =
    meanR >= 0.75 ? 'Most of what you have learned is still readily available.' :
    meanR >= 0.55 ? 'Core material is accessible; some decay is setting in.' :
    meanR >= 0.35 ? 'Significant decay. A retrieval pass would restore most of it.' :
    'Substantial forgetting. Plan a structured review.';

  return (
    /* Frosted, not solid — this floats over the live desktop, so a solid fill would cover the work
       the student is reading. See Library for the full note. */
    <Surface id={id} title="Activity" eyebrow="This session" glass>
      <div className="x-activity">
        {/* Recent evidence */}
        <section className="x-activity__section">
          <h3 className="x-activity__heading">Recent</h3>
          {allEvents.length === 0 ? (
            <p className="x-activity__empty">No evidence yet. Start a retrieval check to see it here.</p>
          ) : (
            <ul className="x-activity__list">
              {allEvents.map(e => {
                const districtLabel = districts.find(d => d.conceptIds.includes(e.conceptId))?.label ?? 'Unknown';
                const kindLabel = e.kind.charAt(0).toUpperCase() + e.kind.slice(1);
                const timeAgo = formatTimeAgo(now - e.at);
                return (
                  <li key={e.id} className="x-activity__item">
                    <span className="x-activity__kind">{kindLabel}</span>
                    <span className="x-activity__dot">·</span>
                    <span className="x-activity__district">{districtLabel}</span>
                    <span className="x-activity__dot">·</span>
                    <span className="x-activity__time">{timeAgo}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Focus timer */}
        <section className="x-activity__section">
          <h3 className="x-activity__heading">Focus</h3>
          <div className="x-timer">
            <div className="x-timer__display x-mono">
              {formatTime(remainingMs(timer, now))}
            </div>
            <div className="x-timer__controls">
              {timer.running ? (
                <button
                  className="x-timer__btn"
                  onClick={() => setTimer(pause(timer, now))}
                >
                  Pause
                </button>
              ) : (
                <button
                  className="x-timer__btn"
                  onClick={() => setTimer(start(timer, now))}
                >
                  Start
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
              <p className="x-timer__complete">Session complete.</p>
            )}
          </div>
        </section>

        {/* Study battery */}
        <section className="x-activity__section">
          <h3 className="x-activity__heading">Study Battery</h3>
          <div className="x-battery">
            <div className="x-battery__gauge">
              <div
                className="x-battery__fill"
                style={{ width: `${meanR * 100}%` }}
              />
            </div>
            <div className="x-battery__label x-mono">{batteryLabel}</div>
            <p className="x-battery__text">{batteryExplanation}</p>
          </div>
        </section>
      </div>
    </Surface>
  );
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
