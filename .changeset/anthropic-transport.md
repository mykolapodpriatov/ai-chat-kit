---
'@podpriatov/ai-chat-kit': minor
---

Add `createAnthropicTransport`, a native adapter for Anthropic's Messages API streaming format (`content_block_delta` with `text_delta`, `message_start`/`message_stop`, and so on), behind the same `ChatTransport` interface as `createOpenAICompatibleTransport`. Worth having alongside the OpenAI-compatible adapter because the compatible endpoint does not expose extended thinking or prompt caching. Tool-use content blocks (`input_json_delta`) are recognised on the wire but not yet surfaced, since tool-call rendering is still deferred per ADR 003.
