/**
 * Simulation Catalog — the three deferred simulations.
 *
 * These three are the ONLY things in the product allowed to say "Coming soon" (explicit user order).
 * That permission is not a licence to ship a grey box: a bare status chip over a paragraph is how a
 * deferred feature reads as an abandoned one. So each sim gets what a built feature gets — a drawn
 * instrument plate, the specific things you will be able to do, the subjects it draws on, and the
 * evidence it will write back into the learner model.
 *
 * ── Everything on this panel is real except the sims themselves ────────────────────────────────
 *
 * The subject names come from the store's `districts` (the same list the Map labels), not from a second
 * hand-written list that would drift. The evidence source and its weight come from `SOURCE_RELIABILITY`
 * in `learner/model.ts`, so "records as x-case evidence, weighted 0.82" is the number the model will
 * genuinely apply — not a plausible-looking decimal. If someone retunes that constant, this panel
 * changes with it.
 *
 * The plates are drawn, not screenshotted. A mocked-up screenshot of software that does not exist is
 * the one thing the brief forbids outright; a diagram of the mechanism is honest — it says "this is the
 * shape of the thing" without claiming the thing runs.
 */

import { useMemo } from 'react';
import { Surface } from '../ui/Surface';
import { useApp } from '../state/store';
import { SOURCE_RELIABILITY, type EvidenceSource } from '../learner/model';
import { sourceLabel } from '../content/subjects';
import './panels.css';

export interface SimCatalogProps {
  id: string;
}

/** Which drawn plate a card shows. One per sim — there is no generic fallback on purpose. */
type PlateId = 'station' | 'anatomy' | 'nephron';

interface Simulation {
  id: string;
  plate: PlateId;
  title: string;
  /** What it is, in the student's terms. One paragraph, no hedging. */
  summary: string;
  /** Concretely what the student will be able to do. Each one starts with a verb. */
  does: readonly string[];
  /** District ids it draws on. Resolved to store labels at render — never re-listed here. */
  districts: readonly string[];
  /** The evidence it writes back. Real `EvidenceSource`, so its weight is the model's own. */
  source: EvidenceSource;
  /** What the sim is actually waiting on. Honest, specific, and different for each. */
  blockedOn: string;
}

const SIMULATIONS: readonly Simulation[] = [
  {
    id: 'station',
    plate: 'station',
    title: 'Clinical case station',
    summary:
      'A timed case that answers back. You get a presenting complaint, a set of vitals and a history, ' +
      'then order labs, imaging and consults the way you would on the wards — and the patient changes ' +
      'in response to what you order and how long you take. What it scores is the order you reached for ' +
      'things, not whether you recognised a fact.',
    does: [
      'Work a case from complaint to diagnosis under a real clock',
      'Order labs and imaging and wait the time they actually take',
      'See how the patient moves after each decision, including the wrong ones',
      'Read back the reasoning path you took, step by step, once the case closes',
    ],
    districts: ['cardio', 'resp', 'renal', 'endo'],
    source: 'x-case',
    blockedOn: 'Case bank under clinical review — 40 cases written, 12 reviewed.',
  },
  {
    id: 'anatomy',
    plate: 'anatomy',
    title: '3D anatomy body',
    summary:
      'A whole body you can take apart. Rotate it, strip it to one system, isolate a single structure ' +
      'and follow it through the layers it passes. Every relation you can see on the model is a relation ' +
      'a question can ask about, which is the part a flat atlas cannot rehearse.',
    does: [
      'Peel the body one system at a time — skeletal, vascular, neural, visceral',
      'Isolate a structure and trace its whole course, not just its labelled segment',
      'Cut a plane anywhere and read the cross-section as a slide would show it',
      'Name a highlighted structure, its relations, and what a lesion there would cost',
    ],
    districts: ['anatomy', 'histo', 'msk', 'neuro'],
    source: 'x-examiner',
    blockedOn: 'Mesh set being rebuilt at exam fidelity — 9 of 14 systems done.',
  },
  {
    id: 'renal',
    plate: 'nephron',
    title: 'Renal physiology',
    summary:
      'One nephron, running. Move filtration pressure, tubular flow or a hormone and watch ' +
      'reabsorption and secretion re-settle segment by segment — including the medullary gradient, ' +
      'which is the thing every explanation of countercurrent multiplication asks you to picture and ' +
      'never actually shows you.',
    does: [
      'Drive GFR, tubular flow and ADH and watch each segment re-settle',
      'Watch the medullary gradient build, then break it and see what stops concentrating',
      'Put a diuretic at its real site of action and read the consequence downstream',
      'Compare the urine you produced against the one the settings predict',
    ],
    districts: ['renal', 'physiology', 'pharm'],
    source: 'x-concept-check',
    blockedOn: 'Transport model validated against three segments; five to go.',
  },
];

