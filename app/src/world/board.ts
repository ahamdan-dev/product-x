/**
 * Board geometry. Pure data + pure math, so the layout is verifiable without a renderer.
 *
 * 32 perimeter spaces: 4 corners + 7 action cards per side. The center is NOT a space — it is the
 * world viewport, which is the actual product. The perimeter is how you *act*; the center is what
 * your actions built.
 *
 * Corner assignment is fixed by the blueprint:
 *   HOME    bottom-left   — where a session begins
 *   JOURNEY top-left      — the long arc
 *   WORLD   top-right     — the world itself
 *   VAULT   bottom-right  — what you've banked
 *
 * Winding is counter-clockwise starting at HOME, so index 0..31 walks the board the way the
 * companion walks it. The camera's four yaw presets are aligned to these same four corners, so
 * "rotate to Journey" and "the Journey corner" are the same concept in both systems.
 */

export const BOARD_SIZE = 32;          // world units, edge to edge
export const SPACES_PER_SIDE = 7;      // action cards between each pair of corners
export const TOTAL_SPACES = 4 + 4 * SPACES_PER_SIDE;   // 32

export type CornerId = 'home' | 'journey' | 'world' | 'vault';

/** The four sides, each named for the kind of work it holds. */
export type SideId = 'west' | 'north' | 'east' | 'south';

export interface Space {
  index: number;                       // 0..31, counter-clockwise from HOME
  kind: 'corner' | 'action';
  corner?: CornerId;
  side: SideId;
  /** Position on the board plane, y = 0. */
  position: [number, number, number];
  /** Outward-facing normal, so cards and buildings orient away from the center. */
  facing: [number, number, number];
  /** Rotation in radians about Y that makes a card face outward. */
  rotationY: number;
}

const HALF = BOARD_SIZE / 2;

/**
 * Corner coordinates. Z is negated for "north" because Three.js looks down -Z, so -Z reads as
 * away-from-viewer, i.e. the top of the board.
 */
const CORNERS: Record<CornerId, { x: number; z: number }> = {
  home:    { x: -HALF, z:  HALF },   // bottom-left
  journey: { x: -HALF, z: -HALF },   // top-left
  world:   { x:  HALF, z: -HALF },   // top-right
  vault:   { x:  HALF, z:  HALF },   // bottom-right
};

/** Walk order: HOME → up the west side → JOURNEY → across the north → WORLD → down east → VAULT. */
const WALK: Array<{ from: CornerId; to: CornerId; side: SideId }> = [
  { from: 'home',    to: 'journey', side: 'west'  },
  { from: 'journey', to: 'world',   side: 'north' },
  { from: 'world',   to: 'vault',   side: 'east'  },
  { from: 'vault',   to: 'home',    side: 'south' },
];

/** Outward normal per side — away from board center. */
const SIDE_FACING: Record<SideId, [number, number, number]> = {
  west:  [-1, 0,  0],
  north: [ 0, 0, -1],
  east:  [ 1, 0,  0],
  south: [ 0, 0,  1],
};

function facingToRotationY(f: [number, number, number]): number {
  // atan2(x, z) gives the Y rotation that points +Z along the facing vector.
  return Math.atan2(f[0], f[2]);
}

/**
 * Build the board once. Deterministic — same output every call, so it can be module-level constant.
 */
export function buildBoard(): Space[] {
  const spaces: Space[] = [];
  let index = 0;

  for (const leg of WALK) {
    const a = CORNERS[leg.from];
    const b = CORNERS[leg.to];

    // The corner belongs to the leg that starts at it, so each corner is emitted exactly once.
    // Its facing is the diagonal bisector of the two adjacent sides — corners are viewed from
    // outside the board's diagonal, not from either side.
    const prevSide = WALK[(WALK.indexOf(leg) + WALK.length - 1) % WALK.length]!.side;
    const f1 = SIDE_FACING[prevSide];
    const f2 = SIDE_FACING[leg.side];
    const dx = f1[0] + f2[0];
    const dz = f1[2] + f2[2];
    const len = Math.hypot(dx, dz) || 1;
    const cornerFacing: [number, number, number] = [dx / len, 0, dz / len];

    spaces.push({
      index: index++,
      kind: 'corner',
      corner: leg.from,
      side: leg.side,
      position: [a.x, 0, a.z],
      facing: cornerFacing,
      rotationY: facingToRotationY(cornerFacing),
    });

    // Then the 7 action cards, evenly spaced strictly between the two corners.
    for (let i = 1; i <= SPACES_PER_SIDE; i++) {
      const t = i / (SPACES_PER_SIDE + 1);
      const f = SIDE_FACING[leg.side];
      spaces.push({
        index: index++,
        kind: 'action',
        side: leg.side,
        position: [a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t],
        facing: f,
        rotationY: facingToRotationY(f),
      });
    }
  }

  return spaces;
}

