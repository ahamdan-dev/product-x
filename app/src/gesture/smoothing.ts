/**
 * Smoothing filters for hand tracking.
 *
 * Derived from gesture-lab `src/utils/smoothing.ts` (MIT). See LICENSE-gesture-lab.md.
 * Trimmed to the filters this port actually uses; the Vector3/Quaternion/Euler EMA smoothers
 * were dropped in favour of the One Euro family.
 *
 * Raw MediaPipe landmarks jitter by a few thousandths of a normalized unit even for a hand held
 * perfectly still. Unfiltered, that reads as a cursor that vibrates, and it is the single
 * biggest reason gesture UIs feel cheap. One Euro is the right tool here because its cutoff
 * adapts to speed: heavy smoothing while near-stationary, almost none during a fast swipe, so
 * you get a calm cursor without the rubber-band lag a fixed low-pass would add.
 */

import * as THREE from 'three';

/** Exponential moving average for a scalar. */
export class ScalarSmoother {
  private currentValue: number;
  private smoothingFactor: number;

  /**
   * @param initialValue Starting value.
   * @param smoothingFactor 0 = frozen, 1 = instant. Typical: 0.1-0.3.
   */
  constructor(initialValue = 0, smoothingFactor = 0.15) {
    this.currentValue = initialValue;
    this.smoothingFactor = smoothingFactor;
  }

  update(targetValue: number): number {
    this.currentValue += (targetValue - this.currentValue) * this.smoothingFactor;
    return this.currentValue;
  }

  get value(): number {
    return this.currentValue;
  }

  reset(value: number): void {
    this.currentValue = value;
  }

  setSmoothingFactor(factor: number): void {
    this.smoothingFactor = Math.max(0, Math.min(1, factor));
  }
}

/**
 * Fixed-window moving average. Useful where an EMA still lets through spikes — a boxcar kills
 * single-frame outliers outright, at the cost of a fixed `windowSize/2` frames of lag.
 */
export class MovingAverageFilter {
  private buffer: number[];
  private index = 0;
  private readonly windowSize: number;
  private sum = 0;

  constructor(windowSize = 5) {
    this.windowSize = Math.max(1, Math.floor(windowSize));
    this.buffer = new Array<number>(this.windowSize).fill(0);
  }

  update(value: number): number {
    // `?? 0` satisfies noUncheckedIndexedAccess; index is always in range by construction.
    this.sum -= this.buffer[this.index] ?? 0;
    this.buffer[this.index] = value;
    this.sum += value;
    this.index = (this.index + 1) % this.windowSize;
    return this.sum / this.windowSize;
  }

  reset(initialValue = 0): void {
    this.buffer.fill(initialValue);
    this.sum = initialValue * this.windowSize;
    this.index = 0;
  }
}

/**
 * Single-pole low-pass filter. Internal helper for OneEuroFilter.
 */
class LowPassFilter {
  private _lastValue = 0;
  private _alpha = 1.0;
  private initialized = false;

  get lastValue(): number {
    return this._lastValue;
  }

  setAlpha(alpha: number): void {
    this._alpha = alpha;
  }

  filter(value: number): number {
    if (!this.initialized) {
      this._lastValue = value;
      this.initialized = true;
    } else {
      this._lastValue = this._alpha * value + (1 - this._alpha) * this._lastValue;
    }
    return this._lastValue;
  }

  filterWithAlpha(value: number, alpha: number): number {
    this.setAlpha(alpha);
    return this.filter(value);
  }

  reset(): void {
    this._lastValue = 0;
    this.initialized = false;
  }
}

/**
 * One Euro Filter — a low-pass filter whose cutoff rises with the signal's velocity.
 * @see https://cristal.univ-lille.fr/~casiez/1euro/
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private readonly xFilter = new LowPassFilter();
  private readonly dxFilter = new LowPassFilter();
  private lastTime: number | null = null;

  /**
   * @param minCutoff Minimum cutoff frequency in Hz. Lower = more smoothing at rest.
   * @param beta Speed coefficient. Higher = less lag when moving fast.
   * @param dCutoff Derivative cutoff frequency in Hz.
   */
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  /**
   * @param value Raw input.
   * @param timestamp Time in SECONDS. Passing milliseconds silently disables the filter,
   *   because dt then looks ~1000x larger and alpha saturates at 1.
   */
  filter(value: number, timestamp: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      this.xFilter.setAlpha(1.0);
      this.xFilter.filter(value);
      this.dxFilter.setAlpha(1.0);
      this.dxFilter.filter(0.0);
      return value;
    }

    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;

    if (dt <= 0) return this.xFilter.lastValue;

    const dx = (value - this.xFilter.lastValue) / dt;
    const edx = this.dxFilter.filterWithAlpha(dx, this.alpha(this.dCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filterWithAlpha(value, this.alpha(cutoff, dt));
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  reset(): void {
    this.lastTime = null;
    this.xFilter.reset();
    this.dxFilter.reset();
  }
}

/**
 * One Euro Filter applied per axis of a Vector3.
 *
 * @remarks Returns a reused instance. Clone before storing.
 */
export class Vector3OneEuroFilter {
  private readonly xFilter: OneEuroFilter;
  private readonly yFilter: OneEuroFilter;
  private readonly zFilter: OneEuroFilter;
  private readonly result = new THREE.Vector3();

  /**
   * @param minCutoff Minimum cutoff in Hz. 0.5-2.0 suits hand tracking.
   * @param beta Speed coefficient. 0.5-1.5 feels responsive.
   * @param dCutoff Derivative cutoff in Hz.
   */
  constructor(minCutoff = 1.0, beta = 0.5, dCutoff = 1.0) {
    this.xFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.yFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.zFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  /** @param timestamp Time in seconds. */
  filter(value: THREE.Vector3, timestamp: number): THREE.Vector3 {
    this.result.set(
      this.xFilter.filter(value.x, timestamp),
      this.yFilter.filter(value.y, timestamp),
      this.zFilter.filter(value.z, timestamp),
    );
    return this.result;
  }

  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
    this.zFilter.reset();
  }
}

/**
 * One Euro Filter for an angle, unwrapping across the ±π seam so a hand rotating past π does
 * not produce a full-turn snap in the filtered output.
 */
export class RotationOneEuroFilter {
  private readonly euroFilter: OneEuroFilter;
  private lastValue = 0;
  private initialized = false;

  constructor(minCutoff = 1.5, beta = 0.8, dCutoff = 1.0) {
    this.euroFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  /**
   * @param value Raw angle in radians.
   * @param timestamp Time in seconds.
   */
  filter(value: number, timestamp: number): number {
    if (!this.initialized) {
      this.lastValue = value;
      this.initialized = true;
      return this.euroFilter.filter(value, timestamp);
    }

    let delta = value - this.lastValue;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;

    const unwrapped = this.lastValue + delta;
    const filtered = this.euroFilter.filter(unwrapped, timestamp);

    this.lastValue = value;
    return filtered;
  }

  reset(): void {
    this.euroFilter.reset();
    this.lastValue = 0;
    this.initialized = false;
  }
}
