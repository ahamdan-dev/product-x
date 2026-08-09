/**
 * The Map surface — the 3D board, hosted inside the shell.
 *
 * A thin adapter over the existing `WorldView` rather than a second copy of its Canvas setup. That
 * Canvas carries real, defended decisions (capped DPR, ACES tone mapping, high-performance GPU
 * preference, a continuous frameloop because the fog line always drifts); duplicating them here
 * would mean two places to keep in sync and one of them would drift.
 *
 * Default-exported because the shell imports it with `lazy()`, which needs a default.
 */

import { WorldView } from '../views/WorldView';

export default function MapSurface() {
  return <WorldView />;
}
