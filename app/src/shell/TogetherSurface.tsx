/**
 * The Together surface — "Who am I learning with?"
 *
 * The third of the three surfaces. What it must NOT become is the thing the product law explicitly
 * kills: a global leaderboard, a rank, an XP comparison. Social pressure is not evidence, and
 * ranking learners against each other is the exact failure mode the cut list names.
 *
 * So Together is cooperative by construction: study invites, shared case threads, and a "who is
 * working on the same thing right now" read. The one competitive-looking number in the whole surface
 * is deliberately absent.
 *
 * This is scaffolded honestly: the layout, copy and material are real, and the data is seeded rather
 * than live, because there is no multiplayer backend yet. Nothing here claims otherwise.
 */

import './togetherSurface.css';

interface Companion {
  name: string;
  /** What they are working on — the only status that matters here. */
  focus: string;
  /** Shared concept ids, i.e. genuine overlap with the current learner. */
  overlap: number;
  live: boolean;
}

/** Seeded, not live. Named so that nobody mistakes this for a fetch. */
const SEEDED_COHORT: readonly Companion[] = [
  { name: 'Maya',   focus: 'Pharmacokinetics',      overlap: 14, live: true },
  { name: 'Dev',    focus: 'Acid–base compensation', overlap: 9,  live: true },
  { name: 'Priya',  focus: 'Cardiac cycle',          overlap: 6,  live: false },
  { name: 'Sam',    focus: 'Antibiotic mechanisms',  overlap: 4,  live: false },
];

const THREADS: readonly { title: string; note: string; replies: number }[] = [
  { title: 'Cardiology cases',   note: 'Wide-complex tachycardia — two readings of the same strip', replies: 2 },
  { title: 'Renal study sprint', note: 'Tonight, 7pm — countercurrent multiplication',              replies: 5 },
];

export default function TogetherSurface() {
  return (
    <div className="x-together">
      <div className="x-together__inner">
        {/* One pane per section, holding rows. The window is transparent: a row with no frosted
            backing is not a clean row, it is text on the user's wallpaper. And rows inside a shared
            pane get one left edge and one right rail, which is what makes a list scannable. */}
        <section className="x-together__pane" aria-labelledby="tg-cohort">
          <div className="x-together__head">
            <p className="x-eyebrow" id="tg-cohort">Studying now</p>
            <span className="x-together__count x-mono">
              {SEEDED_COHORT.filter(c => c.live).length} live
            </span>
          </div>
          <ul className="x-together__cohort">
            {SEEDED_COHORT.map(c => (
              <li key={c.name} className="x-together__person">
                <span className="x-together__who">
                  {/* Presence is a state, so it is allowed to glow — and it is the only thing on
                      this surface that does. */}
                  <span
                    className={c.live ? 'x-together__dot x-together__dot--live' : 'x-together__dot'}
                    aria-hidden="true"
                  />
                  <span className="x-together__name">{c.name}</span>
                </span>
                <span className="x-together__focus">{c.focus}</span>
                {/* Overlap, not rank. This is a reason to talk to someone, not a score. */}
                <span className="x-together__overlap x-mono">
                  {c.overlap} shared
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="x-together__pane" aria-labelledby="tg-threads">
          <div className="x-together__head">
            <p className="x-eyebrow" id="tg-threads">Case threads</p>
            <span className="x-together__count x-mono">{THREADS.length}</span>
          </div>
          <ul className="x-together__threads">
            {THREADS.map(t => (
              <li key={t.title} className="x-together__thread">
                <span className="x-together__title">{t.title}</span>
                <span className="x-together__note">{t.note}</span>
                <span className="x-together__replies x-mono">{t.replies} replies</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Stated plainly rather than mocked up as if it worked. On glass like everything else, so it
            stays legible over an arbitrary desktop — this is the one line stopping a reader from
            assuming there is a multiplayer service. */}
        <p className="x-together__pane x-together__honest">
          Cohort data is seeded for now — there is no multiplayer service behind this yet.
        </p>
      </div>
    </div>
  );
}
