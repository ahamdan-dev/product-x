/**
 * Hand tracking type definitions.
 * Based on MediaPipe Tasks Vision HandLandmarker.
 * @see https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js
 *
 * Derived from gesture-lab `src/shared/HandTypes.ts` (MIT). See LICENSE-gesture-lab.md.
 */

/** Hand identifier used for gesture attribution. */
export type Handedness = 'left' | 'right' | 'unknown';

/**
 * A single 3D landmark in MediaPipe's normalized space: x,y in [0,1] relative to the image,
 * z as depth relative to the wrist (negative = toward the camera).
 *
 * Deliberately structural and narrower than MediaPipe's own `NormalizedLandmark`, which also
 * carries a required `visibility`. MediaPipe's type is assignable to this one, so real results
 * flow straight in — while tests and synthetic input don't have to fabricate a `visibility`
 * value that the detection math never reads.
 */
export interface Landmark3 {
  x: number;
  y: number;
  z: number;
}

/** One hand's worth of landmarks. Always 21 entries when it comes from MediaPipe. */
export type HandLandmarks = readonly Landmark3[];

/**
 * MediaPipe hand landmark indices.
 * @see https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker#hand_landmark_model
 */
export const HandLandmarkIndex = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5,
  INDEX_FINGER_PIP: 6,
  INDEX_FINGER_DIP: 7,
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
  MIDDLE_FINGER_PIP: 10,
  MIDDLE_FINGER_DIP: 11,
  MIDDLE_FINGER_TIP: 12,
  RING_FINGER_MCP: 13,
  RING_FINGER_PIP: 14,
  RING_FINGER_DIP: 15,
  RING_FINGER_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export type HandLandmarkIndexType = (typeof HandLandmarkIndex)[keyof typeof HandLandmarkIndex];

/** Number of landmarks MediaPipe emits per hand. */
export const LANDMARK_COUNT = 21;

/** Configuration for the MediaPipe HandLandmarker and its webcam. */
export interface HandTrackerConfig {
  /** Path to the `hand_landmarker.task` model file. */
  modelAssetPath: string;
  /** Directory containing the MediaPipe vision WASM bundle. */
  wasmPath: string;
  /** Hardware delegate preference. */
  delegate: 'GPU' | 'CPU';
  /** Maximum number of hands to detect (1-2). */
  numHands: number;
  /** Minimum confidence for hand detection (0-1). */
  minHandDetectionConfidence: number;
  /** Minimum confidence for hand presence (0-1). */
  minHandPresenceConfidence: number;
  /** Minimum confidence for hand tracking (0-1). */
  minTrackingConfidence: number;
}

/**
 * Defaults point at app-local assets rather than Google's CDN. This app ships as a desktop
 * build that must work offline, and a version mismatch between a CDN model and the bundled
 * WASM runtime surfaces as an opaque LinkError at load time.
 */
export const DEFAULT_HAND_TRACKER_CONFIG: HandTrackerConfig = {
  modelAssetPath: '/vendor/mediapipe/hand_landmarker.task',
  wasmPath: '/vendor/mediapipe/wasm',
  delegate: 'GPU',
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

/** Why a camera start attempt failed, in terms the UI can actually explain to a user. */
export type CameraFailure = 'denied' | 'not-found' | 'in-use' | 'unsupported' | 'unknown';

/** Human-readable text for each failure mode. Copy lives here so the UI stays dumb. */
export const CAMERA_FAILURE_MESSAGE: Record<CameraFailure, string> = {
  denied: 'Camera permission was denied. Allow camera access to use hand tracking.',
  'not-found': 'No camera was found. Connect a camera and try again.',
  'in-use': 'The camera is being used by another application.',
  unsupported: 'This camera cannot meet the requested video format.',
  unknown: 'The camera could not be started.',
};

/** Severity for the injectable diagnostic sink. */
export type DiagnosticLevel = 'info' | 'warn' | 'error';

/**
 * Diagnostics are injected rather than written to `console`. A shipping desktop app should not
 * spam the devtools console, and the host decides whether these go to a log file, a debug
 * overlay, or nowhere.
 */
export type DiagnosticSink = (level: DiagnosticLevel, msg: string) => void;
