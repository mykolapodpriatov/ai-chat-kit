# ADR 002 — The core knows nothing about providers

**Status:** accepted · **Date:** 2026-09-02

## Context

A chat library has to talk to something. The tempting shape is a hook that
takes an API key and a model and does the rest — it demos beautifully in three
lines.

It also decides, on the consumer's behalf, that their key will be in the
browser, that their provider is the one the library chose, and that their
corporate gateway does not exist. Every team that outgrows those assumptions
forks the library or wraps it in something that undoes them.

## Decision

One interface, and nothing else crosses the boundary:

```ts
interface ChatTransport {
  send(
    request: ChatRequest,
    options: { signal: AbortSignal },
  ): Promise<ReadableStream<StreamEvent>>;
}
```

The core emits and consumes `StreamEvent`s. It has never heard of URLs,
headers, auth, or `choices[0].delta.content`. A transport translates one
provider's wire format and stops.

The contract a transport must honour:

- zero or more `delta` events, then exactly **one** terminal event (`done` or
  `error`), then close;
- reject or emit one of the library's typed errors, so the retry policy can
  classify it;
- stop promptly on `signal`, and not treat that as a failure.

Two transports ship. `createOpenAICompatibleTransport` covers OpenAI, Azure
OpenAI, Groq, Together, OpenRouter, vLLM, Ollama's compatibility endpoint and
most corporate gateways — one adapter, most of the market. `createMockTransport`
serves tests, the demo, and failure reproduction.

Returning a `ReadableStream` rather than taking a callback keeps cancellation
and back-pressure in one object, and lets a consumer compose it with other
streams without an adapter.

## Consequences

**Good.** Sending the prompt through a backend route — which is what any team
handling real keys does — is a transport, not a fork. A test does not touch the
network. The demo on GitHub Pages works with no key, offline. Adding a provider
does not touch the store, the hooks or the components.

**Cost.** Three lines of setup instead of one, and a consumer who only ever
wanted OpenAI pays a small tax in ceremony. That is the right trade for a
library: the three-line version is easy to build on top of this and impossible
to build out of.

**A boundary is only real if it is enforced.** ESLint forbids importing React
from `src/core` and `src/transport`. A convention nobody enforces erodes on the
first busy afternoon.

## Alternatives considered

**A hook that takes `apiKey` and `model`.** Best demo, worst ceiling. It
normalises putting a provider key in the browser, which is the wrong default to
build into a library.

**An adapter per provider, shipped in the box.** Every adapter is a maintenance
commitment tied to someone else's release cycle, and most of them would be the
same OpenAI-shaped code. One compatible adapter plus a documented interface
covers more providers with less to break. Anthropic's native format is tracked
as an issue, not shipped in v1.

**Vercel's AI SDK as the transport layer.** Excellent, and a much larger
dependency with its own opinions about the server. This library is smaller than
the decision to adopt that.