/**
 * The four intent modes, one per side. §5 of the blueprint: DISCOVER / LEARN / PERFORM / GROW, and
 * the earlier "Explore / Practice" naming is explicitly superseded.
 *
 * A side owning a mode is what makes the board learnable — "I know what kind of things live on this
 * side" has to be true before you read a single label, which is why the mode carries a color.
 */
export type IntentMode = 'discover' | 'learn' | 'perform' | 'grow';

/** Canonical traversal: HOME → DISCOVER → JOURNEY → LEARN → WORLD → PERFORM → VAULT → GROW → HOME. */
export const SIDE_MODE: Record<SideId, IntentMode> = {
  west:  'discover',   // HOME → JOURNEY
  north: 'learn',      // JOURNEY → WORLD
  east:  'perform',    // WORLD → VAULT
  south: 'grow',       // VAULT → HOME
};

/**
 * The 28 action space names, in walk order per side, from the v4 workbench board.
 *
 * Each side follows the §6 rhythm — entry → quick action → deeper engagement → challenge →
 * reflection → transition — which is why the order is fixed rather than alphabetical. These are the
 * names the user learns the board by; they are not placeholders.
 */
export const SIDE_SPACES: Record<SideId, readonly string[]> = {
  // HOME → JOURNEY. Orientation and decision-making: "what matters right now?"
  west: [
    'Continue', 'Opportunities', 'Recommendations', 'Insights',
    'Priorities', 'Weak Spots', 'Daily Compass',
  ],
  // JOURNEY → WORLD. Knowledge acquisition: "help me understand this."
  north: [
    'Subject Workspace', 'AI Tutor', 'Resources', 'Visual Library',
    'Concept Map', 'Deep Dive', 'Ask Anything',
  ],
  // WORLD → VAULT. Application and evaluation: "prove competency."
  east: [
    'Patient Cases', 'Differential', 'Procedures & Skills', 'Challenge Mode',
    'Exam Simulation', 'AI Examiner', 'Debrief',
  ],
  // VAULT → HOME. Long-term development: "who am I becoming?"
  south: [
    'Goals', 'Adaptive Plan', 'Habits', 'Teamwork',
    'Mentor', 'Portfolio', 'Celebrate',
  ],
} as const;

/** Display name for any space — corner or action. */
export function spaceLabel(s: Space): string {
  if (s.kind === 'corner' && s.corner) {
    return s.corner.charAt(0).toUpperCase() + s.corner.slice(1);
  }
  // Action spaces are emitted in walk order per side, so the index within the side is the name index.
  const sideCards = BOARD.filter(x => x.side === s.side && x.kind === 'action');
  const i = sideCards.findIndex(x => x.index === s.index);
  return SIDE_SPACES[s.side][i] ?? '';
}

export const BOARD: readonly Space[] = Object.freeze(buildBoard());

/**
 * Which way a space's label must face to read right-side-up from a given camera bearing.
 *
 * Returns +1 to keep the label aligned with the space's outward axis, -1 to reverse it. The renderer
 * builds an explicit basis from this, so it can only ever produce upside-down or right-side-up text —
 * never mirrored text, which is what you get from composing Euler angles by hand.
 *
 * This lives here, in tested pure code, because the render-side version of this decision has now been
 * written wrong twice: first as a fixed rotation, then as a position test (`z < -2 || x > 2`) that
 * straddles the middle of a side and flipped half of one edge. Both looked reasonable in review and
 * both shipped visibly broken labels. A dot product against the outward axis cannot straddle an edge,
 * because it is the same axis for every tile on that edge.
 *
 * `camX`/`camZ` are the camera's ground-plane position; height is irrelevant, only bearing matters.
 */
