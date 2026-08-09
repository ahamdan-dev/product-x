/**
 * App state. Zustand, one store, deliberately flat.
 *
 * The learner model is the product, so it lives here as the source of truth and every visual reads
 * from it. Nothing in the renderer computes competency — it only displays what the model says.
 */

import { create } from 'zustand';
import {
  ingest, mastery, worldState, peakMastery, retrievability,
  type ConceptState, type EvidenceEvent, type WorldState,
} from '../learner/model';
import { seedLearner } from '../learner/seed';
import { DISTRICT_SLOTS } from '../world/board';
import type { CompanionMode } from '../companion/behavior';
import {
  readCharacterPreference,
  writeCharacterPreference,
  type CompanionCharacter,
} from '../companion/preference';
import type { FramingId, YawPresetId } from '../world/camera';

/**
 * A district is a subject region. It aggregates the concepts inside it — the world shows districts,
 * the model tracks concepts, and this is where the two meet.
 */
export interface District {
  id: string;
  label: string;
  /** Which of the 21 layout slots it occupies. */
  slot: number;
  conceptIds: string[];
}

/** The 21 subject regions a preclinical curriculum actually covers. No filler. */
const DISTRICTS: Array<{ id: string; label: string }> = [
  // Ring 0 — the three that everything else is built on.
  { id: 'cell',        label: 'Cell & Molecular' },
  { id: 'genetics',    label: 'Genetics' },
  { id: 'biochem',     label: 'Biochemistry' },
  // Ring 1 — mechanism.
  { id: 'physiology',  label: 'Physiology' },
  { id: 'pathology',   label: 'General Pathology' },
  { id: 'pharm',       label: 'Pharmacology' },
  { id: 'micro',       label: 'Microbiology' },
  { id: 'immuno',      label: 'Immunology' },
  { id: 'histo',       label: 'Histology' },
  { id: 'anatomy',     label: 'Gross Anatomy' },
  // Ring 2 — organ systems, where clinical reasoning happens.
  { id: 'cardio',      label: 'Cardiovascular' },
  { id: 'resp',        label: 'Respiratory' },
  { id: 'renal',       label: 'Renal' },
  { id: 'gi',          label: 'Gastrointestinal' },
  { id: 'endo',        label: 'Endocrine' },
  { id: 'neuro',       label: 'Neurology' },
  { id: 'msk',         label: 'Musculoskeletal' },
  { id: 'heme',        label: 'Hematology' },
  { id: 'repro',       label: 'Reproductive' },
  { id: 'psych',       label: 'Psychiatry' },
  { id: 'derm',        label: 'Dermatology' },
];

export interface SurfaceState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  open: boolean;
  /** Higher is nearer the front. Focus raises it. */
  order: number;
}

interface AppState {
  // ── Learner model ────────────────────────────────────────────────────────
  concepts: Record<string, ConceptState>;
  districts: District[];

  // ── World view ───────────────────────────────────────────────────────────
  preset: YawPresetId;
  framing: FramingId;
  focusedDistrict: string | null;

  // ── Companion ────────────────────────────────────────────────────────────
  mode: CompanionMode;
  character: CompanionCharacter;
  /** Which perimeter space the companion is standing on. */
  companionSpace: number;

  // ── Floating surfaces ────────────────────────────────────────────────────
  surfaces: Record<string, SurfaceState>;
  nextOrder: number;

  // ── Actions ──────────────────────────────────────────────────────────────
  record: (e: EvidenceEvent) => void;
  setMode: (m: CompanionMode) => void;
  setCharacter: (c: CompanionCharacter) => void;
  setPreset: (p: YawPresetId) => void;
  setFraming: (f: FramingId) => void;
  focusDistrict: (id: string | null) => void;
  moveCompanion: (spaceIndex: number) => void;

  openSurface: (id: string, init?: Partial<SurfaceState>) => void;
  closeSurface: (id: string) => void;
  toggleMinimize: (id: string) => void;
  moveSurface: (id: string, x: number, y: number) => void;
  resizeSurface: (id: string, width: number, height: number) => void;
  raiseSurface: (id: string) => void;
}

/** District aggregate, computed not stored — a cached number would go stale as time passes. */
export interface DistrictReading {
  id: string;
  label: string;
  slot: number;
  /** Mean live mastery across its concepts, 0..1. Drives height and material. */
  development: number;
  /** Mean estimate confidence, 0..1. Drives the fog line height. */
  confidence: number;
  /** Worst-case conflict in the district — surfaces disagreement rather than averaging it away. */
  conflict: number;
  /** The dominant world state, for material selection. */
  state: WorldState;
  /** How much has decayed from the high-water mark. Drives desaturation, never demolition. */
  decayed: number;
  conceptCount: number;
}

export function readDistrict(
  d: District,
  concepts: Record<string, ConceptState>,
  now: number,
): DistrictReading {
  const cs = d.conceptIds.map(id => concepts[id]).filter((c): c is ConceptState => !!c);

  if (cs.length === 0) {
    return {
      id: d.id, label: d.label, slot: d.slot,
      development: 0, confidence: 0, conflict: 0,
      state: 'UNFORMED', decayed: 0, conceptCount: 0,
    };
  }

  let devSum = 0, confSum = 0, peakSum = 0, worstConflict = 0;
  const stateCounts = new Map<WorldState, number>();

  for (const c of cs) {
    devSum += mastery(c, now);
    confSum += c.estimateConfidence;
    peakSum += peakMastery(c);
    worstConflict = Math.max(worstConflict, c.evidenceConflict);
    const s = worldState(c, now);
    stateCounts.set(s, (stateCounts.get(s) ?? 0) + 1);
  }

  const development = devSum / cs.length;
  const peak = peakSum / cs.length;

  // The most advanced state present wins, not the most common — §21.6 forbids visually taking away
  // earned development, so one MASTERED concept must still read as built.
  const RANK: WorldState[] =
    ['MASTERED', 'MAINTENANCE', 'FUNCTIONAL', 'DEVELOPING', 'FOUNDATION', 'UNFORMED'];
  const state = RANK.find(s => stateCounts.has(s)) ?? 'UNFORMED';

  return {
    id: d.id, label: d.label, slot: d.slot,
    development,
    confidence: confSum / cs.length,
    conflict: worstConflict,
    state,
    decayed: Math.max(0, peak - development),
    conceptCount: cs.length,
  };
}

