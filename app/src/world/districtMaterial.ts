/**
 * District appearance. Pure functions from a learner-model reading to material parameters.
 *
 * Art direction, per the user: "INBETWEEN VOX WORLD AND SEMI STYLIZED REALISM 3D... DOESNT HAVE TO
 * BE SUPER 3D." So: chunky blocked massing (voxel lineage) with real material response — soft
 * gradient lighting, a hint of roughness variation, no cel-shading, no PBR photorealism. The middle
 * is where it reads as a designed physical model rather than either a Minecraft clone or a failed
 * attempt at realism.
 *
 * The hard rule from DESIGN-SYSTEM.md §2: **unstable is not a color.** Decay is rendered as loss of
 * chroma and light, moving toward `--x-fog`. Nothing ever turns red or orange to say "you are bad at
 * this." So this file has no failure color at all — the concept simply doesn't exist here.
 */

import type { WorldState } from '../learner/model';
import type { DistrictReading } from '../state/store';

/**
 * The palette, mirrored from tokens.css --x-ev-* evidence ramp. Conviction IS chroma.
 *
 * The FIX mandate: use the --x-ev-* evidence ramp directly. Saturation means certainty. Fading bleeds
 * to warm grey (--x-fog), never red. Conflicted is amber (--x-caution). These hex values come ONLY
 * from tokens.css, never invented.
 *
 * Strategy: districts express MODEL STATE through material. Development drives height. Confidence
 * drives fog line height (uncertainty, never failure). Conflict drives amber haze. Decayed drives
 * desaturation (chroma loss) but NEVER demolition — earned height stays.
 */
export const WORLD_PALETTE = {
  light: {
    /** Ground: warm porcelain from tokens.css --x-surface-2 */
    ground:   '#F0EFEB',
    /** Base stock for unstated structure */
    stock:    '#F6F4F1',
    line:     '#DFDEDA',
    /** Structure hue — kept for compatibility, but districts now use evidence ramp */
    hema:     '#5757C3',          // using evStable as the hema replacement (conviction)
    /** Evidence ramp — saturation IS certainty. From tokens.css --x-ev-* */
    evSeen:          '#B9B8CC',   // encountered, low chroma
    evRecalled:      '#A2A1CB',   // retrieved once
    evDistinguished: '#8A8BCB',   // told apart
    evApplied:       '#7071C7',   // used in novel case
    evStable:        '#5757C3',   // held across time — full conviction
    evFading:        '#B2B3B6',   // neutral-cool grey, NOT warm/red (flipped R/B from tokens)
    evConflicted:    '#A9762E',   // amber caution, from --x-caution
    /** Earned illumination — warm amber lamp. From the voxel refs, kept for mastery glow. */
    iodine:   '#F0A855',
    eosin:    '#E8927A',          // kept for companion token compatibility
    fog:      '#B2B3B6',          // neutral-cool fog (adjusted from --x-fog to stay cool)
    ink:      '#20222B',          // --x-ink
    /** Behind-glass gradient depth. Never a surface fill. */
    deep:     '#3A3170',          // --x-deep
    bloom:    '#9AA6FF',          // --x-bloom
    /** The four intent modes. */
    discover: '#4875B7',
    learn:    '#008A71',
    perform:  '#AD5944',
    grow:     '#8B5FA5',
  },
  dark: {
    ground:   '#141519',
    stock:    '#22242A',
    line:     '#2E3138',
    hema:     '#AAAEE3',          // kept for compatibility
    evSeen:          '#6A6880',
    evRecalled:      '#7A7A95',
    evDistinguished: '#8A8BCB',
    evApplied:       '#9A9CD7',
    evStable:        '#AAAEE3',
    evFading:        '#5A5A58',
    evConflicted:    '#D4A760',
    iodine:   '#FFC178',
    eosin:    '#F0A48D',          // kept for companion token compatibility
    fog:      '#3A3E45',
    ink:      '#F2F0ED',
    deep:     '#1B2440',
    bloom:    '#5D8FD6',
    discover: '#6E92F5',
    learn:    '#46B296',
    perform:  '#E3805A',
    grow:     '#A288DF',
  },
} as const;

export type Theme = keyof typeof WORLD_PALETTE;

export interface DistrictAppearance {
  /** Structure height in world units. Earned development, never taken away. */
  height: number;
  /** Base color from evidence ramp, modulated by confidence (saturation IS certainty). */
  color: string;
  /** 0..1 — how much iodine light this district emits. Rationed: mastery only. */
  emissive: number;
  /** Material roughness. Proven work reads as finished; unproven reads as raw. */
  roughness: number;
  /** How many stacked blocks to draw. Discrete steps read as built, not as a stretched bar. */
  tiers: number;
  /** Fog line height, normalized 0..1 of the structure's own height. */
  fogAt: number;
  /** 0..1 — extra fog opacity where sources disagree. Conflict is visible, never averaged away. */
  conflictHaze: number;
  /** Geometry style — silhouette varies by state so MASTERED and FOUNDATION look different. */
  geometryStyle: 'minimal' | 'stacked' | 'compound' | 'crowned';
  /** Conflict drives amber haze in the material, not red. */
  conflictTint: number;  // 0..1 — how much amber (evConflicted) to mix into the material
}

/** Minimum and maximum structure height. Nothing is ever zero — an unformed district is a plot. */
const H_MIN = 0.35;
const H_MAX = 4.6;

