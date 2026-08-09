/**
 * Focus timer logic — 25:00 default, pure functions, no clock access inside.
 *
 * Design: inject elapsed time as a parameter so the module is testable without mocking Date.now().
 * The timer counts DOWN from 25:00, never goes negative, and fires completion exactly once.
 */

export interface TimerState {
  /** Epoch ms when the timer was started. null if never started or if reset. */
  startedAt: number | null;
  /** Duration in milliseconds. Default 25 minutes. */
  durationMs: number;
  /** Whether the timer is currently running. */
  running: boolean;
  /** Whether the timer has completed and the completion flag has NOT yet been acknowledged. */
  completed: boolean;
}

export const DEFAULT_DURATION_MS = 25 * 60 * 1000;

export function createTimer(durationMs = DEFAULT_DURATION_MS): TimerState {
  return {
    startedAt: null,
    durationMs,
    running: false,
    completed: false,
  };
}

export function start(state: TimerState, now: number): TimerState {
  if (state.running) return state;
  return {
    ...state,
    startedAt: now,
    running: true,
    completed: false,
  };
}

export function pause(state: TimerState, now: number): TimerState {
  if (!state.running) return state;
  const elapsed = state.startedAt !== null ? now - state.startedAt : 0;
  const remaining = Math.max(0, state.durationMs - elapsed);
  return {
    ...state,
    durationMs: remaining,
    startedAt: null,
    running: false,
  };
}

export function reset(state: TimerState): TimerState {
  return {
    ...state,
    startedAt: null,
    running: false,
    completed: false,
    durationMs: DEFAULT_DURATION_MS,
  };
}

/**
 * Tick — compute the current timer reading.
 * Returns remaining time in ms, never negative. Sets completed flag when time expires.
 */
export function tick(state: TimerState, now: number): TimerState {
  if (!state.running || state.startedAt === null) return state;

  const elapsed = now - state.startedAt;
  const remaining = Math.max(0, state.durationMs - elapsed);

  // Completion fires exactly once: when we cross zero for the first time.
  const justCompleted = remaining === 0 && !state.completed;

  if (justCompleted) {
    return {
      ...state,
      durationMs: 0,
      running: false,
      completed: true,
    };
  }

  return state;
}

/** Format remaining milliseconds as mm:ss. Never shows negative time. */
export function formatTime(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** Compute remaining time from state and current time. */
export function remainingMs(state: TimerState, now: number): number {
  if (!state.running || state.startedAt === null) {
    return state.durationMs;
  }
  const elapsed = now - state.startedAt;
  return Math.max(0, state.durationMs - elapsed);
}