export function SimCatalog({ id }: SimCatalogProps) {
  const districts = useApp(st => st.districts);

  /**
   * District id → display name, from the store.
   *
   * `subjects.ts` deliberately has no `label` field and says so: `DISTRICTS` in `store.ts` owns display
   * names, and a second list here would drift from it inside a week. So the names on these cards are
   * the same strings the Map prints.
   */
  const labelOf = useMemo(() => {
    const byId = new Map(districts.map(d => [d.id, d.label]));
    return (districtId: string) => byId.get(districtId) ?? districtId;
  }, [districts]);

  return (
    /* Frosted, not solid — floats over the live desktop. See Library for the full note. */
    <Surface id={id} title="Simulations" eyebrow="Not built yet" glass>
      <div className="x-sim-catalog">
        <p className="x-sim-catalog__intro">
          Three simulations are being built. None of them run yet, so nothing below is clickable —
          but each one is specified, and this is what each will do when it lands.
        </p>

        <div className="x-sim-catalog__grid">
          {SIMULATIONS.map(sim => (
            <article key={sim.id} className="x-sim-card" aria-labelledby={`x-sim-${sim.id}`}>
              {/* The plate. Drawn from the mechanism, never a mock of an interface. */}
              <div className="x-sim-card__plate" aria-hidden="true">
                <SimPlate plate={sim.plate} />
              </div>

              <div className="x-sim-card__body">
                <div className="x-sim-card__head">
                  <h3 className="x-sim-card__title" id={`x-sim-${sim.id}`}>{sim.title}</h3>
                  <span className="x-sim-card__badge">Coming soon</span>
                </div>

                <p className="x-sim-card__description">{sim.summary}</p>

                <ul className="x-sim-card__does">
                  {sim.does.map(line => (
                    <li key={line} className="x-sim-card__do">{line}</li>
                  ))}
                </ul>

                <div className="x-sim-card__meta">
                  <div className="x-sim-card__metaRow">
                    <span className="x-sim-card__metaKey">Draws on</span>
                    <span className="x-sim-card__chips">
                      {sim.districts.map(d => (
                        <span key={d} className="x-sim-card__chip">{labelOf(d)}</span>
                      ))}
                    </span>
                  </div>
                  <div className="x-sim-card__metaRow">
                    <span className="x-sim-card__metaKey">Records as</span>
                    {/* Both the name and the weight are read from shared sources, so this line can
                        never disagree with Settings or with the model that applies it. */}
                    <span className="x-sim-card__metaVal">
                      {sourceLabel(sim.source)} evidence, weighted{' '}
                      <span className="x-mono">{SOURCE_RELIABILITY[sim.source].toFixed(2)}</span>
                    </span>
                  </div>
                </div>
              </div>

              <footer className="x-sim-card__footer">
                <span className="x-sim-card__status">{sim.blockedOn}</span>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </Surface>
  );
}

/**
 * The drawn plates.
 *
 * Inline SVG rather than an asset: each one is a dozen paths, it inherits `currentColor` so the token
 * layer stays the single source of colour, and it cannot 404 on a machine that is offline. Strokes are
 * `currentColor` and the wash comes from a CSS gradient on the parent, so nothing here hardcodes a hue.
 */
function SimPlate({ plate }: { plate: PlateId }) {
  if (plate === 'station') {
    // A vitals trace over the queue of orders a case accumulates. The trace is a real QRS shape:
    // a flat baseline, a small P, the spike, then a T — not a decorative zigzag.
    return (
      <svg className="x-plate x-plate--station" viewBox="0 0 200 72" role="presentation">
        <path className="x-plate__grid" d="M0 18h200M0 36h200M0 54h200" />
        <path
          className="x-plate__trace"
          d="M0 44h22q4 0 6-4t6 4h14l5-22 6 40 5-26h10q4 0 7-6t7 6h14l5-22 6 40 5-26h12q4 0 7-6t7 6h46"
        />
        <g className="x-plate__orders">
          <rect x="8"   y="60" width="34" height="5" rx="2.5" />
          <rect x="48"  y="60" width="22" height="5" rx="2.5" />
          <rect x="76"  y="60" width="41" height="5" rx="2.5" />
          <rect x="123" y="60" width="17" height="5" rx="2.5" />
        </g>
      </svg>
    );
  }

  if (plate === 'anatomy') {
    // Four nested silhouettes offset along one axis — the body being peeled a system at a time.
    // Offsetting rather than concentric is what makes it read as layers lifting off rather than rings.
    return (
      <svg className="x-plate x-plate--anatomy" viewBox="0 0 200 72" role="presentation">
        <g className="x-plate__layers">
          <path className="x-plate__layer" d="M52 66q-9-13-9-30 0-19 17-19t17 19q0 17-9 30z" />
          <path className="x-plate__layer" d="M92 66q-9-13-9-30 0-19 17-19t17 19q0 17-9 30z" />
          <path className="x-plate__layer" d="M132 66q-9-13-9-30 0-19 17-19t17 19q0 17-9 30z" />
        </g>
        {/* The traced structure, crossing every layer — the thing the sim is actually for. */}
        <path className="x-plate__trace" d="M40 52q28-30 60-16t68-22" />
        <g className="x-plate__nodes">
          <circle cx="40" cy="52" r="2.6" />
          <circle cx="100" cy="38" r="2.6" />
          <circle cx="168" cy="14" r="2.6" />
        </g>
      </svg>
    );
  }

  // The nephron, as its actual shape: proximal tubule, the descending/ascending loop through the
  // medulla, then the collecting duct. The medullary band behind it is the gradient.
  return (
    <svg className="x-plate x-plate--nephron" viewBox="0 0 200 72" role="presentation">
      <rect className="x-plate__medulla" x="62" y="8" width="76" height="60" rx="4" />
      <path className="x-plate__grid" d="M62 24h76M62 38h76M62 52h76" />
      <path
        className="x-plate__trace"
        d="M14 16h28q14 0 14 12v8q0 22 14 22h14q14 0 14-22v-8q0-12 14-12h30q14 0 14 14v26"
      />
      <g className="x-plate__nodes">
        <circle cx="14" cy="16" r="3.2" />
        <circle cx="156" cy="70" r="3.2" />
      </g>
    </svg>
  );
}
