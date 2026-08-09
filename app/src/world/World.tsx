/**
 * The world scene. Board perimeter + 21 districts + the ground they sit on.
 *
 * Lighting is three lights and no more: a soft hemisphere for ambient fill, one angled key with a
 * tight shadow map, and a low cool bounce. That is the whole rig. Piling on lights is the fastest way
 * to make a scene look muddy *and* run slow — the reason this reads as a physical model is the
 * material response and the long lens, not the light count.
 *
 * The ground is a plane, not a box, and it is not shiny. A reflective floor is the single most common
 * tell of a scene assembled from defaults.
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { District } from './District';
import { Board3D } from './Board3D';
import { useCameraRig } from './useCameraRig';
import { visibleDistricts } from './camera';
import { groundColor, WORLD_PALETTE, type Theme } from './districtMaterial';
import {
  useApp, readDistrict, slotPosition, slotRadius, type DistrictReading,
} from '../state/store';

/** How often to re-test which districts are on screen. */
const CULL_INTERVAL_MS = 120;

export interface WorldProps {
  theme: Theme;
}

export function World({ theme }: WorldProps) {
  const preset = useApp(s => s.preset);
  const framing = useApp(s => s.framing);
  const focusedDistrict = useApp(s => s.focusedDistrict);
  const focusDistrict = useApp(s => s.focusDistrict);
  const districts = useApp(s => s.districts);
  const concepts = useApp(s => s.concepts);
  const companionSpace = useApp(s => s.companionSpace);
  const setFraming = useApp(s => s.setFraming);

  // Where the camera should orbit. Focusing a district moves the orbit point to it; clearing focus
  // returns to board center. The rig owns the animation — this only states the destination.
  const focusTarget = useMemo(() => {
    if (!focusedDistrict) return null;
    const d = districts.find(x => x.id === focusedDistrict);
    if (!d) return null;
    const [x, , z] = slotPosition(d.slot);
    return { x, y: 0, z };
  }, [focusedDistrict, districts]);

  const { rig } = useCameraRig(preset, framing, focusTarget);

  /**
   * Readings are recomputed on a slow tick rather than per frame. Mastery decays continuously, but a
   * half-life is measured in days — sampling it 60 times a second would be pure waste, and it would
   * also make every district's material a new object every frame.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);

  const readings: DistrictReading[] = useMemo(
    () => districts.map(d => readDistrict(d, concepts, now)),
    [districts, concepts, now],
  );

  const placed = useMemo(
    () => readings.map(r => ({
      reading: r,
      position: slotPosition(r.slot),
      radius: slotRadius(r.slot),
    })),
    [readings],
  );

  // ── Culling ──────────────────────────────────────────────────────────────────
  // A Set of ids, updated on a timer. Recomputing the cone test every frame would cost more than
  // the tweens it saves; 120 ms is well inside the camera's 620 ms dolly, so a district is always
  // warm before it is on screen.
  const [visible, setVisible] = useState<Set<string>>(() => new Set(readings.map(r => r.id)));
  const cullClock = useRef(0);
  const { size } = useThree();

  useFrame((_, delta) => {
    cullClock.current += delta * 1000;
    if (cullClock.current < CULL_INTERVAL_MS) return;
    cullClock.current = 0;

    const pose = rig.pose();
    const aspect = size.width / Math.max(1, size.height);
    const keep = visibleDistricts(placed, pose, undefined, aspect);
    const ids = new Set(keep.map(k => k.reading.id));

    // Only re-render when membership actually changed — otherwise this setState runs 8×/second
    // forever and defeats its own purpose.
    if (ids.size !== visible.size || keep.some(k => !visible.has(k.reading.id))) {
      setVisible(ids);
    }
  });

  const p = WORLD_PALETTE[theme];

  /**
   * The ground is a SHADOW CATCHER, not a floor.
   *
   * It used to be a 140×140 opaque plane, which was correct for a normal window and fatal for this
   * one: the app is an always-on-top overlay on a transparent window, and a lit plane that large fills
   * every pixel of the viewport, so it would paint an opaque rectangle over the student's actual work.
   *
   * `ShadowMaterial` renders nothing except the shadows that land on it. So the board keeps the contact
   * shading that makes it read as a physical object sitting on a surface — the thing that stopped it
   * looking like floating CAD nubs — while everywhere a shadow does not fall stays genuinely
   * transparent and the desktop shows through. The alternative, deleting the plane, would have cost the
   * grounding; this keeps it and costs nothing.
   */
  const groundMat = useMemo(() => new THREE.ShadowMaterial({
    color: new THREE.Color(groundColor(theme)),
    // Soft: an overlay's shadow reads as the board's own contact shading, not as a dark tint over the
    // window behind it. Above ~0.2 it starts looking like a smudge on the user's screen.
    opacity: 0.16,
    transparent: true,
    depthWrite: false,
  }), [theme]);

  useEffect(() => () => { groundMat.dispose(); }, [groundMat]);

  return (
    <>
      {/* Fill. Warm key + cool fill — the FIX mandate. Sky color warm (not neutral), ground color
          cooler, so upward faces read as lit and downward faces show cool bounce. Premium, alive. */}
      <hemisphereLight
        args={[
          new THREE.Color('#FFF8F0'),   // warm sky, not neutral
          new THREE.Color(groundColor(theme)),
          1.62,                          // slightly brighter for warmth
        ]}
      />

      {/* The key. Warm angled light from Journey corner — casts diagonal shadows so massing reads as
          3D and perimeter stays readable. Shadow map deliberately small: soft, cheap, and districts
          are chunky enough that detail is wasted. This is the WARM KEY from the FIX. */}
      <directionalLight
        position={[-16, 26, 20]}        // slightly higher for softer shadows
        intensity={2.3}                  // stronger for premium look
        color={new THREE.Color('#FFF4E8')}   // warmer tone
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0012}
        shadow-radius={1.4}              // softer shadow edge, more premium
      />

      {/* Cool fill from opposite side — the COOL FILL from the FIX. Keeps shadow interiors from
          going dead, adds dimension. Using evStable color for subtle evidence-ramp tie-in. */}
      <directionalLight
        position={[18, 14, 18]}          // higher for better fill
        intensity={1.12}                  // stronger for more dimension
        color={new THREE.Color(p.evStable)}   // cool conviction hue
      />

      <ambientLight intensity={0.38} color="#FFFDF9" />
      <directionalLight position={[-8, 12, -22]} intensity={0.62} color="#FFFFFF" />

      {/* Ground. Sized generously past the board so the horizon never shows an edge at any framing. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        material={groundMat}
        receiveShadow
        onPointerMissed={() => focusDistrict(null)}
      >
        <planeGeometry args={[140, 140]} />
      </mesh>

      <Board3D
        theme={theme}
        companionSpace={companionSpace}
        onSelectSpace={() => { /* wired to the card contract in the action-card pass */ }}
      />

      {placed.map(({ reading, position, radius }) => (
        <District
          key={reading.id}
          reading={reading}
          position={position}
          radius={radius}
          theme={theme}
          active={visible.has(reading.id)}
          focused={focusedDistrict === reading.id}
          onSelect={(id) => {
            focusDistrict(id);
            // Selecting a district also tightens the framing one step. Two clicks to get from the
            // whole board to one building, and the same click always means the same thing.
            if (framing === 'board') setFraming('district');
          }}
        />
      ))}
    </>
  );
}
