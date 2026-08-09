/**
 * HandTracker — owns the webcam and the MediaPipe HandLandmarker.
 *
 * Derived from gesture-lab `src/shared/HandTracker.ts` (MIT). See LICENSE-gesture-lab.md.
 *
 * Changes from upstream:
 *   - No `console` calls. Diagnostics go to an injected sink that defaults to a no-op.
 *   - `stop()` releases the camera but keeps the WASM landmarker alive, so toggling the camera
 *     off and on is cheap. `dispose()` is the full teardown.
 *   - Camera errors are classified into a typed `CameraFailure` exposed as `lastFailure`,
 *     instead of being logged and forgotten.
 *   - Model and WASM paths are configurable and default to app-local assets.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  DEFAULT_HAND_TRACKER_CONFIG,
  type CameraFailure,
  type DiagnosticSink,
  type HandLandmarks,
  type Handedness,
  type HandTrackerConfig,
} from './handTypes';

/** Landmarks plus attribution for one detection frame, in the shape the pilot consumes. */
export interface TrackedHands {
  /** One entry per detected hand, 21 landmarks each. */
  hands: HandLandmarks[];
  /** Handedness per hand, index-aligned with `hands`. */
  handedness: Handedness[];
  /** Mean handedness classification score across detected hands; 0 when nothing is detected. */
  confidence: number;
}

export interface HandTrackerOptions extends Partial<HandTrackerConfig> {
  /** Where to send diagnostics. Defaults to a no-op — nothing is written to the console. */
  onDiagnostic?: DiagnosticSink;
}

const EMPTY_TRACKED: TrackedHands = { hands: [], handedness: [], confidence: 0 };

/** Video `readyState` at or above which there is decoded frame data to sample. */
const HAVE_CURRENT_DATA = 2;

export class HandTracker {
  private handLandmarker: HandLandmarker | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private config: HandTrackerConfig;
  private readonly diagnostic: DiagnosticSink;

  private _isReady = false;
  private _isCameraEnabled = false;
  private _lastFailure: CameraFailure | null = null;

  private detectionIntervalMs = 0;
  private lastResult: HandLandmarkerResult | null = null;

  /**
   * MediaPipe hard-requires strictly increasing timestamps and throws otherwise, so the last
   * one handed to `detectForVideo` is tracked and non-advancing calls return the cached result.
   */
  private lastDetectForVideoTimestamp = -1;

  /**
   * A single shared HandLandmarker for the whole process.
   *
   * Each `HandLandmarker.createFromOptions` call allocates its own WASM heap (tens of MB, plus
   * a GPU context). Creating a second one — which happens easily under React StrictMode double
   * mounts or a hot reload — reliably OOMs the renderer. Every HandTracker instance therefore
   * borrows this one, and `dispose()` never closes it.
   */
  private static sharedHandLandmarker: HandLandmarker | null = null;
  /** Init lock, so two trackers constructed in the same tick don't both build a landmarker. */
  private static initializationPromise: Promise<void> | null = null;

  constructor(options: HandTrackerOptions = {}) {
    const { onDiagnostic, ...config } = options;
    this.config = { ...DEFAULT_HAND_TRACKER_CONFIG, ...config };
    this.diagnostic = onDiagnostic ?? (() => {});
  }

  /** How long to wait between real detections. 0 runs detection on every call. */
  setDetectionIntervalMs(intervalMs: number): void {
    this.detectionIntervalMs = Math.max(0, intervalMs);
  }

  getDetectionIntervalMs(): number {
    return this.detectionIntervalMs;
  }

  /**
   * Initialize the landmarker and the webcam.
   *
   * The two run in parallel because model download and permission prompt are independent and
   * each costs hundreds of milliseconds. A camera failure does not reject: the app stays usable
   * without hand tracking, and the reason is available on `lastFailure`.
   */
  async initialize(videoElement: HTMLVideoElement): Promise<void> {
    this.videoElement = videoElement;

    await Promise.all([this.initializeHandLandmarker(), this.startCamera()]);

    this._isReady = true;
  }

