# ADR 003 — What v1 deliberately does not do

**Status:** accepted · **Date:** 2026-09-02

## Context

The plausible v1 scope for a chat library is large: streaming, tool-call
rendering, markdown with syntax highlighting, message virtualisation, several
provider adapters, attachments, retries, persistence. Each is defensible. All
of them together is a project that does not reach 1.0, and an unfinished
library helps nobody.

## Decision

v1 ships the streaming engine and the smallest UI that proves it:

```
ChatTransport · SSE parser · state machine · typed errors · retry with backoff
useChatStream · useChatMessage
MessageList · MessageBubble · Composer · Chat
MockTransport · OpenAI-compatible adapter
```

Explicitly deferred, each tracked as an issue:

- **Tool-call rendering.** Needs a schema for tool results, a rendering
  contract, and an execution story. That is a second design, not a component.
- **An Anthropic-native adapter.** The compatible adapter already reaches most
  providers; a native one is additive and can arrive in a minor release.
- **Message virtualisation.** The per-message subscription means a long
  transcript costs render _count_, not render _breadth_ — virtualisation is a
  DOM-size optimisation, and it should be added when someone measures a DOM
  large enough to need it, not before.
- **Streaming markdown with syntax highlighting.** Parsing markdown that is
  still arriving is genuinely hard (an unclosed code fence must not swallow the
  rest of the answer), and the obvious implementations re-parse the whole
  message per token — which would undo the thing this library exists for.

## Consequences

**Good.** v1 does one thing and can be judged on it. Every deferred feature is
additive: none requires changing the store contract, the transport interface or
the component props, so they can arrive in minor releases without churn for
consumers.

**Cost.** The package is less immediately impressive than one whose README
lists twelve features. A team needing tool-call rendering today will look
elsewhere — which is the correct outcome, rather than shipping a half-designed
version of it.

**Also deliberately absent: CSS.** Components take `className` props and render
semantic markup with `data-part` hooks. A library that injects styles fights
every design system it meets, and the styling in the Storybook demo is exactly
what a consumer would write themselves.

## Alternatives considered

**Ship everything, call it 0.x, iterate in public.** Reasonable for a project
with users pulling it forward. With none, 0.x is where things go to stall.

**Ship only the headless core, no components.** Tempting, and it dodges every
styling argument. Rejected because the components are the proof: without them
"streaming state lives outside React" is an assertion, and `MessageBubble`
subscribing per message is the demonstration.
