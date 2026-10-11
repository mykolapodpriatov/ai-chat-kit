# ai-chat-kit

## 1.1.0

### Minor Changes

- [#16](https://github.com/mykolapodpriatov/ai-chat-kit/pull/16) [`78b72e8`](https://github.com/mykolapodpriatov/ai-chat-kit/commit/78b72e816bf97189156782f57d02b89b7a454f89) Thanks [@mykolapodpriatov](https://github.com/mykolapodpriatov)! - Add `createAnthropicTransport`, a native adapter for Anthropic's Messages API streaming format (`content_block_delta` with `text_delta`, `message_start`/`message_stop`, and so on), behind the same `ChatTransport` interface as `createOpenAICompatibleTransport`. Worth having alongside the OpenAI-compatible adapter because the compatible endpoint does not expose extended thinking or prompt caching. Tool-use content blocks (`input_json_delta`) are recognised on the wire but not yet surfaced, since tool-call rendering is still deferred per ADR 003.

## 1.0.0

### Major Changes

- [#6](https://github.com/mykolapodpriatov/ai-chat-kit/pull/6) [`593a6b7`](https://github.com/mykolapodpriatov/ai-chat-kit/commit/593a6b70c5d97e3128614b8baf9dc5377f03e894) Thanks [@mykolapodpriatov](https://github.com/mykolapodpriatov)! - First release.
  
  Headless React hooks and components for streaming LLM chat UIs, built around one
  decision: the streaming state lives outside React, in a store components
  subscribe to per message. A token replaces one message object rather than
  invalidating the transcript, so streaming into a long conversation costs the
  same as streaming into a short one — at 1,000 messages that is 200 row renders
  where the obvious implementation performs 200,000.
  
  - `ChatTransport` keeps the core provider-agnostic; `createOpenAICompatibleTransport`
    covers OpenAI, Azure, Groq, Together, OpenRouter, vLLM and Ollama, and
    `createMockTransport` drives the tests, the demo and failure reproduction.
  - An SSE parser that survives real networks: events split across chunks,
    multi-byte characters split across chunks, and a final event with no trailing
    blank line.
  - Typed errors (`NetworkError`, `RateLimitError`, `ChatAbortError`, `ParseError`)
    with a retry policy that obeys `Retry-After` and never replays an abort, a 4xx
    or a parse failure.
  - `useChatStream` and `useChatMessage`, plus `Chat`, `MessageList`,
    `MessageBubble` and `Composer`. Import `ai-chat-kit/headless` for everything
    except the components.