  private async initializeHandLandmarker(): Promise<void> {
    if (HandTracker.sharedHandLandmarker) {
      this.handLandmarker = HandTracker.sharedHandLandmarker;
      this.diagnostic('info', 'Reusing shared HandLandmarker instance');
      return;
    }

    if (HandTracker.initializationPromise) {
      await HandTracker.initializationPromise;
      if (HandTracker.sharedHandLandmarker) {
        this.handLandmarker = HandTracker.sharedHandLandmarker;
        return;
      }
    }

    try {
      HandTracker.initializationPromise = (async () => {
        // Local WASM assets, never the CDN: the runtime and the .task model must be version
        // matched or MediaPipe fails with an opaque WebAssembly LinkError.
        const vision = await FilesetResolver.forVisionTasks(this.config.wasmPath);

        HandTracker.sharedHandLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: this.config.modelAssetPath,
            delegate: this.config.delegate,
          },
          runningMode: 'VIDEO',
          numHands: this.config.numHands,
          minHandDetectionConfidence: this.config.minHandDetectionConfidence,
          minHandPresenceConfidence: this.config.minHandPresenceConfidence,
          minTrackingConfidence: this.config.minTrackingConfidence,
        });
      })();

      await HandTracker.initializationPromise;
      this.handLandmarker = HandTracker.sharedHandLandmarker;
      this.diagnostic('info', 'MediaPipe HandLandmarker initialized');
    } catch (error) {
      // Clear the lock so a later attempt can retry instead of awaiting a dead promise.
      HandTracker.initializationPromise = null;
      this.diagnostic('error', `HandLandmarker initialization failed: ${describe(error)}`);
      throw new Error(`MediaPipe initialization failed: ${describe(error)}`);
    }
  }

  /**
   * Acquire the camera. Safe to call again after `stop()` — that is the cheap re-enable path,
   * since the landmarker and its WASM heap are untouched.
   */
  async startCamera(): Promise<boolean> {
    if (!this.videoElement) {
      this._lastFailure = 'unknown';
      this.diagnostic('error', 'startCamera called before a video element was attached');
      return false;
    }
    if (this._isCameraEnabled && this.stream) return true;

    if (!navigator.mediaDevices?.getUserMedia) {
      this._lastFailure = 'unsupported';
      this.diagnostic('error', 'getUserMedia is unavailable in this environment');
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      const video = this.videoElement;
      video.srcObject = this.stream;
      video.playsInline = true;
      video.muted = true;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(resolve).catch(reject);
        };
        video.onerror = () => reject(new Error('Video load error'));
      });

      this._isCameraEnabled = true;
      this._lastFailure = null;
      this.diagnostic(
        'info',
        `Webcam started at ${video.videoWidth}x${video.videoHeight}`,
      );
      return true;
    } catch (error) {
      this._isCameraEnabled = false;
      this.releaseStream();
      this._lastFailure = classifyCameraError(error);
      this.diagnostic('error', `Camera failed (${this._lastFailure}): ${describe(error)}`);
      // Deliberately not re-thrown: the app runs without a camera, degraded but alive.
      return false;
    }
  }

  /**
   * Release the camera without tearing down MediaPipe. Keeping the WASM landmarker resident is
   * the whole point — re-acquiring a camera costs milliseconds, rebuilding the landmarker costs
   * a model load and risks a second heap.
   */
  stop(): void {
    this.releaseStream();
    if (this.videoElement) this.videoElement.srcObject = null;
    this._isCameraEnabled = false;
    // Cached landmarks describe a frame that no longer exists; drop them so a stale hand can't
    // keep driving intents after the camera goes away.
    this.lastResult = null;
    this.lastDetectForVideoTimestamp = -1;
    this.diagnostic('info', 'Camera stopped; landmarker retained');
  }

  private releaseStream(): void {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
  }

  /**
   * Detect hands in the current video frame.
   * @param timestamp Monotonically increasing ms clock, e.g. from `requestAnimationFrame`.
   */
  detectHands(timestamp: number): HandLandmarkerResult | null {
    if (!this._isReady || !this.handLandmarker || !this.videoElement) return null;
    if (!this._isCameraEnabled) return null;
    if (this.videoElement.readyState < HAVE_CURRENT_DATA) return null;

    // MediaPipe requires strictly increasing timestamps ("timestamp must be monotonically
    // increasing"), and two render callbacks in the same millisecond do happen. Serve cache.
    if (timestamp <= this.lastDetectForVideoTimestamp) return this.lastResult;

    // Throttle the expensive inference call to protect frame time; the render loop keeps
    // running at display rate off the cached result.
    if (
      this.detectionIntervalMs > 0 &&
      this.lastDetectForVideoTimestamp >= 0 &&
      timestamp - this.lastDetectForVideoTimestamp < this.detectionIntervalMs
    ) {
      return this.lastResult;
    }

    try {
      // Synchronous in VIDEO running mode.
      const result = this.handLandmarker.detectForVideo(this.videoElement, timestamp);
      this.lastDetectForVideoTimestamp = timestamp;
      this.lastResult = result;
      return result;
    } catch (error) {
      this.diagnostic('error', `Detection failed: ${describe(error)}`);
      return null;
    }
  }

  /** Detect and reduce to the small shape the pilot consumes. */
  readHands(timestamp: number): TrackedHands {
    return toTrackedHands(this.detectHands(timestamp));
  }

  isReady(): boolean {
    return this._isReady;
  }

  isCameraEnabled(): boolean {
    return this._isCameraEnabled;
  }

  /** Why the last camera attempt failed, or null if the camera is fine. */
  get lastFailure(): CameraFailure | null {
    return this._lastFailure;
  }

  getLastResult(): HandLandmarkerResult | null {
    return this.lastResult;
  }

  getVideoDimensions(): { width: number; height: number } | null {
    if (!this.videoElement) return null;
    return { width: this.videoElement.videoWidth, height: this.videoElement.videoHeight };
  }

  /**
   * Full teardown of this tracker. The shared landmarker is intentionally left open: another
   * component may still hold it, and rebuilding the WASM heap is the OOM risk this class exists
   * to avoid. Use `HandTracker.destroyShared()` only when the process is genuinely done.
   */
  dispose(): void {
    this.stop();
    this.handLandmarker = null;
    this.videoElement = null;
    this._isReady = false;
    this.diagnostic('info', 'Disposed');
  }

  /** Release the process-wide landmarker. Only safe when no tracker is in use. */
  static destroyShared(): void {
    HandTracker.sharedHandLandmarker?.close();
    HandTracker.sharedHandLandmarker = null;
    HandTracker.initializationPromise = null;
  }
}

