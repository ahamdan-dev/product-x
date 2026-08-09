/**
 * The world window.
 *
 * Canvas settings worth defending:
 *   - `dpr={[1, 1.75]}` — capped, not uncapped. On a 4K laptop panel an uncapped DPR renders ~8M
 *     pixels of a scene whose silhouette is chunky by design; the visual gain is nil and the frame
 *     cost is enormous. This is the single biggest lever for the "runs well on a light machine"
 *     requirement.
 *   - `powerPreference: 'high-performance'` — on a hybrid-GPU laptop, Chromium otherwise picks the
 *     integrated GPU and the scene stutters for no visible reason.
 *   - ACESFilmic tone mapping. Linear tone mapping is what makes the lit faces of a light-colored
 *     scene clip to flat white; ACES rolls the highlight off and is why the massing keeps its form.
 *   - `frameloop="demand"` is deliberately NOT used: the fog line drifts continuously, so an
 *     on-demand loop would freeze the one thing that is always alive.
 */

import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { World } from '../world/World';
import { WorldChrome } from '../ui/WorldChrome';
import { useTheme } from '../ui/useTheme';
import { FOV_DEG } from '../world/camera';

export function WorldView() {
  const { theme, preference, cycle } = useTheme();
  const [handsEnabled, setHandsEnabled] = useState(false);

  return (
    <div className="x-world">
      <Canvas
        className="x-world__canvas"
        /**
         * The click-through rule (see shell/passthrough.ts) decides ownership from what an element
         * paints, which a WebGL canvas does in its drawing buffer rather than in CSS. Its computed
         * background is `rgba(0,0,0,0)`, so without this marker the Map — the largest interactive
         * surface in the app — would read as empty desktop and every click on the board would fall
         * through to whatever is behind the window.
         */
        data-x-interactive=""
        dpr={[1, 1.75]}
        shadows="soft"
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          /**
           * `alpha: true`, and it is load-bearing rather than incidental. This is an always-on-top
           * overlay: the window is transparent so the board floats over whatever the student is
           * actually reading. An opaque drawing buffer here would punch a solid rectangle through that
           * transparency in the exact region the Map occupies — the largest surface in the app — which
           * is the "obscures the user's screen" failure the overlay exists to avoid.
           */
          alpha: true,
          premultipliedAlpha: false,   // matches how Chromium composites the transparent window
          stencil: false,              // nothing here needs a stencil buffer
          depth: true,
        }}
        camera={{ fov: FOV_DEG, near: 0.5, far: 220, position: [26, 24, 26] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.16;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          // Clear to fully transparent. `alpha: true` only makes transparency *possible*; without a
          // zero-alpha clear color three.js still clears to opaque black.
          gl.setClearColor(0x000000, 0);
          gl.setClearAlpha(0);
        }}
      >
        <Suspense fallback={null}>
          <World theme={theme} />
        </Suspense>
      </Canvas>

      <WorldChrome
        themePreference={preference}
        onCycleTheme={cycle}
        handsEnabled={handsEnabled}
        onToggleHands={() => setHandsEnabled(v => !v)}
      />
    </div>
  );
}