/**
 * Seed: each district gets one concept per slot so the world has structure from the first frame.
 *
 * The concepts are then given a real evidence history via `seedLearner`, which folds plausible events
 * through the actual `ingest()` pipeline. A truly empty model renders honestly as 21 unlit grey plots
 * — correct, and indistinguishable from broken. Every number you see is still model-derived; none of
 * it is painted on.
 */
function seedDistricts(): { districts: District[]; concepts: Record<string, ConceptState> } {
  const districts: District[] = [];

  DISTRICTS.forEach((d, i) => {
    districts.push({ id: d.id, label: d.label, slot: i, conceptIds: [`${d.id}.core`] });
  });

  return { districts, concepts: seedLearner(districts, Date.now()) };
}

const seed = seedDistricts();

/** Default geometry per surface kind. Sized to content, not to a grid. */
const SURFACE_DEFAULTS: Record<string, Partial<SurfaceState>> = {
  card:     { width: 380, height: 470 },
  findings: { width: 420, height: 380 },
  anatomy:  { width: 900, height: 640 },
  renal:    { width: 960, height: 620 },
  station:  { width: 1020, height: 680 },
  ecg:      { width: 880, height: 420 },
};

export const useApp = create<AppState>((set) => ({
  concepts: seed.concepts,
  districts: seed.districts,

  preset: 'home',
  framing: 'board',
  focusedDistrict: null,

  mode: 'ask',
  character: readCharacterPreference(),
  companionSpace: 0,

  surfaces: {},
  nextOrder: 1,

  record: (e) => set(state => {
    const existing = state.concepts[e.conceptId];
    if (!existing) return state;
    return { concepts: { ...state.concepts, [e.conceptId]: ingest(existing, e) } };
  }),

  setMode: (mode) => set({ mode }),
  setCharacter: (character) => {
    writeCharacterPreference(character);
    set({ character });
  },
  setPreset: (preset) => set({ preset }),
  setFraming: (framing) => set({ framing }),
  focusDistrict: (focusedDistrict) => set({ focusedDistrict }),
  moveCompanion: (companionSpace) => set({ companionSpace }),

  openSurface: (id, init) => set(state => {
    const prev = state.surfaces[id];
    const kind = id.split(':')[0] ?? id;
    const def = SURFACE_DEFAULTS[kind] ?? { width: 420, height: 460 };
    // Reopening restores the last position — the user moved it there for a reason.
    return {
      surfaces: {
        ...state.surfaces,
        [id]: {
          id,
          x: prev?.x ?? 80 + (state.nextOrder % 5) * 28,
          y: prev?.y ?? 80 + (state.nextOrder % 5) * 22,
          width: prev?.width ?? def.width ?? 420,
          height: prev?.height ?? def.height ?? 460,
          minimized: false,
          open: true,
          order: state.nextOrder,
          ...init,
        },
      },
      nextOrder: state.nextOrder + 1,
    };
  }),

  closeSurface: (id) => set(state => {
    const s = state.surfaces[id];
    if (!s) return state;
    // Keep geometry so a reopen lands where the user left it.
    return { surfaces: { ...state.surfaces, [id]: { ...s, open: false, minimized: false } } };
  }),

  toggleMinimize: (id) => set(state => {
    const s = state.surfaces[id];
    if (!s) return state;
    return { surfaces: { ...state.surfaces, [id]: { ...s, minimized: !s.minimized } } };
  }),

  moveSurface: (id, x, y) => set(state => {
    const s = state.surfaces[id];
    if (!s) return state;
    return { surfaces: { ...state.surfaces, [id]: { ...s, x, y } } };
  }),

  resizeSurface: (id, width, height) => set(state => {
    const s = state.surfaces[id];
    if (!s) return state;
    return { surfaces: { ...state.surfaces, [id]: { ...s, width, height } } };
  }),

  raiseSurface: (id) => set(state => {
    const s = state.surfaces[id];
    if (!s || s.order === state.nextOrder - 1) return state;
    return {
      surfaces: { ...state.surfaces, [id]: { ...s, order: state.nextOrder } },
      nextOrder: state.nextOrder + 1,
    };
  }),
}));

/** Selector: every district's current reading. Call with a `now` so decay is honest. */
export function selectReadings(now: number): DistrictReading[] {
  const { districts, concepts } = useApp.getState();
  return districts.map(d => readDistrict(d, concepts, now));
}

/** Where a district sits in the world, by slot. */
export function slotPosition(slot: number): [number, number, number] {
  return DISTRICT_SLOTS[slot % DISTRICT_SLOTS.length]!.position;
}

export function slotRadius(slot: number): number {
  return DISTRICT_SLOTS[slot % DISTRICT_SLOTS.length]!.radius;
}

/** Re-exported so UI can show honest retention without importing the model directly. */
export { retrievability };
