/**
 * The companion, rendered as a *token*.
 *
 * The concept is a board game, and the companion is the piece you move around it. So it is a carved
 * token on a weighted base — not a humanoid. That is a deliberate call: a small stylized human at
 * 200 px on a transparent always-on-top window lands in the uncanny valley every time, while a token
 * reads instantly, scales down without falling apart, and matches the board it lives on.
 *
 * Everything here is procedural and deterministic. No GLB, no textures, no random — the token looks
 * identical on every launch, and there is nothing to fail to load. When authored rig clips land, this
 * stays as the fallback that guarantees the companion is never a missing-asset hole.
 *
 * Motion is the whole product here. The arbiter (tested, 24 cases) decides *what*; this decides how
 * that reads as a body: breath in the vertical axis, attention in the lean, weight in the base.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { damp } from '../motion/bezier';
import { WORLD_PALETTE, type Theme } from '../world/districtMaterial';
import type { ClipName } from './behavior';

/** Per-clip body intent. This is the bridge from "which animation" to "what the body does." */
interface Intent {
  /** Breaths per minute. Real resting is 12–16; focus slows it, celebration lifts it. */
  breathBpm: number;
  /** Vertical breath amplitude, world units. */
  breathAmp: number;
  /** Forward lean in radians. Positive leans toward the user — attention. */
  lean: number;
  /** Side-to-side sway amplitude, radians. */
  swayAmp: number;
  /** Sway speed multiplier. */
  swayRate: number;
  /** Base spin rate, rad/s. Slow drift reads as idle; faster reads as searching. */
  spin: number;
  /** Halo intensity 0..1 — the companion's only light. Presence, not decoration. */
  glow: number;
  /** A single vertical hop, in world units. 0 for everything that isn't a beat. */
  hop: number;
}

const REST: Intent = {
  breathBpm: 13, breathAmp: 0.035, lean: 0, swayAmp: 0.018, swayRate: 0.42,
  spin: 0.05, glow: 0.22, hop: 0,
};

/**
 * Clip → body intent, keyed on the real `ClipName` union — all 11, no invented names, so adding a
 * clip to the union is a type error here until it is given a body. A token has no hands, so the
 * mapping is honest about what it can express: rate, lean, sway, turn, light, and one hop.
 */
const INTENT: Record<ClipName, Partial<Intent>> = {
  // Rest. Explicitly empty — REST already is this, and stating it keeps the record exhaustive.
  'idle.breathe':        {},
  'idle.lookAround':     { spin: 0.55, swayAmp: 0.05, swayRate: 0.9, lean: 0.04, glow: 0.26 },

  // Explaining: leans in, quickens slightly, turns as if addressing you. The lean is what carries
  // "talking to you" on a body with no face.
  'study.explain':       { breathBpm: 15, lean: 0.11, swayAmp: 0.04, swayRate: 1.3, spin: 0.2, glow: 0.34 },
  // Reading while moving: brisk sway, but the lean stays low — attention is on the page, not on you.
  'study.walkReading':   { breathBpm: 16, swayAmp: 0.07, swayRate: 1.7, spin: 0.1, lean: 0.02 },

  'celebrate.small':     { breathBpm: 18, glow: 0.5, hop: 0.1, lean: 0.08 },
  'celebrate.milestone': { breathBpm: 20, glow: 0.66, hop: 0.2, spin: 1.2 },
  'celebrate.rare':      { breathBpm: 22, glow: 0.85, hop: 0.32, spin: 2.0 },

  // Gaits. Sway rate roughly doubles per step up, and the lean grows with speed, because leaning
  // into travel is what makes locomotion read as effort instead of gliding.
  'locomote.stroll':     { breathBpm: 14, swayAmp: 0.06, swayRate: 1.3, lean: 0.03 },
  'locomote.walk':       { breathBpm: 17, swayAmp: 0.09, swayRate: 2.0, lean: 0.06 },
  'locomote.jog':        { breathBpm: 22, swayAmp: 0.11, swayRate: 3.0, lean: 0.12 },
  'locomote.run':        { breathBpm: 28, swayAmp: 0.13, swayRate: 4.2, lean: 0.2 },
};

function intentFor(clip: ClipName): Intent {
  return { ...REST, ...INTENT[clip] };
}

export interface TokenProps {
  clip: ClipName;
  theme: Theme;
  /** True once the arbiter's noticing delay has elapsed. Before that, the token holds still. */
  playing: boolean;
  /** 0..1 — how strongly the token is attending. Drives glow and lean on top of the clip. */
  attention?: number;
  scale?: number;
}

