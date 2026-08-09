/**
 * Today — "What should I do next?"
 *
 * The first thing anyone sees, so it has one job and answers one question. Structure:
 *
 *   ONE lead recommendation, large, with its reasoning visible and a real question inside it.
 *   Then the queue — everything else, ranked, compact.
 *   Then the honest footer: what the model does not know yet.
 *
 * The discipline here is that Today shows a *decision*, not a dashboard. A grid of nine equal cards
 * is the same decision handed back to the learner with extra steps. So the lead move gets the space,
 * and the runners-up get one line each.
 *
 * Every number and every sentence on this surface comes from the learner model via `nextMoves()`.
 * Nothing is written for effect. The "Why this?" disclosure shows the actual evidence ids the model
 * cited — which is the product thesis made literal: the explanation IS the product.
 */

import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { nextMoves, headline, KIND_LABEL, KIND_VERB, pearlFor, type Move } from './nextMove';
import { subject } from '../content/subjects';
import './todaySurface.css';

/** Greeting by hour. Warm without being cute — it is a study tool, not a birthday card. */
function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The conviction ramp: mastery maps onto the seven evidence tokens, one hue at climbing saturation.
 * Saturation means certainty, so the ramp is legible with no legend and no numbers — the signature
 * idea of the whole visual system. `MAINTENANCE` deliberately bleeds to warm grey rather than red,
 * because decay is not failure, and `settle` is amber because disagreement is a caution.
 */
function convictionVar(m: Move): string {
  if (m.kind === 'settle') return 'var(--x-ev-conflicted)';
  if (m.state === 'MAINTENANCE') return 'var(--x-ev-fading)';
  if (m.mastery >= 0.82) return 'var(--x-ev-stable)';
  if (m.mastery >= 0.62) return 'var(--x-ev-applied)';
  if (m.mastery >= 0.40) return 'var(--x-ev-distinguished)';
  if (m.mastery >= 0.20) return 'var(--x-ev-recalled)';
  return 'var(--x-ev-seen)';
}

