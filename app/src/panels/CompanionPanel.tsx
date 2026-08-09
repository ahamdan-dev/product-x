/**
 * The companion picker, hosted in a floating panel.
 *
 * `Picker` is finished and untouched. It needs a host for one reason that is easy to miss: it mounts
 * two live r3f `Canvas` elements to preview the GLBs, and a WebGL context is not free. Behind `lazy()`
 * in `panelComponents.ts`, that cost is paid the first time a user opens this panel and never by
 * anyone who does not.
 *
 * `glass={false}`. This is the one panel of the six that must not be frosted: a `backdrop-filter`
 * ancestor forces the whole subtree onto its own composited layer, and the two WebGL canvases inside
 * are exactly the content that gets blurred into mush by it. A solid surface behind a 3D preview is
 * also simply correct — you want to judge the model, not the desktop behind it.
 */

import { Surface } from '../ui/Surface';
import { Picker } from '../companion/Picker';
import './panels.css';

export interface CompanionPanelProps {
  id: string;
}

export default function CompanionPanel({ id }: CompanionPanelProps) {
  return (
    <Surface id={id} title="Companion" eyebrow="Who you study with" glass={false}>
      <div className="x-companion-panel">
        <Picker />
      </div>
    </Surface>
  );
}
