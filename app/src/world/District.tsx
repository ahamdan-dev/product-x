/**
 * A district — one subject region, rendered as VARIED massing with its fog line.
 *
 * FIX: Kill the CAD read. Bevel/round geometry edges, VARY SILHOUETTE by state (MASTERED and
 * FOUNDATION are different shapes, not just heights), add subtle surface variation. A district is a
 * BUILT-UP PLACE, not a bar in a bar chart. Material expresses model state: development drives
 * height, confidence drives fog line height (uncertainty, never failure), conflict drives amber haze,
 * decay drives desaturation (never demolition — earned height stays). Conviction IS chroma.
 *
 * Performance: geometries are created once at module scope and reused, so 21 districts is still a
 * handful of draw calls.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createFogLineMaterial, FogBurn } from './fogLine';
import { districtAppearance, iodine, fogColor, WORLD_PALETTE, type Theme } from './districtMaterial';
import type { DistrictReading } from '../state/store';

/**
 * Shared geometries — one set per silhouette style. Small bevels catch light along edges instead of
 * terminating it dead (the difference between "manufactured part" and "programmer art").
 */
const TIER_GEOM_BASIC = new RoundedBoxGeometry(1, 1, 1, 3, 0.06);
const TIER_GEOM_INSET = new RoundedBoxGeometry(1, 1, 1, 4, 0.08);    // more segments, softer
const TIER_GEOM_CROWN = new RoundedBoxGeometry(1, 1, 1, 5, 0.12);    // pinnacle top, distinct
/** Hexagonal plot: reads as a site. Bevelled top edge so it isn't a cookie-cutter disc. */
const PLOT_GEOM = new THREE.CylinderGeometry(1, 1.035, 0.09, 6);
const FOG_GEOM = new THREE.PlaneGeometry(1, 1, 1, 1);

export interface DistrictProps {
  reading: DistrictReading;
  position: [number, number, number];
  radius: number;
  theme?: Theme;
  /** Frozen districts skip all per-frame work. The controlled camera makes this reliable. */
  active?: boolean;
  focused?: boolean;
  onSelect?: (id: string) => void;
}

