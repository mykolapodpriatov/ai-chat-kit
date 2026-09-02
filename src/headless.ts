// Public entry point for consumers bringing their own UI: the core, the
// transports and the hooks — everything except the rendered components.
// Imported as `ai-chat-kit/headless`.
//
// "Headless" here means the React bindings without any markup opinions, which
// is the shape most teams with a design system actually want. The core and
// transports underneath import no React at all, and ESLint enforces that, so a
// non-React consumer can reach past this entry into them.

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
export type { ChatTransport } from './transport/types';
export {
  createMockTransport,
  type MockTransport,
  type MockTransportOptions,
} from './transport/mock';
export {
  createOpenAICompatibleTransport,
  type OpenAICompatibleOptions,
} from './transport/openai';

export {
  useChatStream,
  type UseChatStreamOptions,
  type UseChatStreamResult,
} from './hooks/useChatStream';
export { useChatMessage } from './hooks/useChatMessage';
