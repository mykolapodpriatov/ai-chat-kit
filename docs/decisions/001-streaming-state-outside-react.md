# ADR 001 — Streaming state lives outside React

**Status:** accepted · **Date:** 2026-09-02

## Context

A streamed reply arrives as hundreds of small deltas. The obvious
implementation holds the transcript in React state and appends to it:

```tsx
const [messages, setMessages] = useState<ChatMessage[]>([]);
// …for every token:
setMessages((current) =>
  current.map((m) => (m.id === id ? { ...m, content: m.content + token } : m)),
);
```

This is correct, it is what the React documentation suggests, and it is what a
competent developer writes first. Its problem is structural: every token
invalidates the state that owns the _whole list_, so React re-renders every row.
The cost is `deltas × messages`, which means streaming gets more expensive as
the conversation grows — the chat feels fine for ten minutes and janky after an
hour. That is exactly the bug report that is hard to reproduce and hard to fix
late.

## Decision

The conversation lives in a plain JavaScript store. React reads it through
`useSyncExternalStore`, and each row subscribes to **its own message**:

```
ReadableStream → chunk parser → ChatStore → useSyncExternalStore → subscribed rows
```

Two invariants make this work, and both are enforced by tests because both fail
silently:

1. **`getSnapshot()` returns the same object until something actually
   changes.** `useSyncExternalStore` compares snapshots by reference; returning
   a fresh object per call is an infinite render loop that only appears at
   runtime.
2. **A mutation replaces only the objects on the path it touched.** Rebuilding
   the messages array wholesale would be simpler and would defeat the entire
   purpose. The guarding test asserts that a message's snapshot is
   _referentially identical_ after 100 deltas land on a different message.

`MessageList` renders ids, not content, so the list itself re-renders only when
a message is added or removed.

## Consequences

Measured with each delta on its own flush — the way streaming actually arrives,
rather than batched inside a single `act()`, which coalesces hundreds of deltas
into one render pass and hides the difference:

| Messages | Deltas | Row renders (naive) | Row renders (this) | Ratio |
| -------: | -----: | ------------------: | -----------------: | ----: |
|       10 |    200 |               2,000 |                200 |   10× |
|      100 |    200 |              20,000 |                200 |  100× |
|    1,000 |    200 |             200,000 |                200 | 1000× |

The shape matters more than any single number: the naive cost is
`deltas × messages`, this one is `deltas`. Streaming into a thousand-message
transcript costs exactly what streaming into a ten-message one costs.

**What it costs.** More machinery than `useState`: a store, two hooks, and a
subscription contract that a contributor can break without the type checker
noticing — which is why the two invariants above have dedicated tests. The
component calling `useChatStream` still re-renders per delta, because the
conversation snapshot genuinely changed; keeping that component thin and
letting rows subscribe individually is the pattern, and the shipped components
follow it.

**When it does not matter.** A chat that never exceeds a handful of messages
will not notice. This library is built for the case where it does.

## Alternatives considered

**`useState` with the transcript in a parent.** Simplest, and correct. Rejected
on the numbers above.

**A state-management library — Zustand, Jotai, Redux.** Any of them would
work; Zustand in particular is `useSyncExternalStore` with ergonomics. Rejected
because it is a dependency for one small piece of carefully-specified mutable
state, and a chat library that drags a state manager into every consumer's
bundle is making a decision that is not its to make.

**`useRef` plus a forced re-render.** Keeps state out of React but loses
subscription granularity — a forced update re-renders the whole subtree, which
is the problem being solved.