export function Token({ clip, theme, playing, attention = 0, scale = 1 }: TokenProps) {
  const p = WORLD_PALETTE[theme];

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);

  // Smoothed intent. Every field damps toward its target, so a clip change is a transition of the
  // *body* rather than a cut. This is the difference between an animated character and a state
  // machine that swaps poses.
  const cur = useRef<Intent>({ ...REST });
  const phase = useRef({ breath: 0, sway: 0, spin: 0, hop: 1 });
  const lastClip = useRef<ClipName>(clip);

  /**
   * The body is a lathe: one profile curve revolved. A lathe gives a carved, turned-on-a-machine
   * silhouette in ~30 vertices, which is exactly the "voxel-to-semi-stylized" middle the board sits
   * in — and unlike a sphere or a capsule, it doesn't read as a primitive.
   */
  const bodyGeom = useMemo(() => {
    const profile: THREE.Vector2[] = [];
    // Foot flare, waist pinch, shoulder, crown. Hand-placed, not sampled from a formula, because a
    // formula-generated profile always reads as a vase.
    const pts: Array<[number, number]> = [
      [0.00, 0.00], [0.34, 0.00], [0.36, 0.05], [0.30, 0.10],
      [0.22, 0.16], [0.19, 0.28], [0.21, 0.44], [0.26, 0.60],
      [0.28, 0.74], [0.25, 0.86], [0.17, 0.95], [0.08, 1.00],
      [0.00, 1.02],
    ];
    for (const [x, y] of pts) profile.push(new THREE.Vector2(x, y));
    // 14 segments: faceted enough to catch light per-facet, smooth enough to read as turned.
    return new THREE.LatheGeometry(profile, 14);
  }, []);

  const baseGeom = useMemo(() => new THREE.CylinderGeometry(0.42, 0.46, 0.07, 24), []);
  const haloGeom = useMemo(() => new THREE.RingGeometry(0.5, 0.78, 40), []);

  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({
    // Eosin is reserved, by the design system, for companion presence and nothing else. This is the
    // only object in the entire product allowed to use it.
    color: new THREE.Color(p.eosin),
    roughness: 0.42,
    metalness: 0.06,
    emissive: new THREE.Color(p.eosin),
    emissiveIntensity: 0.06,
    flatShading: true,
  }), [p.eosin]);

  const baseMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(p.hema),
    roughness: 0.55,
    metalness: 0.1,
    flatShading: true,
  }), [p.hema]);

  const haloMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(p.eosin),
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  }), [p.eosin]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);       // clamp: a tab-switch hitch must not teleport the body
    const dtMs = dt * 1000;
    const target = intentFor(clip);

    // A new clip that carries a hop fires it once, on the transition — not every frame it is active.
    if (clip !== lastClip.current) {
      if (target.hop > 0 && playing) phase.current.hop = 0;
      lastClip.current = clip;
    }

    const c = cur.current;
    // 0.001 = ~99.9% of the way in one second: fast enough to feel responsive, slow enough that the
    // body visibly transitions rather than snapping.
    c.breathBpm = damp(c.breathBpm, playing ? target.breathBpm : REST.breathBpm, 0.001, dtMs);
    c.breathAmp = damp(c.breathAmp, playing ? target.breathAmp : REST.breathAmp, 0.001, dtMs);
    c.lean      = damp(c.lean, (playing ? target.lean : 0) + attention * 0.1, 0.0006, dtMs);
    c.swayAmp   = damp(c.swayAmp, playing ? target.swayAmp : REST.swayAmp, 0.001, dtMs);
    c.swayRate  = damp(c.swayRate, playing ? target.swayRate : REST.swayRate, 0.002, dtMs);
    c.spin      = damp(c.spin, playing ? target.spin : REST.spin, 0.002, dtMs);
    c.glow      = damp(c.glow, Math.min(1, (playing ? target.glow : REST.glow) + attention * 0.25), 0.001, dtMs);

    // Phases advance on their own clocks so changing breath rate never causes a jump — advancing a
    // phase is continuous, whereas computing `sin(t * rate)` from absolute time is not.
    phase.current.breath += dt * (c.breathBpm / 60) * Math.PI * 2;
    phase.current.sway   += dt * c.swayRate;
    phase.current.spin   += dt * c.spin;

    // Hop: one arc, then done. Gravity-shaped rather than sinusoidal, because a sine hop reads as
    // floating and an arc reads as a push off the ground.
    let hopY = 0;
    if (phase.current.hop < 1) {
      phase.current.hop = Math.min(1, phase.current.hop + dt * 2.6);
      const h = phase.current.hop;
      hopY = 4 * h * (1 - h) * target.hop;   // parabola, peaks at h = 0.5
    }

    const breath = Math.sin(phase.current.breath);

    if (body.current) {
      // Breath is a squash-and-stretch on Y with a matching inverse on XZ, conserving volume.
      // Scaling Y alone reads as a bouncing object; conserving volume reads as a chest.
      const s = 1 + breath * c.breathAmp;
      body.current.scale.set(1 - breath * c.breathAmp * 0.42, s, 1 - breath * c.breathAmp * 0.42);
      body.current.position.y = 0.07 + hopY;
      body.current.rotation.x = c.lean;
      body.current.rotation.z = Math.sin(phase.current.sway) * c.swayAmp;
      body.current.rotation.y = phase.current.spin;
    }

    if (halo.current) {
      const m = halo.current.material as THREE.MeshBasicMaterial;
      // Halo pulses on the breath, at a quarter of the amplitude — light follows the body, subtly.
      m.opacity = c.glow * (0.5 + breath * 0.08);
      halo.current.scale.setScalar(1 + breath * 0.02);
    }

    if (root.current) {
      // A very slow figure-eight drift so the token is never perfectly static, even at rest. Nothing
      // alive holds a position to the pixel.
      const t = state.clock.elapsedTime;
      root.current.position.x = Math.sin(t * 0.11) * 0.02;
      root.current.position.z = Math.sin(t * 0.17) * 0.015;
    }
  });

  return (
    <group ref={root} scale={scale}>
      {/* Halo, flat on the ground. The token's presence, and the only light it emits. */}
      <mesh
        ref={halo}
        geometry={haloGeom}
        material={haloMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.008, 0]}
        renderOrder={1}
      />

      {/* Weighted base. Reads as a game piece and gives the breath something to push against. */}
      <mesh geometry={baseGeom} material={baseMat} position={[0, 0.035, 0]} castShadow receiveShadow />

      <group ref={body}>
        <mesh geometry={bodyGeom} material={bodyMat} castShadow receiveShadow />
      </group>

      {/* Eosin fill light, close and weak. Makes the token read as lit from within rather than
          pasted onto the scene — and it is the reason it still reads on a transparent window over a
          bright desktop. */}
      <pointLight position={[0, 0.7, 0.4]} intensity={0.5} distance={3} color={p.eosin} />
    </group>
  );
}
