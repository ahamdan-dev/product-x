/**
 * The companion picker, hosted in a floating panel.
 *
 * `Picker` is finished and untouched. It needs a host for one reason that is easy to miss: it mounts
 * two live r3f `Canvas` elements to preview the GLBs, and a WebGL context is not free. Behind `lazy()`
 * in `panelComponents.ts`, that cost is paid the first time a user opens this panel and never by
 * anyone who does not.
 *
 * ── Why this is frosted after all ─────────────────────────────────────────────────────────────
 *
 * This panel first shipped `glass={false}`, on the reasoning that a `backdrop-filter` ancestor would
 * blur the two WebGL canvases inside it. That reasoning was wrong: `backdrop-filter` filters what is
 * painted *behind* the element, not its descendants, so the canvases composite sharply on top of the
 * frost. The capture over a live desktop showed the actual cost of the mistake — the panel was a flat
 * white sheet, the one panel of the six that hid the student's screen completely.
 *
 * The distinction worth keeping is between the *frame* and the *stage*: the panel frame is glass, so the
 * desktop reads through it like every other panel, while each model preview keeps its own neutral opaque
 * backdrop (`.picker-preview`) — because you do judge a 3D model against a calm surface, not against
 * whatever happens to be on the desktop behind it.
 */

import { Surface } from '../ui/Surface';
import { Picker } from '../companion/Picker';
import './panels.css';

export interface CompanionPanelProps {
  id: string;
}

export default function CompanionPanel({ id }: CompanionPanelProps) {
  return (
    <Surface id={id} title="Companion" eyebrow="Who you study with" glass>
      <div className="x-companion-panel">
        <Picker />
      </div>
    </Surface>
  );
}
