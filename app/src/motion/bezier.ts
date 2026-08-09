/**
 * A cubic-bezier solver, so canvas motion and CSS motion ride the exact same curve.
 *
 * This matters more than it sounds. The house curve is `cubic-bezier(.32,.72,0,1)` and it drives
 * every DOM transition. If the 3D camera used a hand-rolled easeOutCubic instead, a panel sliding
 * in while the camera dollies would settle at a visibly different moment — the classic tell that a
 * 3D layer and a UI layer were built by different people. One solver, one feel.
 *
 * Newton-Raphson with a bisection fallback: converges in 4 iterations for well-behaved curves and
 * stays correct for the pathological ones.
 */

export type Easing = (t: number) => number;

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.02;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 12;

function a(a1: number, a2: number) { return 1.0 - 3.0 * a2 + 3.0 * a1; }
function b(a1: number, a2: number) { return 3.0 * a2 - 6.0 * a1; }
function c(a1: number) { return 3.0 * a1; }

/** Evaluate the polynomial form of one bezier axis at parameter t. */
function calcBezier(t: number, a1: number, a2: number): number {
  return ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t;
}

/** Derivative, for Newton-Raphson. */
function getSlope(t: number, a1: number, a2: number): number {
  return 3.0 * a(a1, a2) * t * t + 2.0 * b(a1, a2) * t + c(a1);
}

function binarySubdivide(x: number, lo: number, hi: number, x1: number, x2: number): number {
  let currentX: number;
  let currentT: number;
  let i = 0;
  do {
    currentT = lo + (hi - lo) / 2.0;
    currentX = calcBezier(currentT, x1, x2) - x;
    if (currentX > 0.0) hi = currentT;
    else lo = currentT;
  } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
  return currentT;
}

function newtonRaphsonIterate(x: number, guessT: number, x1: number, x2: number): number {
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const slope = getSlope(guessT, x1, x2);
    if (slope === 0.0) return guessT;
    guessT -= (calcBezier(guessT, x1, x2) - x) / slope;
  }
  return guessT;
}

/** Build an easing function from control points, matching CSS `cubic-bezier(x1,y1,x2,y2)`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  if (x1 === y1 && x2 === y2) return (t) => t;          // linear, skip the solve

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;

    // Invert x(t) to recover the curve parameter, then evaluate y at it.
    const initialSlope = getSlope(t, x1, x2);
    const guess = initialSlope >= NEWTON_MIN_SLOPE
      ? newtonRaphsonIterate(t, t, x1, x2)
      : initialSlope === 0.0
        ? t
        : binarySubdivide(t, 0, 1, x1, x2);

    return calcBezier(guess, y1, y2);
  };
}

/** The house curve — fast out, long settle. Identical to `--x-ease`. */
export const EASE = cubicBezier(0.32, 0.72, 0, 1);
/** For fades only. Identical to `--x-ease-soft`. */
export const EASE_SOFT = cubicBezier(0.4, 0, 0.2, 1);

/** Durations, mirroring the CSS tokens so nothing drifts. */
export const DUR = {
  fast: 140,
  base: 240,
  slow: 420,
  camera: 620,
  world: 1800,
} as const;

/**
 * Critically-damped spring approach — the right tool for anything chasing a moving target
 * (orbit spring-back, companion follow). Unlike a fixed-duration tween it has no "restart" pop
 * when the target changes mid-flight, which is exactly what an interruptible camera needs.
 *
 * `smoothing` is the fraction remaining after 1 second, so it is framerate-independent.
 */
export function damp(current: number, target: number, smoothing: number, dtMs: number): number {
  if (smoothing <= 0) return target;
  const t = 1 - Math.pow(smoothing, dtMs / 1000);
  return current + (target - current) * t;
}

/** Shortest signed angular delta in radians — keeps yaw from unwinding the long way round. */
export function shortestAngle(from: number, to: number): number {
  const TAU = Math.PI * 2;
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
