import { describe, it, expect, beforeEach } from 'vitest';
import {
  THREAD_MAX_MS, initThreadState, newThread, threadExpired, threadAlive, exitChat,
  sendUser, sendCompanion, liveMessage, updateLive, finalizeLive, interruptCompanion,
  composerAffordance, formatSize, kindForFile, __resetIds,
} from './thread';

const T0 = 1_700_000_000_000;

beforeEach(() => __resetIds());

describe('§7 — one thread for up to 10 hours', () => {
  it('sets the window to exactly ten hours', () => {
    expect(THREAD_MAX_MS).toBe(36_000_000);
  });

  it('does not expire inside the window', () => {
    const t = newThread(T0);
    expect(threadExpired(t, T0 + THREAD_MAX_MS - 1)).toBe(false);
  });

  it('expires at the boundary', () => {
    const t = newThread(T0);
    expect(threadExpired(t, T0 + THREAD_MAX_MS)).toBe(true);
  });

  it('rolls to a new thread when a message lands past the window, archiving the old one', () => {
    let s = initThreadState(T0);
    s = sendUser(s, 'first', T0);
    const firstId = s.current.id;
    s = sendUser(s, 'much later', T0 + THREAD_MAX_MS + 1);
    expect(s.current.id).not.toBe(firstId);
    expect(s.archived).toHaveLength(1);
    expect(s.archived[0]?.messages.map(m => m.text)).toEqual(['first']);
    expect(s.current.messages.map(m => m.text)).toEqual(['much later']);
  });
});

describe('§7 — exiting the chat box starts a new thread', () => {
  it('archives the conversation and starts fresh', () => {
    let s = initThreadState(T0);
    s = sendUser(s, 'hello', T0);
    const id = s.current.id;
    s = exitChat(s, T0 + 5_000);
    expect(s.current.id).not.toBe(id);
    expect(s.current.messages).toHaveLength(0);
    expect(s.archived).toHaveLength(1);
  });

  it('does not litter history with empty threads', () => {
    let s = initThreadState(T0);
    s = exitChat(s, T0 + 1_000);
    s = exitChat(s, T0 + 2_000);
    expect(s.archived).toHaveLength(0);
  });

  it('reports alive only once something has been said', () => {
    let s = initThreadState(T0);
    expect(threadAlive(s)).toBe(false);
    s = sendUser(s, 'hi', T0);
    expect(threadAlive(s)).toBe(true);
  });
});

describe('§7 — typed and spoken share one transcript', () => {
  it('appends both channels to the same thread in order', () => {
    let s = initThreadState(T0);
    s = sendUser(s, 'typed question', T0, { channel: 'typed' });
    s = sendCompanion(s, 'answer', T0 + 1_000);
    s = sendUser(s, 'spoken follow-up', T0 + 2_000, { channel: 'spoken' });
    expect(s.current.messages.map(m => `${m.author}:${m.channel}`)).toEqual([
      'user:typed', 'companion:typed', 'user:spoken',
    ]);
    expect(s.archived).toHaveLength(0);
  });

  it('writes voice into the transcript live, then finalizes in place', () => {
    let s = initThreadState(T0);
    s = sendUser(s, 'pyelo', T0, { channel: 'spoken', live: true });
    expect(liveMessage(s)?.text).toBe('pyelo');
    s = updateLive(s, 'pyelonephritis');
    expect(s.current.messages).toHaveLength(1);
    expect(liveMessage(s)?.text).toBe('pyelonephritis');
    s = finalizeLive(s);
    expect(liveMessage(s)).toBeNull();
    expect(s.current.messages[0]?.live).toBe(false);
  });
});

describe('§3 — user speech or typing interrupts companion speech immediately', () => {
  it('marks an in-flight companion message interrupted and keeps what was heard', () => {
    let s = initThreadState(T0);
    s = sendCompanion(s, 'The mechanism begins with', T0, { live: true });
    s = sendUser(s, 'wait', T0 + 400);
    const [first, second] = s.current.messages;
    expect(first?.interrupted).toBe(true);
    expect(first?.live).toBe(false);
    expect(first?.text).toBe('The mechanism begins with');
    expect(second?.text).toBe('wait');
  });

  it('drops an empty in-flight bubble rather than leaving a blank in the transcript', () => {
    let s = initThreadState(T0);
    s = sendCompanion(s, '', T0, { live: true });
    s = sendUser(s, 'actually', T0 + 100);
    expect(s.current.messages.map(m => m.author)).toEqual(['user']);
  });

  it('leaves a finished companion message alone', () => {
    let s = initThreadState(T0);
    s = sendCompanion(s, 'done speaking', T0);
    s = sendUser(s, 'thanks', T0 + 1_000);
    expect(s.current.messages[0]?.interrupted).toBe(false);
  });

  it('never marks the user as interrupting themselves', () => {
    let s = initThreadState(T0);
    s = sendUser(s, 'half a th', T0, { channel: 'spoken', live: true });
    s = interruptCompanion(s, T0 + 50);
    expect(s.current.messages[0]?.interrupted).toBe(false);
    expect(s.current.messages[0]?.live).toBe(true);
  });
});

describe('§3 — composer affordance', () => {
  it('shows the waveform when empty', () => {
    expect(composerAffordance('')).toBe('waveform');
  });

  it('shows the waveform for whitespace only, so it does not flicker on space', () => {
    expect(composerAffordance('   ')).toBe('waveform');
    expect(composerAffordance('\n\t')).toBe('waveform');
  });

  it('shows send for any real text', () => {
    expect(composerAffordance('a')).toBe('send');
    expect(composerAffordance('  hi  ')).toBe('send');
  });
});

describe('§8 — attachments', () => {
  it('maps every one of the six chip types from a filename', () => {
    expect(kindForFile('slide.PNG')).toBe('image');
    expect(kindForFile('lecture.m4a')).toBe('audio');
    expect(kindForFile('case.mov')).toBe('video');
    expect(kindForFile('first-aid.pdf')).toBe('pdf');
    expect(kindForFile('deck.pptx')).toBe('ppt');
    expect(kindForFile('scores.xlsx')).toBe('excel');
  });

  it('is honest about unknown types instead of guessing', () => {
    expect(kindForFile('notes.anki2')).toBe('file');
    expect(kindForFile('noextension')).toBe('file');
  });

  it('formats sizes for a chip', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(15 * 1024)).toBe('15 KB');
    expect(formatSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  it('carries attachments on the message that sent them', () => {
    let s = initThreadState(T0);
    s = sendUser(s, 'look at this', T0, {
      attachments: [{ id: 'a1', kind: 'pdf', name: 'renal.pdf', size: 1024 }],
    });
    expect(s.current.messages[0]?.attachments[0]?.name).toBe('renal.pdf');
  });
});
