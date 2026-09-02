// The vocabulary everything else speaks.
//
// Kept deliberately small and provider-neutral: nothing here mentions OpenAI,
// tokens-per-second, or HTTP. A transport translates its provider's wire format
// into these types, and the store and the React layer never see anything else.

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** The text so far. Grows as deltas arrive. */
  content: string;
  /**
   * True while this message is still receiving deltas. Exactly one message can
   * be streaming at a time, which is what lets the UI show a caret in one place.
   */
  streaming: boolean;
  createdAt: number;
}

/** What the conversation as a whole is doing. */
export type ChatStatus =
  | 'idle'
  /** The request has been sent; no bytes have come back yet. */
  | 'submitted'
  /** Deltas are arriving. */
  | 'streaming'
  /** The last attempt failed. `error` on the snapshot says how. */
  | 'error';

/**
 * One thing that happened on the wire, after a transport has normalised it.
 *
 * A transport emits `delta` many times, then exactly one terminal event:
 * `done` or `error`. The store relies on that contract to know when to clear
 * the streaming flag.
 */
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: unknown };

/** What a transport is asked to send. */
export interface ChatRequest {
  messages: ReadonlyArray<Pick<ChatMessage, 'role' | 'content'>>;
  /** Provider-specific knobs the core deliberately does not model. */
  options?: Readonly<Record<string, unknown>>;
}
