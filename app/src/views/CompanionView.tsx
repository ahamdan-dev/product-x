/**
 * The companion window. Transparent, frameless, always on top, and directly interactive.
 *
 * Controls follow the user's rule exactly: consistent position, hidden at rest, revealed on hover,
 * always offering both minimize and close. On a window with no OS chrome, that is not polish — it is
 * the only way out.
 */

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { CompanionLighting, CompanionRig } from '../companion/Picker';
import {
  COMPANION_CHARACTER_KEY,
  readCharacterPreference,
} from '../companion/preference';
import { resolveAssetUrl } from '../companion/glbSource';
import { BehaviorArbiter } from '../companion/arbiter';
import type { ClipName } from '../companion/behavior';
import { useApp } from '../state/store';
import './companionView.css';

/** Every clip the procedural token can express — which is all of them, since none are assets. */
const ALL_CLIPS: ReadonlySet<ClipName> = new Set<ClipName>([
  'idle.breathe', 'idle.lookAround',
  'locomote.stroll', 'locomote.walk', 'locomote.jog', 'locomote.run',
  'study.walkReading', 'study.explain',
  'celebrate.small', 'celebrate.milestone', 'celebrate.rare',
]);

/** The Electron bridge. Absent in a plain browser, so every call is guarded. */
type Px = {
  moveCompanionBy: (dx: number, dy: number) => Promise<void>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  openWorld: () => Promise<void>;
};
function px(): Px | null {
  return (window as unknown as { px?: Px }).px ?? null;
}

export function CompanionView() {
  const mode = useApp(s => s.mode);
  const character = useApp(s => s.character);
  const setCharacter = useApp(s => s.setCharacter);

  const arbiter = useRef<BehaviorArbiter | null>(null);
  if (!arbiter.current) {
    arbiter.current = new BehaviorArbiter({ availableClips: ALL_CLIPS });
  }

  const [clip, setClip] = useState<ClipName>('idle.breathe');
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);

  useEffect(() => { arbiter.current?.setMode(mode); }, [mode]);

  useEffect(() => {
    const syncCharacter = (event: StorageEvent) => {
      if (event.key === COMPANION_CHARACTER_KEY) setCharacter(readCharacterPreference());
    };
    window.addEventListener('storage', syncCharacter);
    return () => window.removeEventListener('storage', syncCharacter);
  }, [setCharacter]);

  // Session open is a real trigger and it should fire once, on mount — the companion arriving is the
  // first thing the student sees, and it must not look like a page load.
  useEffect(() => {
    arbiter.current?.fire('session.open');
  }, []);

  /**
   * The arbiter's clock. 100 ms, not per-frame: the arbiter deals in noticing delays and cooldowns
   * measured in hundreds of milliseconds, so polling it 60×/second would be 600× the necessary work
   * to reach the same decisions. The *body* still animates at full frame rate — that is in Token.
   */
  useEffect(() => {
    const t = window.setInterval(() => {
      const a = arbiter.current;
      if (!a) return;
      a.tick();
      const active = a.getActive();
      setClip(active.clip);
      setPlaying(a.isPlaying());
    }, 100);
    return () => window.clearInterval(t);
  }, []);

  const enter = useCallback(() => {
    setHovered(true);
  }, []);

  const leave = useCallback(() => {
    setHovered(false);
  }, []);

  const companionUrl = resolveAssetUrl(
    character === 'male' ? 'companions/companion-a.glb' : 'companions/companion-b.glb',
    document.baseURI,
  );

  // ── Dragging the window itself ──────────────────────────────────────────────
  // A frameless window has no title bar, so the token *is* the handle. Deltas go to the main process
  // because the renderer cannot move its own window.
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    dragging.current = true;
    last.current = { x: e.screenX, y: e.screenY };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.screenX - last.current.x;
    const dy = e.screenY - last.current.y;
    if (dx === 0 && dy === 0) return;
    last.current = { x: e.screenX, y: e.screenY };
    void px()?.moveCompanionBy(dx, dy);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="x-companion">
      <div
        className={`x-companion__stage ${hovered ? 'is-hovered' : ''}`}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Canvas
          className="x-companion__canvas"
          dpr={[1, 2]}                    /* small canvas — full DPR is cheap and the token is the
                                             one thing the user looks at closely */
          gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
          /**
           * The camera must AIM at the companion, not merely stand near it.
           *
           * A default r3f camera looks at the origin. The token's body runs from y = 0 to y ≈ 1.02, so
           * a camera at eye height aiming at the origin frames the *floor* — and a screenshot showed
           * exactly that: a macro shot of the pedestal with the character entirely above the frame.
           * Nothing in the code looked wrong, which is why it survived until someone looked at pixels.
           *
           * Aimed at y = 0.52, the body's midpoint, and pulled back to 3.6 so the full silhouette sits
           * inside the frame with headroom. The token is the one object a user studies closely, so it
           * gets the whole stage rather than a crop of it.
           */
          camera={{ fov: 30, near: 0.1, far: 20, position: [0, 0.88, 3.8] }}
          onCreated={({ gl, camera }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.16;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            // Fully transparent clear: any clear color at all becomes a visible rectangle on the
            // user's desktop.
            gl.setClearAlpha(0);
            camera.lookAt(0, 0.88, 0);
          }}
        >
          <CompanionLighting />
          <Suspense fallback={null}>
            <CompanionRig url={companionUrl} excited={hovered || !playing || clip.startsWith('celebrate.')} />
          </Suspense>
        </Canvas>

        {/* Controls. One consistent place — top-right of the stage — hidden until hover. */}
        <div className="x-companion__controls">
          <button
            type="button"
            className="x-cctl"
            title="Open the world"
            onClick={() => void px()?.openWorld()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5.6" />
              <path d="M2.4 8h11.2M8 2.4a9 9 0 0 1 0 11.2M8 2.4a9 9 0 0 0 0 11.2" />
            </svg>
          </button>
          <button
            type="button"
            className="x-cctl"
            title="Minimize"
            onClick={() => void px()?.minimize()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5h8" /></svg>
          </button>
          <button
            type="button"
            className="x-cctl x-cctl--close"
            title="Close"
            onClick={() => void px()?.close()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
