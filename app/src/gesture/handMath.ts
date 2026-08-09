/**
 * Vector and coordinate math for hand landmarks.
 *
 * Derived from gesture-lab `src/utils/math.ts` (MIT). See LICENSE-gesture-lab.md.
 * Trimmed to what this port uses: `averageRotations`, `smootherStep` and `mapDistanceToScale`
 * belonged to the demo scenes and were dropped.
 */

import * as THREE from 'three';
import type { Landmark3 } from './handTypes';

/** Euclidean distance between two 3D points. */
export function distance3D(p1: Landmark3, p2: Landmark3): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Midpoint between two 3D points. */
export function midpoint3D(p1: Landmark3, p2: Landmark3): THREE.Vector3 {
  return new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
}

/**
 * Convert a normalized landmark to Three.js world space, centered on the origin.
 * Y is flipped because screen Y grows downward and world Y grows upward; Z is negated because
 * MediaPipe's Z points away from the camera.
 */
export function normalizedToWorld(landmark: Landmark3, scale = 10): THREE.Vector3 {
  return new THREE.Vector3(
    (landmark.x - 0.5) * scale,
    -(landmark.y - 0.5) * scale,
    -landmark.z * scale,
  );
}

/**
 * Gram-Schmidt orthogonalization producing an orthonormal basis.
 *
 * Required, not optional: the two vectors read off hand landmarks (wrist→middle-MCP and
 * wrist→index-MCP) are never exactly perpendicular, and feeding them straight into
 * `Matrix4.makeBasis` yields a skewed matrix that shears whatever it is applied to.
 */
export function gramSchmidtOrthogonalize(
  rawForward: THREE.Vector3,
  rawRight: THREE.Vector3,
): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
  const forward = rawForward.clone().normalize();

  // Remove the component of rawRight that lies along forward.
  const rightProjection = forward.clone().multiplyScalar(forward.dot(rawRight));
  const right = rawRight.clone().sub(rightProjection).normalize();

  // Cross product is perpendicular to both by construction.
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();

  // Re-derive right from the clean pair for numerical stability.
  right.crossVectors(up, forward).normalize();

  return { forward, right, up };
}

/** Rotation basis of the palm, as a matrix. */
export function calculateHandBasis(
  wrist: Landmark3,
  indexMCP: Landmark3,
  middleMCP: Landmark3,
): THREE.Matrix4 {
  const rawForward = new THREE.Vector3(
    middleMCP.x - wrist.x,
    middleMCP.y - wrist.y,
    middleMCP.z - wrist.z,
  );
  const rawRight = new THREE.Vector3(
    indexMCP.x - wrist.x,
    indexMCP.y - wrist.y,
    indexMCP.z - wrist.z,
  );

  const { forward, right, up } = gramSchmidtOrthogonalize(rawForward, rawRight);
  return new THREE.Matrix4().makeBasis(right, up, forward);
}

/** Palm rotation as Euler angles. */
export function calculateHandRotation(
  wrist: Landmark3,
  indexMCP: Landmark3,
  middleMCP: Landmark3,
): THREE.Euler {
  return new THREE.Euler().setFromRotationMatrix(calculateHandBasis(wrist, indexMCP, middleMCP));
}

/** Palm rotation as a quaternion — what a renderer actually wants. */
export function calculateHandQuaternion(
  wrist: Landmark3,
  indexMCP: Landmark3,
  middleMCP: Landmark3,
): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(
    calculateHandBasis(wrist, indexMCP, middleMCP),
  );
}

/**
 * Hand roll (wrist pronation/supination), from the tilt of the knuckle line.
 * Palm flat to the camera gives roll ≈ 0; twisting the wrist tilts the line.
 * @returns Radians in (-π, π]; positive = counter-clockwise.
 */
export function calculateHandRoll(indexMCP: Landmark3, pinkyMCP: Landmark3): number {
  const dx = indexMCP.x - pinkyMCP.x;
  const dy = indexMCP.y - pinkyMCP.y;
  return Math.atan2(dy, dx);
}

/**
 * Hand pitch (forward/backward tilt), from the wrist→middle-MCP axis.
 * @returns Radians; 0 = fingers up, positive = tilted forward.
 */
export function calculateHandPitch(wrist: Landmark3, middleMCP: Landmark3): number {
  const dx = middleMCP.x - wrist.x;
  const dy = middleMCP.y - wrist.y;
  return Math.atan2(dx, -dy);
}

/** Clamp a value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation. */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/** Hermite ease-in-out over [0,1]. */
export function smoothStep(x: number): number {
  const clamped = clamp(x, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Map a value from one range to another. Does not clamp. */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const normalized = (value - inMin) / (inMax - inMin);
  return outMin + normalized * (outMax - outMin);
}

/** Shortest signed angular difference from `from` to `to`, in (-π, π]. */
export function signedAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return delta;
}