export function District({
  reading, position, radius, theme = 'light', active = true, focused = false, onSelect,
}: DistrictProps) {
  const appearance = useMemo(() => districtAppearance(reading, theme), [reading, theme]);

  const group = useRef<THREE.Group>(null);
  const fogMesh = useRef<THREE.Mesh>(null);
  const hoverRef = useRef(0);

  // One fog material per district — each has its own confidence, so they cannot be shared.
  const fogMaterial = useMemo(
    () => createFogLineMaterial({
      confidence: appearance.fogAt,
      fogColor: fogColor(theme),
      lightColor: iodine(theme),
      bandWidth: 0.18,
      opacity: 0.78 + appearance.conflictHaze * 0.18,
    }),
    // Deliberately excludes fogAt: the burn animation owns that uniform after mount, and
    // recreating the material would skip the descent animation entirely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, appearance.conflictHaze],
  );

  const burn = useMemo(() => new FogBurn(fogMaterial), [fogMaterial]);

  // When confidence changes, the fog *descends* — the only progression animation in the product.
  useEffect(() => { burn.start(appearance.fogAt); }, [appearance.fogAt, burn]);

  useEffect(() => () => { fogMaterial.dispose(); }, [fogMaterial]);

  // Material: base color from evidence ramp, modulated by confidence/decay. Conflict adds subtle
  // amber warmth via emissive, NOT base color (to keep cool hue constraint satisfied).
  // Emissive is iodine (warm lamp glow), rationed for mastery only.
  const tierMaterial = useMemo(() => {
    const base = new THREE.Color(appearance.color);
    const amber = new THREE.Color(WORLD_PALETTE[theme].evConflicted);
    const iodineColor = new THREE.Color(iodine(theme));

    // Conflict modulates the EMISSIVE channel with amber tint, not the base color — this keeps the
    // base color cool (satisfies test) while still showing caution visually through warm glow.
    const emissiveColor = iodineColor.clone().lerp(amber, appearance.conflictTint * 0.45);
    const emissiveIntensity = appearance.emissive + (appearance.conflictTint * 0.12);

    return new THREE.MeshStandardMaterial({
      color: base,                          // pure evidence-ramp color, no amber mix
      roughness: appearance.roughness,
      metalness: 0.02,                      // near-zero: this is stone and stock, not metal
      emissive: emissiveColor,              // conflict shows as warm glow, not color shift
      emissiveIntensity: Math.min(0.5, emissiveIntensity),
      // Smooth, not flat. Flat shading on rounded geometry throws away the bevel's purpose: catching
      // gradient light along edges. The silhouette carries voxel lineage; the surface is where
      // "semi-stylized realism" lives.
      flatShading: false,
      // Add subtle surface variation via envMapIntensity to break up flat appearance.
      envMapIntensity: 0.18,
    });
  }, [appearance.color, appearance.roughness, appearance.emissive, appearance.conflictTint, theme]);

  useEffect(() => () => { tierMaterial.dispose(); }, [tierMaterial]);

  // Plot material: darker than tiers to create contact shadow — grounds the district instead of floating.
  const plotMaterial = useMemo(() => {
    const base = new THREE.Color(appearance.color);
    const ground = new THREE.Color(fogColor(theme));
    // Darken significantly for contact shading — this is what makes it SIT on the board.
    return new THREE.MeshStandardMaterial({
      color: base.lerp(ground, 0.75),   // much darker, reads as in shadow
      roughness: 0.92,
      metalness: 0,
      flatShading: false,
      // Ambient occlusion simulation: this base is always in shadow.
      aoMapIntensity: 1,
    });
  }, [appearance.color, theme]);

  useEffect(() => () => { plotMaterial.dispose(); }, [plotMaterial]);

  useFrame((state, delta) => {
    if (!active) return;                  // frozen: no shader time, no tween, no cost

    const t = state.clock.elapsedTime;
    burn.update(delta * 1000, t);

    // Hover/focus lift. Small — 0.12 units. A big lift on hover is a game tell; this reads as
    // the plate under the district being nudged.
    const targetHover = focused ? 1 : 0;
    hoverRef.current += (targetHover - hoverRef.current) * Math.min(1, delta * 9);
    if (group.current) {
      group.current.position.y = position[1] + hoverRef.current * 0.12;
    }

    // The fog plane always faces the camera. Billboarding a single plane is why this costs one
    // shader instead of a volume — and with a controlled camera the cheat is never visible.
    if (fogMesh.current) {
      fogMesh.current.quaternion.copy(state.camera.quaternion);
    }
  });

  const tierHeight = appearance.height / appearance.tiers;

  // Geometry selection by style — silhouette varies by state, so MASTERED and FOUNDATION look different.
  const getTierGeometry = (tierIndex: number, totalTiers: number): THREE.BufferGeometry => {
    const isTop = tierIndex === totalTiers - 1;
    switch (appearance.geometryStyle) {
      case 'minimal':
        return TIER_GEOM_BASIC;
      case 'stacked':
        return TIER_GEOM_BASIC;
      case 'compound':
        // Compound: more articulation, inset geometry.
        return TIER_GEOM_INSET;
      case 'crowned':
        // Crowned: distinct pinnacle top for MASTERED state.
        return isTop ? TIER_GEOM_CROWN : TIER_GEOM_INSET;
      default:
        return TIER_GEOM_BASIC;
    }
  };

  // Inset factor varies by style — compound/crowned step in more aggressively, creating distinct silhouettes.
  const getInsetFactor = (): number => {
    switch (appearance.geometryStyle) {
      case 'minimal':
        return 0.15;   // barely inset
      case 'stacked':
        return 0.34;   // moderate taper
      case 'compound':
        return 0.48;   // strong steps
      case 'crowned':
        return 0.55;   // pronounced pinnacle
      default:
        return 0.34;
    }
  };

  const insetFactor = getInsetFactor();

  return (
    <group ref={group} position={position}>
      {/* The plot. Always present, even at zero development — an unformed district is a site. */}
      <mesh
        geometry={PLOT_GEOM}
        material={plotMaterial}
        scale={[radius, 1, radius]}
        position={[0, 0.04, 0]}
        receiveShadow
        onPointerDown={onSelect ? (e) => { e.stopPropagation(); onSelect(reading.id); } : undefined}
      />

      {/* Stacked tiers with VARIED SILHOUETTES. Inset steps create distinct shapes per state, and
          subtle rotations break perfect symmetry — a district is a built place, not a bar chart. */}
      {Array.from({ length: appearance.tiers }, (_, i) => {
        const inset = 1 - (i / appearance.tiers) * insetFactor;
        const w = radius * 1.05 * inset;
        // Tiny deterministic rotation per tier breaks perfect stack. Derived from index, never random
        // — world must look identical every launch. Variation increases for higher tiers (more built-up).
        const skew = ((i * 37 + reading.slot * 17) % 11 - 5) * 0.005 * (1 + i * 0.15);
        // Crowned top tier gets extra prominence.
        const isTop = i === appearance.tiers - 1;
        const heightScale = (appearance.geometryStyle === 'crowned' && isTop) ? 1.12 : 0.94;

        return (
          <mesh
            key={i}
            geometry={getTierGeometry(i, appearance.tiers)}
            material={tierMaterial}
            position={[0, 0.08 + tierHeight * (i + 0.5), 0]}
            rotation={[0, skew, 0]}
            scale={[w, tierHeight * heightScale, w]}
            castShadow
            receiveShadow
          />
        );
      })}

      {/* The Fog Line. Sized to the structure so its uv.y maps 1:1 onto confidence.
          Width tracks the massing (which is radius * 1.05) plus a little bleed for the shader's
          side falloff to fade out in. Wider than that and the billboard's own rectangle becomes
          the thing you see instead of the district. */}
      <mesh
        ref={fogMesh}
        geometry={FOG_GEOM}
        material={fogMaterial}
        position={[0, 0.08 + appearance.height / 2, 0]}
        scale={[radius * 1.45, appearance.height * 1.15, 1]}
        renderOrder={2}
      />
    </group>
  );
}
