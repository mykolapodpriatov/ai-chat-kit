// Public entry point for consumers bringing their own UI: everything except the
// React components. Imported as `ai-chat-kit/headless`.

export {
  ChatAbortError,
  ChatError,
  NetworkError,
  ParseError,
  RateLimitError,
  isRetryable,
  type ChatErrorKind,
} from './core/errors';
export { parseSseStream, type ParseSseOptions } from './core/sse';
export {
  createChatStore,
  type ChatSnapshot,
  type ChatStore,
  type ChatStoreOptions,
} from './core/store';
export {
  DEFAULT_BACKOFF,
  backoffDelay,
  withRetry,
  type BackoffOptions,
  type WithRetryOptions,
} from './core/retry';
export type {
  ChatMessage,
  ChatRequest,
  ChatRole,
  ChatStatus,
  StreamEvent,
} from './core/types';