/**
 * Reduce a raw MediaPipe result to landmarks + handedness + confidence.
 *
 * Caveat worth knowing: MediaPipe labels handedness as if the image were already mirrored
 * (selfie view). This app does not mirror the video pixels, so the label matches what the user
 * calls that hand, which is what we want — but it is the opposite of what a naive reading of a
 * non-mirrored frame would suggest.
 */
export function toTrackedHands(result: HandLandmarkerResult | null): TrackedHands {
  if (!result || result.landmarks.length === 0) return EMPTY_TRACKED;

  const hands: HandLandmarks[] = [];
  const handedness: Handedness[] = [];
  let scoreSum = 0;

  for (let i = 0; i < result.landmarks.length; i++) {
    const marks = result.landmarks[i];
    if (!marks || marks.length === 0) continue;
    hands.push(marks);

    const category = result.handedness[i]?.[0];
    handedness.push(readHandedness(category?.categoryName));
    scoreSum += category?.score ?? 0;
  }

  if (hands.length === 0) return EMPTY_TRACKED;
  return { hands, handedness, confidence: scoreSum / hands.length };
}

function readHandedness(categoryName: string | undefined): Handedness {
  if (categoryName === 'Left') return 'left';
  if (categoryName === 'Right') return 'right';
  return 'unknown';
}

/** Map a getUserMedia rejection to something the UI can put in front of a person. */
export function classifyCameraError(error: unknown): CameraFailure {
  const name =
    error instanceof DOMException || error instanceof Error
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'not-found';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'in-use';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
