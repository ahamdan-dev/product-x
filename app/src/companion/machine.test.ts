import { describe, it, expect } from 'vitest';
import {
  ALL_STATES, PANEL_STATES, reduce, restingState, threadHidden, hasOverlay, companionVisible,
  type StateId, type Context,
} from './machine';

const IDLE: Context = { threadAlive: false, voiceLive: false };
const THREADED: Context = { threadAlive: true, voiceLive: false };
const VOICED: Context = { threadAlive: true, voiceLive: true };

describe('the ten canonical states', () => {
  it('declares exactly the ten WIREFRAME-LAW §2 names, in order', () => {
    expect(ALL_STATES).toEqual([
      'desktop.idle', 'companion.clicked', 'menu.opened', 'chat.pill', 'chat.thread',
      'voice', 'imagine', 'activity', 'library', 'settings',
    ]);
  });

  it('is reachable in full: every state has an inbound transition', () => {
    const reachable = new Set<StateId>(['desktop.idle']);
    const events = [
      { type: 'companion.click' }, { type: 'bloom' }, { type: 'open.chat' },
      { type: 'open.imagine' }, { type: 'open.activity' }, { type: 'open.library' },
      { type: 'open.settings' }, { type: 'thread.expand' }, { type: 'voice.start' },
    ] as const;
    // Fixed point over both contexts, since some edges only exist with a live thread.
    for (let pass = 0; pass < 4; pass++) {
      for (const s of [...reachable]) {
        for (const e of events) {
          reachable.add(reduce(s, e, IDLE));
          reachable.add(reduce(s, e, THREADED));
        }
      }
    }
    for (const s of ALL_STATES) expect([...reachable]).toContain(s);
  });

  it('keeps the companion visible in all ten — it is never replaced', () => {
    for (const s of ALL_STATES) expect(companionVisible(s)).toBe(true);
  });
});

describe('click → acknowledge → bloom', () => {
  it('does not bloom the menu on the same beat as the click', () => {
    expect(reduce('desktop.idle', { type: 'companion.click' }, IDLE)).toBe('companion.clicked');
  });

  it('blooms only from the acknowledgment state', () => {
    expect(reduce('companion.clicked', { type: 'bloom' }, IDLE)).toBe('menu.opened');
    // A stray bloom must not yank an open panel away.
    for (const s of PANEL_STATES) expect(reduce(s, { type: 'bloom' }, IDLE)).toBe(s);
  });

  it('treats a second click on the companion as a dismiss', () => {
    expect(reduce('menu.opened', { type: 'companion.click' }, IDLE)).toBe('desktop.idle');
    expect(reduce('companion.clicked', { type: 'companion.click' }, IDLE)).toBe('desktop.idle');
  });

  it('dismisses back to the conversation when one is alive, not to idle', () => {
    expect(reduce('menu.opened', { type: 'companion.click' }, THREADED)).toBe('chat.pill');
    expect(reduce('menu.opened', { type: 'dismiss' }, VOICED)).toBe('voice');
  });
});

describe('§3 — chat pill and thread', () => {
  it('opens a fresh conversation as the pill, not an empty thread panel', () => {
    expect(reduce('menu.opened', { type: 'open.chat' }, IDLE)).toBe('chat.pill');
  });

  it('reopens an existing conversation as the thread', () => {
    expect(reduce('menu.opened', { type: 'open.chat' }, THREADED)).toBe('chat.thread');
  });

  it('minimizes the thread to the pill, keeping the conversation', () => {
    expect(reduce('chat.thread', { type: 'thread.minimize' }, THREADED)).toBe('chat.pill');
  });

  it('leaves the surface entirely on close', () => {
    expect(reduce('chat.thread', { type: 'thread.close' }, THREADED)).toBe('desktop.idle');
  });

  it('keeps voice running when the thread is closed under it', () => {
    expect(reduce('chat.thread', { type: 'thread.close' }, VOICED)).toBe('voice');
  });
});

describe('§3 — voice', () => {
  it('can be entered mid-thread', () => {
    expect(reduce('chat.thread', { type: 'voice.start' }, THREADED)).toBe('voice');
  });

  it('hides the thread only in voice mode', () => {
    expect(threadHidden('voice')).toBe(true);
    for (const s of ALL_STATES.filter(s => s !== 'voice')) expect(threadHidden(s)).toBe(false);
  });

  it('restores the thread via Open transcript while voice stays live', () => {
    expect(reduce('voice', { type: 'voice.openTranscript' }, VOICED)).toBe('chat.thread');
  });

  it('treats typing during voice as a barge-in back into the thread', () => {
    expect(reduce('voice', { type: 'thread.expand' }, VOICED)).toBe('chat.thread');
  });

  it('returns to the thread when voice stops, or to idle with nothing said', () => {
    expect(reduce('voice', { type: 'voice.stop' }, THREADED)).toBe('chat.thread');
    expect(reduce('voice', { type: 'voice.stop' }, IDLE)).toBe('desktop.idle');
  });
});

describe('escape walks one rung down the ladder', () => {
  it('never kills a live conversation by closing a side panel', () => {
    for (const s of PANEL_STATES) {
      expect(reduce(s, { type: 'escape' }, THREADED)).toBe('chat.pill');
      expect(reduce(s, { type: 'escape' }, VOICED)).toBe('voice');
      expect(reduce(s, { type: 'escape' }, IDLE)).toBe('desktop.idle');
    }
  });

  it('steps thread → pill → idle rather than jumping straight out', () => {
    expect(reduce('chat.thread', { type: 'escape' }, THREADED)).toBe('chat.pill');
    expect(reduce('chat.pill', { type: 'escape' }, THREADED)).toBe('desktop.idle');
  });

  it('is idempotent at the bottom of the ladder', () => {
    expect(reduce('desktop.idle', { type: 'escape' }, IDLE)).toBe('desktop.idle');
  });
});

describe('overlay discipline', () => {
  it('paints no overlay while idle or merely acknowledging', () => {
    expect(hasOverlay('desktop.idle')).toBe(false);
    expect(hasOverlay('companion.clicked')).toBe(false);
  });

  it('paints an overlay for every other state', () => {
    for (const s of ALL_STATES.filter(s => s !== 'desktop.idle' && s !== 'companion.clicked')) {
      expect(hasOverlay(s)).toBe(true);
    }
  });
});

describe('restingState', () => {
  it('prefers voice, then the thread, then the desktop', () => {
    expect(restingState(VOICED)).toBe('voice');
    expect(restingState(THREADED)).toBe('chat.pill');
    expect(restingState(IDLE)).toBe('desktop.idle');
  });
});