/**
 * Per-state visual intent: geometry shape, material finish, and color key from the evidence ramp.
 * Height comes from development, but STATE decides silhouette and surface response, because
 * "developed but decayed" and "developing" are DIFFERENT facts and must NOT look the same.
 *
 * NEW: each state gets a distinct GEOMETRY SILHOUETTE — MASTERED and FOUNDATION are different shapes,
 * not just different heights. This kills the "bar chart" CAD read.
 */
const STATE_INTENT: Record<WorldState, {
  rough: number;
  emit: number;
  colorKey: string;  // which evidence ramp color to use as base
  geometryStyle: 'minimal' | 'stacked' | 'compound' | 'crowned';  // silhouette shape
}> = {
  UNFORMED: {
    rough: 0.95,
    emit: 0.00,
    colorKey: 'evSeen',         // lowest chroma — fog, "I don't know"
    geometryStyle: 'minimal',   // single low mass, site only
  },
  FOUNDATION: {
    rough: 0.86,
    emit: 0.00,
    colorKey: 'evRecalled',
    geometryStyle: 'stacked',   // simple vertical tiers
  },
  DEVELOPING: {
    rough: 0.72,
    emit: 0.04,
    colorKey: 'evDistinguished',
    geometryStyle: 'stacked',
  },
  FUNCTIONAL: {
    rough: 0.55,
    emit: 0.10,
    colorKey: 'evApplied',
    geometryStyle: 'compound',  // inset steps, more articulation
  },
  MASTERED: {
    rough: 0.38,
    emit: 0.26,
    colorKey: 'evStable',       // full conviction chroma
    geometryStyle: 'crowned',   // distinct silhouette — a pinnacle
  },
  // Earned once, retrievability lapsed. Keeps height and most of finish — §21.6 forbids demolition —
  // but light goes out and chroma drains to evFading (warm grey, never red).
  MAINTENANCE: {
    rough: 0.62,
    emit: 0.03,
    colorKey: 'evFading',       // warm grey
    geometryStyle: 'compound',  // keeps the built shape, just quieter
  },
};

/**
 * Mix two hex colors in sRGB. Not perceptually ideal, but this feeds a Three.js material that
 * converts to linear anyway, and the alternative is shipping a color library for one function.
 */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round((((pa >> 16) & 255) * (1 - t)) + (((pb >> 16) & 255) * t));
  const g = Math.round((((pa >> 8) & 255) * (1 - t)) + (((pb >> 8) & 255) * t));
  const bl = Math.round(((pa & 255) * (1 - t)) + ((pb & 255) * t));
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

export function districtAppearance(r: DistrictReading, theme: Theme = 'light'): DistrictAppearance {
  const p = WORLD_PALETTE[theme];
  const intent = STATE_INTENT[r.state];

  // Height tracks the high-water mark, not live mastery — development is never demolished (§21.6).
  const earned = Math.max(r.development, r.development + r.decayed);
  const height = H_MIN + (H_MAX - H_MIN) * Math.min(1, earned);

  // NEW COLOR STRATEGY: conviction IS chroma. Start from the state's evidence-ramp color, then
  // modulate by confidence (LOW confidence → desaturate toward fog) and decay (decay → desaturate).
  // Conflict adds amber tint (caution), never red.
  const baseColor = p[intent.colorKey as keyof typeof p] as string;

  // Confidence drives saturation: low confidence means we don't know, so color drains to fog.
  const confidenceMix = Math.max(0, Math.min(1, r.confidence * 0.85 + 0.15));  // never fully grey
  const withConfidence = mixHex(p.fog, baseColor, confidenceMix);

  // Decay ALSO desaturates, stacking on top — a lapsed district greys further toward evFading.
  const decayPull = Math.max(0, r.decayed * 0.65);
  const color = mixHex(withConfidence, p.evFading, decayPull);

  return {
    height,
    color,
    emissive: intent.emit,
    roughness: intent.rough,
    geometryStyle: intent.geometryStyle,
    // Discrete tiers: 1 block per ~0.9 units. Reading "three tiers tall" is a fact you can hold;
    // reading "62% of a bar" is not.
    tiers: Math.max(1, Math.round(height / 0.9)),
    // The signature. Confidence 0 → fog sits at the base, swallowing everything. Confidence 1 →
    // fog is gone. This is why a tall district with a low fog line reads as "unverified."
    fogAt: Math.min(1, Math.max(0, r.confidence)),
    conflictHaze: Math.min(1, r.conflict * 1.6),
    // Conflict drives amber tint (caution color), never red or failure color.
    conflictTint: Math.min(1, r.conflict * 0.55),
  };
}

/** Iodine light color, for the emissive channel. Earned illumination, never decorative. */
export function iodine(theme: Theme = 'light'): string {
  return WORLD_PALETTE[theme].iodine;
}

/** Fog color for the shader. */
export function fogColor(theme: Theme = 'light'): string {
  return WORLD_PALETTE[theme].fog;
}

/**
 * Ground plane color. Slightly darker than the app background so the board reads as a physical
 * object resting on the page rather than a hole cut in it.
 */
export function groundColor(theme: Theme = 'light'): string {
  const p = WORLD_PALETTE[theme];
  return mixHex(p.ground, p.ink, theme === 'light' ? 0.055 : 0.0);
}
