/**
 * Radial satellite menu geometry — measured off `_refs/EXTRACT/exp_06.jpg`, not invented.
 *
 * What that frame actually shows (companion disc centre ≈ (575,243), r ≈ 85):
 *
 *   satellite        centre        Δx     Δy    distance   angle from +x
 *   umbrella      (743, 251)      168      8      168        ~3°
 *   bell          (810, 353)      235    110      260       ~25°
 *   person        (692, 363)      117    120      168       ~46°
 *   basket        (678, 485)      103    242      263       ~67°
 *   gear          (575, 411)        0    168      168       ~90°
 *
 * Two facts fall out, and they are the whole design:
 *
 *  1. The satellites are NOT on one circle. They alternate between two radii — ~168px and ~261px,
 *     a ratio of 1 : 1.55. That staggering is what makes five circles read as a bloom instead of a
 *     dial, and it is the detail that gets missed when this is built from a description.
 *  2. The arc is a quarter turn (0°→90°, five stops at 22.5°) opening down-and-right of the
 *     companion — into the desktop, away from the screen edge the companion is parked against.
 *
 * Normalized against the companion radius (85px): inner = 1.98r, outer = 3.07r, satellite = 0.55r.
 *
 * Everything below is unit-normalized so the same geometry works at any companion size, and the
 * arc can be reflected when the companion sits near a screen edge — a menu that blooms off-screen
 * is worse than no menu.
 */

export type SatelliteId = 'chat' | 'imagine' | 'activity' | 'library' | 'settings';

export interface Satellite {
  id: SatelliteId;
  label: string;
  /** Count on the dark badge chip. 0 = no badge. */
  badge: number;
}

/** Which quadrant the bloom opens into. Chosen from where the companion sits on screen. */
export type Quadrant = 'downRight' | 'downLeft' | 'upRight' | 'upLeft';

/** Multiples of the companion's radius. Straight from the measurements above. */
export const RING_INNER = 1.98;
export const RING_OUTER = 3.07;
export const SATELLITE_R = 0.55;

/** Five stops over a quarter turn, matching the reference. */
export const ARC_SPAN_DEG = 90;

export interface Placement {
  id: SatelliteId;
  label: string;
  badge: number;
  /** Offset from the companion centre, in multiples of the companion radius. */
  x: number;
  y: number;
  /** Satellite radius, in multiples of the companion radius. */
  r: number;
  /** Stagger index — the reveal order, innermost-first so the bloom grows outward. */
  order: number;
  /** ms of delay before this one appears. */
  delay: number;
}

/** Per-satellite reveal stagger. 34ms reads as one gesture; 80ms reads as a list loading. */
export const STAGGER_MS = 34;

/**
 * Place the satellites. `count` drives the angular step so the arc stays a quarter turn whether
 * there are three items or six.
 */
export function placeSatellites(
  items: readonly Satellite[],
  quadrant: Quadrant = 'downRight',
): Placement[] {
  const n = items.length;
  if (n === 0) return [];

  // n stops inclusive of both ends: 5 items over 90° → 22.5°, exactly the reference.
  const stepDeg = n > 1 ? ARC_SPAN_DEG / (n - 1) : 0;
  const sx = quadrant === 'downRight' || quadrant === 'upRight' ? 1 : -1;
  const sy = quadrant === 'downRight' || quadrant === 'downLeft' ? 1 : -1;

  return items.map((item, i) => {
    const deg = i * stepDeg;
    const rad = (deg * Math.PI) / 180;
    // Alternating rings, starting inner — matches umbrella(inner)/bell(outer)/person(inner)/…
    const ring = i % 2 === 0 ? RING_INNER : RING_OUTER;
    return {
      id: item.id,
      label: item.label,
      badge: item.badge,
      x: sx * Math.cos(rad) * ring,
      y: sy * Math.sin(rad) * ring,
      r: SATELLITE_R,
      order: i,
      delay: i * STAGGER_MS,
    };
  });
}

