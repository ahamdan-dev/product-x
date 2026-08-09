import { describe, it, expect } from 'vitest';
import {
  createTimer,
  start,
  pause,
  reset,
  tick,
  formatTime,
  remainingMs,
  DEFAULT_DURATION_MS,
} from './focusTimer';

describe('focusTimer', () => {
  describe('createTimer', () => {
    it('creates a timer with default duration', () => {
      const timer = createTimer();
      expect(timer.durationMs).toBe(25 * 60 * 1000);
      expect(timer.running).toBe(false);
      expect(timer.completed).toBe(false);
      expect(timer.startedAt).toBe(null);
    });

    it('creates a timer with custom duration', () => {
      const timer = createTimer(10 * 60 * 1000);
      expect(timer.durationMs).toBe(10 * 60 * 1000);
    });
  });

  describe('start', () => {
    it('starts a new timer', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      expect(started.running).toBe(true);
      expect(started.startedAt).toBe(now);
      expect(started.completed).toBe(false);
    });

    it('is idempotent when already running', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      const again = start(started, now + 5000);
      expect(again.startedAt).toBe(now);
    });
  });

  describe('pause', () => {
    it('pauses a running timer and preserves remaining time', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      const paused = pause(started, now + 60000); // 1 minute elapsed

      expect(paused.running).toBe(false);
      expect(paused.startedAt).toBe(null);
      expect(paused.durationMs).toBe(DEFAULT_DURATION_MS - 60000);
    });

    it('does nothing if not running', () => {
      const timer = createTimer();
      const paused = pause(timer, 1000000);
      expect(paused).toEqual(timer);
    });

    it('never produces negative duration', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      const paused = pause(started, now + DEFAULT_DURATION_MS + 10000);

      expect(paused.durationMs).toBe(0);
    });
  });

  describe('reset', () => {
    it('resets to default duration and stops', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      const r = reset(started);

      expect(r.running).toBe(false);
      expect(r.startedAt).toBe(null);
      expect(r.completed).toBe(false);
      expect(r.durationMs).toBe(DEFAULT_DURATION_MS);
    });
  });

  describe('tick', () => {
    it('does nothing if not running', () => {
      const timer = createTimer();
      const now = 1000000;
      const ticked = tick(timer, now);
      expect(ticked).toEqual(timer);
    });

    it('completes when time expires', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      const completed = tick(started, now + DEFAULT_DURATION_MS);

      expect(completed.completed).toBe(true);
      expect(completed.running).toBe(false);
    });

    it('fires completion exactly once', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      const first = tick(started, now + DEFAULT_DURATION_MS);
      const second = tick(first, now + DEFAULT_DURATION_MS + 5000);

      expect(first.completed).toBe(true);
      expect(second.completed).toBe(true); // flag stays set
    });

    it('never shows negative time', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      const wayOver = tick(started, now + DEFAULT_DURATION_MS * 2);

      expect(remainingMs(wayOver, now + DEFAULT_DURATION_MS * 2)).toBe(0);
    });
  });

  describe('formatTime', () => {
    it('formats 25:00', () => {
      expect(formatTime(25 * 60 * 1000)).toBe('25:00');
    });

    it('formats 00:00', () => {
      expect(formatTime(0)).toBe('00:00');
    });

    it('formats 01:05', () => {
      expect(formatTime(65 * 1000)).toBe('01:05');
    });

    it('formats 10:42', () => {
      expect(formatTime(10 * 60 * 1000 + 42 * 1000)).toBe('10:42');
    });

    it('never shows negative time', () => {
      expect(formatTime(-5000)).toBe('00:00');
    });
  });

  describe('remainingMs', () => {
    it('returns full duration when not running', () => {
      const timer = createTimer();
      expect(remainingMs(timer, 0)).toBe(DEFAULT_DURATION_MS);
    });

    it('returns remaining time when running', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      expect(remainingMs(started, now + 60000)).toBe(DEFAULT_DURATION_MS - 60000);
    });

    it('never returns negative', () => {
      const timer = createTimer();
      const now = 1000000;
      const started = start(timer, now);
      expect(remainingMs(started, now + DEFAULT_DURATION_MS + 10000)).toBe(0);
    });
  });
});
