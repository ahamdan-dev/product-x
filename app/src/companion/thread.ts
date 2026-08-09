/**
 * The conversation thread — one transcript across text and voice.
 *
 * Four quoted rules from WIREFRAME-LAW live here, and nowhere else:
 *
 *   §7 "Continue one thread for up to 10 hours"
 *   §7 "Start a new thread whenever the chat box is exited."
 *   §7 "Voice always writes into the chat transcript" / "Typed and spoken messages share the
 *      same thread."
 *   §3 "User speech/typing interrupts companion speech immediately."
 *
 * They are implemented as one pure module because they interact: a voice utterance arriving at
 * hour 10 must roll the thread the same way a typed one does, and an interruption has to truncate
 * the companion's in-flight message *in the transcript*, not just stop the audio. Splitting these
 * across the UI is how you end up with a transcript that disagrees with what was said.
 */

/** Ten hours, in ms. §7. */
export const THREAD_MAX_MS = 10 * 60 * 60 * 1000;

export type Author = 'user' | 'companion';
/** How the message got here. Both land in the same thread — that is the invariant. */
export type Channel = 'typed' | 'spoken';

export interface Attachment {
  id: string;
  /** §8's six chips. `file` covers "documents and other study/work files". */
  kind: 'image' | 'audio' | 'video' | 'pdf' | 'ppt' | 'excel' | 'file';
  name: string;
  /** Bytes. Shown as a human size on the chip. */
  size: number;
}

export interface Message {
  id: string;
  author: Author;
  channel: Channel;
  text: string;
  at: number;
  attachments: Attachment[];
  /** True when the companion was cut off mid-sentence. The UI marks it rather than hiding it. */
  interrupted: boolean;
  /** True while a spoken message is still being transcribed — renders as a live transcript. */
  live: boolean;
}

export interface Thread {
  id: string;
  startedAt: number;
  messages: Message[];
}

export interface ThreadState {
  current: Thread;
  /** Threads the user already left. Kept so Library/Activity can reference real history. */
  archived: Thread[];
}

let seq = 0;
/** Deterministic ids. `Math.random` in a message key makes snapshot tests useless. */
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}.${seq}`;
}

/** Test seam: reset the id counter so each test file starts from a known point. */
export function __resetIds(): void {
  seq = 0;
}

export function newThread(now: number): Thread {
  return { id: nextId('thread'), startedAt: now, messages: [] };
}

export function initThreadState(now: number): ThreadState {
  return { current: newThread(now), archived: [] };
}

/** §7's 10-hour rule, as a question the reducer can ask. */
export function threadExpired(thread: Thread, now: number): boolean {
  return now - thread.startedAt >= THREAD_MAX_MS;
}

/** True once anything has been said. An empty thread is not "alive" — nothing to preserve. */
export function threadAlive(state: ThreadState): boolean {
  return state.current.messages.length > 0;
}

/**
 * Roll to a fresh thread if the 10-hour window has closed. An empty thread is *not* archived —
 * archiving nothing would litter history with blanks every time the user opened and closed the pill.
 */
function rollIfExpired(state: ThreadState, now: number): ThreadState {
  if (!threadExpired(state.current, now)) return state;
  return {
    current: newThread(now),
    archived: state.current.messages.length > 0 ? [...state.archived, state.current] : state.archived,
  };
}

/**
 * §7: "Start a new thread whenever the chat box is exited."
 * Called on thread.close — NOT on minimize, because minimizing to the pill is explicitly still the
 * same conversation (the pill is where a thread lives between turns).
 */
export function exitChat(state: ThreadState, now: number): ThreadState {
  if (state.current.messages.length === 0) {
    // Nothing was said. Restart the clock rather than archiving an empty shell.
    return { current: newThread(now), archived: state.archived };
  }
  return { current: newThread(now), archived: [...state.archived, state.current] };
}

function push(state: ThreadState, msg: Message, now: number): ThreadState {
  const rolled = rollIfExpired(state, now);
  return {
    ...rolled,
    current: { ...rolled.current, messages: [...rolled.current.messages, msg] },
  };
}

export interface SendOptions {
  channel?: Channel;
  attachments?: Attachment[];
  /** Spoken input arrives progressively; a live message is updated in place until finalized. */
  live?: boolean;
}

/**
 * The user says something — typed or spoken, same thread.
 *
 * Any companion message still in flight is truncated here, not stopped elsewhere: §3's
 * "interrupts immediately" has to be true of the transcript too.
 */
export function sendUser(
  state: ThreadState,
  text: string,
  now: number,
  opts: SendOptions = {},
): ThreadState {
  const interrupted = interruptCompanion(state, now);
  return push(interrupted, {
    id: nextId('msg'),
    author: 'user',
    channel: opts.channel ?? 'typed',
    text,
    at: now,
    attachments: opts.attachments ?? [],
    interrupted: false,
    live: opts.live ?? false,
  }, now);
}

export function sendCompanion(
  state: ThreadState,
  text: string,
  now: number,
  opts: SendOptions = {},
): ThreadState {
  return push(state, {
    id: nextId('msg'),
    author: 'companion',
    channel: opts.channel ?? 'typed',
    text,
    at: now,
    attachments: [],
    interrupted: false,
    live: opts.live ?? false,
  }, now);
}

/** The message currently being produced, if any. */
export function liveMessage(state: ThreadState): Message | null {
  const msgs = state.current.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.live) return m;
  }
  return null;
}

/** Update a live (streaming or being-transcribed) message in place. */
export function updateLive(state: ThreadState, text: string): ThreadState {
  const live = liveMessage(state);
  if (!live) return state;
  return {
    ...state,
    current: {
      ...state.current,
      messages: state.current.messages.map(m => (m.id === live.id ? { ...m, text } : m)),
    },
  };
}

/** Finalize the live message — transcription settled, or the companion finished speaking. */
export function finalizeLive(state: ThreadState): ThreadState {
  const live = liveMessage(state);
  if (!live) return state;
  return {
    ...state,
    current: {
      ...state.current,
      messages: state.current.messages.map(m => (m.id === live.id ? { ...m, live: false } : m)),
    },
  };
}

/**
 * §3, the barge-in. A companion message that was mid-flight is marked `interrupted` and kept —
 * deleting it would make the transcript lie about what the student heard.
 *
 * A live message with no text at all is dropped: an empty bubble is noise, not history.
 */
export function interruptCompanion(state: ThreadState, _now: number): ThreadState {
  const live = liveMessage(state);
  if (!live || live.author !== 'companion') return state;
  const kept = live.text.trim().length > 0;
  return {
    ...state,
    current: {
      ...state.current,
      messages: kept
        ? state.current.messages.map(m => (m.id === live.id ? { ...m, live: false, interrupted: true } : m))
        : state.current.messages.filter(m => m.id !== live.id),
    },
  };
}

/**
 * §3: "empty field = voice waveform. Any text = paper-plane Send."
 * Whitespace is not text — a composer holding only spaces must still show the waveform, or the
 * affordance flickers as the user hits space.
 */
export function composerAffordance(draft: string): 'waveform' | 'send' {
  return draft.trim().length > 0 ? 'send' : 'waveform';
}

/** Human file size for an attachment chip. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Extension → §8 chip kind. Unknown extensions are honestly `file`, never guessed. */
export function kindForFile(name: string): Attachment['kind'] {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'ppt';
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'excel';
  return 'file';
}