export function labelFacingSign(s: Space, camX: number, camZ: number): 1 | -1 {
  // Toward the camera, on the ground plane.
  const tx = camX - s.position[0];
  const tz = camZ - s.position[2];
  // Positive when the camera sits on this space's outward side. In that case the outward axis points
  // *at* the viewer, which maps to down-screen, so the label must be reversed.
  return tx * s.facing[0] + tz * s.facing[2] > 0 ? -1 : 1;
}

/** Corner lookup, for the camera and for navigation. */
export function cornerSpace(id: CornerId): Space {
  const s = BOARD.find(sp => sp.corner === id);
  if (!s) throw new Error(`unknown corner: ${id}`);
  return s;
}

/**
 * Perimeter distance between two spaces, normalized 0..1 against the longest possible walk.
 * The companion's gait selection consumes this — see `gaitFor` in companion/behavior.ts. Going the
 * short way round is the point: half the board is the maximum, never three quarters.
 */
export function normalizedWalkDistance(fromIndex: number, toIndex: number): number {
  const raw = Math.abs(toIndex - fromIndex);
  const steps = Math.min(raw, TOTAL_SPACES - raw);
  return steps / (TOTAL_SPACES / 2);
}

/** The actual path the companion walks, always the short way. Inclusive of both endpoints. */
export function walkPath(fromIndex: number, toIndex: number): number[] {
  const forward = (toIndex - fromIndex + TOTAL_SPACES) % TOTAL_SPACES;
  const backward = TOTAL_SPACES - forward;
  const dir = forward <= backward ? 1 : -1;
  const steps = Math.min(forward, backward);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push((fromIndex + dir * i + TOTAL_SPACES) % TOTAL_SPACES);
  }
  return out;
}

/**
 * District layout inside the board. Districts are the subject regions the learner model tracks;
 * they live in the center field, arranged on concentric rings so the camera's three framings each
 * have a natural subject: `board` sees all rings, `district` frames one ring sector, `close` frames
 * one district.
 *
 * Ring radii are chosen so nothing intrudes on the perimeter walkway (needs ~2 units clearance) and
 * nothing clusters at dead center, which would fight the companion for attention.
 */
export interface DistrictSlot {
  id: string;
  ring: 0 | 1 | 2;
  position: [number, number, number];
  /** Footprint radius, for spacing and for the fog plane's width. */
  radius: number;
}

// The center viewport is the board's inner square: half the board minus the tile depth. Ring radii
// must keep every district (position + footprint) strictly inside it, or the world visibly grows
// through the walkway — which is exactly what made the first pass read as debris on a field rather
// than as "the center is meaning" (§3).
const RING_RADIUS = [2.9, 6.5, 10.2] as const;
const RING_COUNT = [3, 7, 11] as const;    // primes, so rings never visually align into spokes
const RING_FOOTPRINT = [2.0, 1.7, 1.4] as const;

/**
 * Deterministic district slots. 21 total — enough for the organ systems and foundational sciences
 * a preclinical curriculum actually covers, without inventing filler.
 */
export function buildDistrictSlots(): DistrictSlot[] {
  const out: DistrictSlot[] = [];
  for (let ring = 0; ring < 3; ring++) {
    const n = RING_COUNT[ring]!;
    const r = RING_RADIUS[ring]!;
    // Offset each ring by half a step so adjacent rings interleave rather than line up.
    const phase = (Math.PI / n) * (ring % 2);
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      out.push({
        id: `r${ring}s${i}`,
        ring: ring as 0 | 1 | 2,
        position: [Math.cos(a) * r, 0, Math.sin(a) * r],
        radius: RING_FOOTPRINT[ring]!,
      });
    }
  }
  return out;
}

export const DISTRICT_SLOTS: readonly DistrictSlot[] = Object.freeze(buildDistrictSlots());