/**
 * The bloom's true bounding box, in multiples of the companion radius, relative to the companion
 * centre.
 *
 * This is not symmetric and that is the subtle part. The arc's endpoints sit on the axes: the 0°
 * satellite has the same y as the companion centre and the 90° satellite the same x. Each of those
 * circles therefore spills SATELLITE_R *backwards*, against the bloom direction. Reflecting the
 * quadrant does not remove that spill, it only moves it — so a container sized to `bloomExtent()`
 * alone clips two satellites by a sliver, which reads as a rendering bug rather than a design.
 */
export function bloomBox(quadrant: Quadrant = 'downRight'): {
  minX: number; maxX: number; minY: number; maxY: number;
} {
  const forward = RING_OUTER + SATELLITE_R;
  const back = SATELLITE_R;
  const right = quadrant === 'downRight' || quadrant === 'upRight';
  const down = quadrant === 'downRight' || quadrant === 'downLeft';
  return {
    minX: right ? -back : -forward,
    maxX: right ? forward : back,
    minY: down ? -back : -forward,
    maxY: down ? forward : back,
  };
}

/**
 * Pick the quadrant that keeps the whole bloom on screen.
 *
 * The companion lives at a screen edge by design (bottom-right by default), so the naive
 * down-right bloom would spill off both edges. This measures the room actually available, using the
 * asymmetric box above so the backwards spill is part of the decision rather than a surprise.
 */
export function quadrantFor(
  companion: { x: number; y: number; r: number },
  viewport: { width: number; height: number },
): Quadrant {
  const forward = companion.r * (RING_OUTER + SATELLITE_R);
  const back = companion.r * SATELLITE_R;
  // Room for the forward reach on the preferred side AND the backspill on the other.
  const roomRight = viewport.width - companion.x >= forward && companion.x >= back;
  const roomDown = viewport.height - companion.y >= forward && companion.y >= back;
  // Prefer down and right; fall back only when there genuinely is not room.
  const horiz = roomRight ? 'Right' : 'Left';
  const vert = roomDown ? 'down' : 'up';
  return `${vert}${horiz}` as Quadrant;
}

/**
 * Clamp the companion centre so the whole bloom fits. The overlay uses this rather than trusting
 * the drag position, because the user is allowed to park the companion anywhere — including two
 * pixels from a corner, where no quadrant can save the layout.
 */
export function clampCentre(
  companion: { x: number; y: number; r: number },
  viewport: { width: number; height: number },
  quadrant: Quadrant,
): { x: number; y: number } {
  const b = bloomBox(quadrant);
  const minX = -b.minX * companion.r;
  const maxX = viewport.width - b.maxX * companion.r;
  const minY = -b.minY * companion.r;
  const maxY = viewport.height - b.maxY * companion.r;
  return {
    // When the viewport is too small for the bloom at all, centring beats clipping one side.
    x: minX > maxX ? viewport.width / 2 : Math.min(Math.max(companion.x, minX), maxX),
    y: minY > maxY ? viewport.height / 2 : Math.min(Math.max(companion.y, minY), maxY),
  };
}

/** The default five, in the reference's order. Badges come from live state at the call site. */
export const DEFAULT_SATELLITES: readonly Satellite[] = [
  { id: 'chat', label: 'Chat', badge: 0 },
  { id: 'imagine', label: 'Imagine', badge: 0 },
  { id: 'activity', label: 'Activity', badge: 0 },
  { id: 'library', label: 'Library', badge: 0 },
  { id: 'settings', label: 'Settings', badge: 0 },
] as const;

/**
 * Total bloom extent, in multiples of companion radius — the padding the overlay must reserve so
 * no satellite is clipped. A clipped satellite is the tell that the container was sized by guess.
 */
export function bloomExtent(): number {
  return RING_OUTER + SATELLITE_R;
}
