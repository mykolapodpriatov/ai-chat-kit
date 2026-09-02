// The chat store: where streaming state lives, deliberately outside React.
//
// A streamed answer arrives as hundreds of small deltas. Held in React state,
// each one re-renders the component that owns the state and everything below
// it, so a 500-token answer re-renders the whole transcript 500 times. Held
// here, a delta replaces exactly one message object and notifies exactly the
// subscribers of that message; the other 40 messages in the transcript keep
// their identity and never re-render.
//
// Two invariants make that work, and both are covered by tests because both are
// easy to break by accident:
//
//   1. `getSnapshot` returns the *same object* until something actually
//      changes. `useSyncExternalStore` compares by reference; a fresh object per
//      call is an infinite render loop.
//   2. A mutation replaces only the objects on the path it touched. Rebuilding
//      the messages array wholesale would be simpler and would defeat the point.
//
// The store is intentionally not generic and not pluggable. It is a small piece
// of mutable state with a careful read contract, not a state-management
// library.

import { ChatAbortError } from './errors';
import type { ChatMessage, ChatRole, ChatStatus } from './types';

export interface ChatSnapshot {
  readonly status: ChatStatus;
  readonly messages: readonly ChatMessage[];
  /** The failure from the last attempt, or null. Aborts never land here. */
  readonly error: unknown;
}

export interface ChatStoreOptions {
  initialMessages?: ReadonlyArray<{ role: ChatRole; content: string }>;
  /** Injectable so tests and SSR get deterministic ids. */
  generateId?: () => string;
  now?: () => number;
}

export interface ChatStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChatSnapshot;

  /** Subscribe to a single message — the reason this store exists. */
  subscribeToMessage(id: string, listener: () => void): () => void;
  getMessageSnapshot(id: string): ChatMessage | undefined;

  appendMessage(input: { role: ChatRole; content: string }): string;
  appendDelta(id: string, text: string): void;
  startStreaming(id: string): void;
  finishStreaming(id: string): void;
  setStatus(status: ChatStatus): void;
  fail(error: unknown): void;
  reset(): void;
}

let sequence = 0;
const defaultGenerateId = (): string => `msg_${++sequence}`;

export function createChatStore(options: ChatStoreOptions = {}): ChatStore {
  const generateId = options.generateId ?? defaultGenerateId;
  const now = options.now ?? (() => Date.now());
  const seed = options.initialMessages ?? [];

  const globalListeners = new Set<() => void>();
  const messageListeners = new Map<string, Set<() => void>>();

  let messages: ChatMessage[] = [];
  let status: ChatStatus = 'idle';
  let error: unknown = null;
  let snapshot: ChatSnapshot;

  const buildSnapshot = (): ChatSnapshot => ({ status, messages, error });

  const commit = (touchedId?: string): void => {
    snapshot = buildSnapshot();
    for (const listener of globalListeners) listener();
    if (touchedId !== undefined) {
      const listeners = messageListeners.get(touchedId);
      if (listeners) for (const listener of listeners) listener();
    }
  };

  const seedMessages = (): void => {
    messages = seed.map((message) => ({
      id: generateId(),
      role: message.role,
      content: message.content,
      streaming: false,
      createdAt: now(),
    }));
  };

  const replaceMessage = (
    id: string,
    update: (message: ChatMessage) => ChatMessage,
  ): boolean => {
    const index = messages.findIndex((message) => message.id === id);
    if (index === -1) return false;

    const current = messages[index];
    if (current === undefined) return false;

    const next = update(current);
    if (next === current) return false;

    // A new array so the list snapshot changes, but every other element keeps
    // its identity — that is what stops unrelated rows re-rendering.
    messages = [
      ...messages.slice(0, index),
      next,
      ...messages.slice(index + 1),
    ];
    return true;
  };

  seedMessages();
  snapshot = buildSnapshot();

  return {
    subscribe(listener) {
      globalListeners.add(listener);
      return () => globalListeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    subscribeToMessage(id, listener) {
      let listeners = messageListeners.get(id);
      if (!listeners) {
        listeners = new Set();
        messageListeners.set(id, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) messageListeners.delete(id);
      };
    },

    getMessageSnapshot(id) {
      return messages.find((message) => message.id === id);
    },

    appendMessage(input) {
      const id = generateId();
      messages = [
        ...messages,
        {
          id,
          role: input.role,
          content: input.content,
          streaming: false,
          createdAt: now(),
        },
      ];
      commit();
      return id;
    },

    appendDelta(id, text) {
      if (text.length === 0) return;
      const changed = replaceMessage(id, (message) => ({
        ...message,
        content: message.content + text,
      }));
      if (changed) commit(id);
    },

    startStreaming(id) {
      status = 'streaming';
      error = null;
      replaceMessage(id, (message) => ({ ...message, streaming: true }));
      commit(id);
    },

    finishStreaming(id) {
      status = 'idle';
      replaceMessage(id, (message) => ({ ...message, streaming: false }));
      commit(id);
    },

    setStatus(next) {
      status = next;
      // Starting a new attempt clears the previous failure; leaving a stale
      // error visible next to a live stream is confusing.
      if (next === 'submitted' || next === 'streaming') error = null;
      commit();
    },

    fail(nextError) {
      // An abort is not a failure — the user asked us to stop, and showing them
      // an error for obeying is hostile.
      const aborted = nextError instanceof ChatAbortError;
      status = aborted ? 'idle' : 'error';
      error = aborted ? null : nextError;

      // Whatever streamed before the failure stays: a half-written answer with
      // an error beside it beats a blank space.
      const streamingMessage = messages.find((message) => message.streaming);
      if (streamingMessage) {
        replaceMessage(streamingMessage.id, (message) => ({
          ...message,
          streaming: false,
        }));
        commit(streamingMessage.id);
        return;
      }
      commit();
    },

    reset() {
      status = 'idle';
      error = null;
      seedMessages();
      commit();
    },
  };
}