/** Minutes, phrased the way a person would say it. */
function duration(min: number): string {
  if (min <= 0) return 'no time at all';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

/**
 * The evidence disclosure. Collapsed by default because the lead card should read as an answer, not
 * as an argument — but always present, because a recommendation you cannot interrogate is just an
 * assertion.
 */
function WhyThis({ move }: { move: Move }) {
  const [open, setOpen] = useState(false);
  const count = move.because.length;

  return (
    <div className="x-today__why">
      <button
        type="button"
        className="x-today__whyBtn"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        Why this?
      </button>
      {open && (
        <div className="x-today__whyBody">
          <p className="x-today__whyLine">
            {count > 0
              ? `Drawn from your last ${count} recorded ${count === 1 ? 'attempt' : 'attempts'} on this subject.`
              : 'There is no recorded evidence on this subject yet, which is itself the reason it is here.'}
          </p>
          {count > 0 && (
            <ul className="x-today__evidence">
              {move.because.map(id => (
                <li key={id} className="x-mono">{id}</li>
              ))}
            </ul>
          )}
          <p className="x-today__whyLine x-today__whyLine--muted">
            Confidence in this estimate: {Math.round(move.confidence * 100)}%. Low confidence means the
            model does not know enough yet — not that you are behind.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The lead recommendation. One per day, given real room — and the only hero-weight material on the
 * surface.
 *
 * The greeting lives in here rather than in a header block above. On a transparent window a separate
 * salutation block is either a naked line of text on the user's wallpaper or its own opaque slab with
 * a hard edge stopping mid-sentence; both read as an artifact. A salutation is not a card, so it
 * becomes this card's first line, where it also fills the metadata bar the card needed anyway.
 *
 * NOT `x-glass` / `x-glass--thick`: those carry `--x-glass-bg` at 90% alpha, which measured as a fully
 * opaque sheet over the desktop pattern. The CSS keeps every other glass token and swaps only the fill.
 */
function LeadMove({ move, onStart, greetingText }: {
  move: Move;
  onStart: (m: Move) => void;
  greetingText: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const pearl = pearlFor(move.id);

  return (
    <article
      className="x-today__lead"
      style={{ ['--conviction' as string]: convictionVar(move) }}
      aria-labelledby="today-lead-title"
    >
      <header className="x-today__leadHead">
        <p className="x-eyebrow">{greetingText}</p>
        <span className="x-today__leadMeta">
          <span className="x-eyebrow">{KIND_LABEL[move.kind]}</span>
          {/* The conviction chip is the only glowing thing on this surface at rest, and it glows
              because a state emits it — not as decoration. */}
          <span className="x-today__conviction" aria-hidden="true" />
        </span>
      </header>

      <h1 className="x-display x-today__h1">One thing first.</h1>
      <h2 className="x-display x-today__leadTitle" id="today-lead-title">{move.label}</h2>
      <p className="x-today__interpretation">{move.interpretation}</p>
      <p className="x-today__action">{move.action}</p>

      {move.prompt && (
        <div className="x-today__prompt">
          <p className="x-eyebrow">Start here</p>
          <p className="x-today__q">{move.prompt.q}</p>
          {revealed ? (
            <p className="x-today__a">{move.prompt.a}</p>
          ) : (
            /* Answer hidden first. Showing it immediately turns retrieval practice into reading,
               which produces no evidence the model can use. */
            <button type="button" className="x-today__reveal" onClick={() => setRevealed(true)}>
              Show answer
            </button>
          )}
        </div>
      )}

      {pearl && (
        <p className="x-today__pearl">
          <span className="x-today__pearlMark" aria-hidden="true" />
          {pearl}
        </p>
      )}

      <footer className="x-today__leadFoot">
        <button type="button" className="x-today__cta" onClick={() => onStart(move)}>
          {KIND_VERB[move.kind]}
          <span className="x-today__ctaTime x-mono">{duration(move.minutes)}</span>
        </button>
        <WhyThis move={move} />
      </footer>
    </article>
  );
}

/** A queued move. One line, scannable — the point is to be skipped past, not studied. */
function QueueRow({ move, onStart }: { move: Move; onStart: (m: Move) => void }) {
  const s = subject(move.id);
  return (
    /* No `x-card` here: the row is not its own object. It lives inside the queue pane and is
       separated by a hairline, so the list has one left edge and one right rail. */
    <li className="x-today__row" style={{ ['--conviction' as string]: convictionVar(move) }}>
      <span className="x-today__rowBar" aria-hidden="true" />
      <span className="x-today__rowMain">
        <span className="x-today__rowTitle">{move.label}</span>
        <span className="x-today__rowWhy">{s?.summary ?? move.interpretation}</span>
      </span>
      <span className="x-today__rowKind">{KIND_LABEL[move.kind]}</span>
      <span className="x-today__rowTime x-mono">
        {move.minutes > 0 ? duration(move.minutes) : '—'}
      </span>
      <button
        type="button"
        className="x-today__rowGo"
        onClick={() => onStart(move)}
        aria-label={`${KIND_VERB[move.kind]}: ${move.label}`}
      >
        {/* A chevron drawn in CSS rather than an icon font — one less asset, and it inherits color. */}
        <span className="x-today__chev" aria-hidden="true" />
      </button>
    </li>
  );
}

export default function TodaySurface() {
  const districts = useApp(s => s.districts);
  const concepts = useApp(s => s.concepts);
  const openSurface = useApp(s => s.openSurface);

  /**
   * `now` is captured once per mount rather than read on every render. Reading the clock inside the
   * memo would make the ranking recompute — and potentially reorder under the user's cursor — on any
   * unrelated state change. Decay over a single session is far below the threshold that would change
   * an ordering, so a stable timestamp is both cheaper and more correct here.
   */
  const now = useMemo(() => Date.now(), []);
  const moves = useMemo(() => nextMoves(districts, concepts, now), [districts, concepts, now]);
  const { lead, rest } = useMemo(() => headline(moves), [moves]);

  const hour = useMemo(() => new Date(now).getHours(), [now]);

  // How much the model genuinely does not know. Stated plainly rather than hidden, because an
  // interface that implies complete knowledge of a learner is lying.
  const unknown = moves.filter(m => m.confidence < 0.25).length;

  const start = (m: Move) => {
    // Opens a floating work surface for the subject. The store owns geometry and z-order.
    openSurface(`card:${m.id}`);
  };

  return (
    <div className="x-today">
      <div className="x-today__inner">
        {/* Every block below sits on a frosted pane. The window is transparent and the shell paints
            nothing, so an element without a backing is not "clean" — it is text on the wallpaper. */}
        {lead ? (
          <LeadMove move={lead} onStart={start} greetingText={greeting(hour)} />
        ) : (
          <section className="x-today__pane x-today__empty">
            <p className="x-eyebrow">{greeting(hour)}</p>
            <h1 className="x-display x-today__emptyTitle">Nothing to recommend yet.</h1>
            <p className="x-today__honest">
              Record some study and this surface will have something to say.
            </p>
          </section>
        )}

        {rest.length > 0 && (
          /* One pane holding rows, rather than one card per row: the queue is a list to be skipped
             past, and N separate slabs each demand to be read as an object. */
          <section className="x-today__pane x-today__queuePane" aria-labelledby="today-queue">
            <div className="x-today__paneHead">
              <p className="x-eyebrow" id="today-queue">Then, in order</p>
              <span className="x-today__paneCount x-mono">{rest.length}</span>
            </div>
            {/* The ranking rationale moved down here with the ranked list it describes, rather than
                sitting under the greeting where it explained nothing yet. */}
            <p className="x-today__queueNote">
              Ranked by what costs you most to leave alone — not by what is weakest.
            </p>
            <ul className="x-today__queue">
              {rest.map(m => <QueueRow key={m.id} move={m} onStart={start} />)}
            </ul>
          </section>
        )}

        <footer className="x-today__pane x-today__foot">
          {unknown > 0 ? (
            <p className="x-today__honest">
              {unknown} of {moves.length} subjects have too little evidence to estimate. That is fog,
              not failure — the model will not guess at what it has not seen.
            </p>
          ) : (
            <p className="x-today__honest">
              Every subject has enough evidence for an estimate.
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}
