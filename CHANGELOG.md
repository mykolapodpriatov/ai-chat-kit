# ai-chat-kit

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
