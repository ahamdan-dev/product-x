/**
 * The ten canonical states, as an actual state machine.
 *
 * WIREFRAME-LAW §2 names exactly ten states and says "anything else is invention." So this file
 * enumerates those ten and nothing more, and every transition is a named event rather than a
 * `setState` scattered across components. The reason that matters here specifically: the builder
 * invariants in §3 are *cross-state* rules — "voice can be entered mid-thread", "exiting the chat
 * box starts a new thread", "the thread temporarily hides while a compact Open transcript control
 * remains". Rules that span states cannot be enforced by components that each own one boolean.
 *
 * Pure. No React, no DOM. That is what makes the invariants testable instead of aspirational.
 */

/** WIREFRAME-LAW §2, verbatim order. */
export type StateId =
  | 'desktop.idle'
  | 'companion.clicked'
  | 'menu.opened'
  | 'chat.pill'
  | 'chat.thread'
  | 'voice'
  | 'imagine'
  | 'activity'
  | 'library'
  | 'settings';

export const ALL_STATES: readonly StateId[] = [
  'desktop.idle', 'companion.clicked', 'menu.opened', 'chat.pill', 'chat.thread',
  'voice', 'imagine', 'activity', 'library', 'settings',
] as const;

/**
 * The states that are a *feature panel* — the ones reached from the radial menu that render a
 * 24/25-radius overlay. Kept as data because three different places need the same answer and a
 * hand-maintained `||` chain in each is how they drift apart.
 */
export const PANEL_STATES: readonly StateId[] = ['imagine', 'activity', 'library', 'settings'] as const;

export type Event =
  | { type: 'companion.click' }
  /** The acknowledgment beat elapsing. Separate from the click so the companion visibly reacts first. */
  | { type: 'bloom' }
  | { type: 'dismiss' }
  | { type: 'open.chat' }
  | { type: 'open.imagine' }
  | { type: 'open.activity' }
  | { type: 'open.library' }
  | { type: 'open.settings' }
  /** Composer gained content or the pill was expanded — the thread becomes visible. */
  | { type: 'thread.expand' }
  | { type: 'thread.minimize' }
  | { type: 'thread.close' }
  | { type: 'voice.start' }
  /** The "Open transcript" pill. Returns to the thread with voice still live. */
  | { type: 'voice.openTranscript' }
  | { type: 'voice.stop' }
  | { type: 'escape' };

/** How long the companion is allowed to just *react* before the menu blooms, ms. */
export const ACK_BEAT_MS = 240;

/**
 * Where `escape` and a panel close land. Not always `desktop.idle`: closing Imagine while a
 * conversation is alive should return you to the conversation, because the thread outliving a
 * side panel is the whole point of a 10-hour session (§7).
 */
export interface Context {
  /** True while a thread exists and has not been exited. Owned by thread.ts. */
  threadAlive: boolean;
  /** True while the mic is live. Voice survives navigating to a panel and back. */
  voiceLive: boolean;
}

const DEFAULT_CONTEXT: Context = { threadAlive: false, voiceLive: false };

/** The state a panel/close returns to, given what is still alive underneath. */
export function restingState(ctx: Context): StateId {
  if (ctx.voiceLive) return 'voice';
  if (ctx.threadAlive) return 'chat.pill';
  return 'desktop.idle';
}

/**
 * Reduce one event. Returns the same state object identity when nothing changes, so a React
 * consumer can bail out of a re-render cheaply.
 */
export function reduce(state: StateId, event: Event, ctx: Context = DEFAULT_CONTEXT): StateId {
  switch (event.type) {
    case 'companion.click':
      // Clicking the companion while a surface is already open is a dismiss, not a re-open — the
      // second click on the same target must undo the first or the companion becomes a trap.
      if (state === 'desktop.idle') return 'companion.clicked';
      if (state === 'companion.clicked' || state === 'menu.opened') return restingState(ctx);
      return 'menu.opened';

    case 'bloom':
      // Only the acknowledgment beat blooms. A stray bloom must never yank a panel away.
      return state === 'companion.clicked' ? 'menu.opened' : state;

    case 'dismiss':
      return restingState(ctx);

    case 'open.chat':
      // §3: an existing thread reopens as a thread; a fresh conversation opens as the pill, because
      // an empty thread panel is a big white rectangle asking to be filled.
      return ctx.threadAlive ? 'chat.thread' : 'chat.pill';

    case 'open.imagine':   return 'imagine';
    case 'open.activity':  return 'activity';
    case 'open.library':   return 'library';
    case 'open.settings':  return 'settings';

    case 'thread.expand':
      // Typing while in voice mode is a barge-in (§3: "user speech/typing interrupts companion
      // speech immediately"), and it lands you back in the thread.
      return state === 'voice' || state === 'chat.pill' || state === 'chat.thread'
        ? 'chat.thread'
        : state;

    case 'thread.minimize':
      return state === 'chat.thread' ? 'chat.pill' : state;

    case 'thread.close':
      // The thread itself is ended by thread.ts; here we only leave the surface.
      return ctx.voiceLive ? 'voice' : 'desktop.idle';

    case 'voice.start':
      return 'voice';

    case 'voice.openTranscript':
      // §3: the thread comes back while voice keeps running.
      return 'chat.thread';

    case 'voice.stop':
      return ctx.threadAlive ? 'chat.thread' : 'desktop.idle';

    case 'escape':
      // One rung down the ladder, never straight to idle — Escape from Settings should not also
      // silently kill a live conversation.
      if (PANEL_STATES.includes(state)) return restingState({ ...ctx, voiceLive: ctx.voiceLive });
      if (state === 'chat.thread') return 'chat.pill';
      if (state === 'voice') return ctx.threadAlive ? 'chat.thread' : 'desktop.idle';
      if (state === 'chat.pill') return 'desktop.idle';
      if (state === 'menu.opened' || state === 'companion.clicked') return restingState(ctx);
      return state;
  }
}

/** Is the companion body itself visible in this state? It is, in all ten — it is never replaced. */
export function companionVisible(_state: StateId): boolean {
  return true;
}

/**
 * §3: "The thread temporarily hides, while a compact 'Open transcript' control remains."
 * True only in voice — this is the single source for that rule.
 */
export function threadHidden(state: StateId): boolean {
  return state === 'voice';
}

/** Does this state paint an overlay panel over the desktop? Idle deliberately does not. */
export function hasOverlay(state: StateId): boolean {
  return state !== 'desktop.idle' && state !== 'companion.clicked';
}
