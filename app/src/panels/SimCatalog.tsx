/**
 * Simulation Catalog — the three simulations are NOT built yet and must say so honestly.
 *
 * Each as a premium card with a real one-paragraph description of what it will do,
 * plus a clear "Coming soon" state. Do NOT mock up fake functionality or fake screenshots.
 * Make the honesty look intentional and premium, not broken.
 */

import { Surface } from '../ui/Surface';
import './panels.css';

export interface SimCatalogProps {
  id: string;
}

interface Simulation {
  id: string;
  title: string;
  description: string;
}

const SIMULATIONS: Simulation[] = [
  {
    id: 'station',
    title: 'Clinical case station',
    description:
      "A timed, proctored clinical case simulation. You'll see a presenting complaint, vital signs, and a history. Order labs, imaging, and consults as you would on the wards, and the simulation responds in real time with results and clinical changes. Your diagnostic reasoning is the evidence, not whether you remembered a fact list.",
  },
  {
    id: 'anatomy',
    title: '3D anatomy body',
    description:
      "An interactive 3D model of human anatomy. Rotate, isolate, and explore structures layer by layer — skeletal, vascular, neural, visceral. Quiz mode will highlight a structure and ask you to name it, trace its course, or identify its relations. This is the spatial reasoning exam prep you can't get from a 2D atlas.",
  },
  {
    id: 'renal',
    title: 'Renal physiology',
    description:
      'A real-time simulation of the nephron. Adjust GFR, tubular flow, and hormone levels, then watch filtration, reabsorption, and secretion respond as they would in vivo. This is the model you wish existed when you were learning countercurrent multiplication — it makes the invisible visible.',
  },
];

export function SimCatalog({ id }: SimCatalogProps) {
  return (
    /* Frosted, not solid — floats over the live desktop. See Library for the full note. */
    <Surface id={id} title="Simulations" eyebrow="In development" glass>
      <div className="x-sim-catalog">
        <p className="x-sim-catalog__intro">
          Three high-fidelity simulations are in development. Each will be released as it clears
          clinical review and user testing. No placeholders, no fake screenshots — when they're
          ready, they'll appear here.
        </p>

        <div className="x-sim-catalog__grid">
          {SIMULATIONS.map(sim => (
            <div key={sim.id} className="x-sim-card">
              <div className="x-sim-card__body">
                <h3 className="x-sim-card__title">{sim.title}</h3>
                <p className="x-sim-card__description">{sim.description}</p>
              </div>
              <div className="x-sim-card__footer">
                <span className="x-sim-card__status">Coming soon</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Surface>
  );
}
