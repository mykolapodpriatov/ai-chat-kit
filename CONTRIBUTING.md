# Contributing

Thanks for taking a look.

## Getting set up

```bash
pnpm install
pnpm test        # unit + component tests
pnpm typecheck
pnpm lint
```

## What the layers are for

- `src/core/**` — no React. Parsing, the store, retry policy, error types. If
  something here imports React, it is in the wrong folder.
- `src/transport/**` — everything that knows about a specific provider. The core
  must stay ignorant of URLs, headers and payload shapes.
- `src/hooks/**`, `src/components/**` — the React layer, which only ever talks
  to the store through `useSyncExternalStore`.

## Ground rules

- **Tests come first.** Every behavioural change starts with a failing test.
- **The store's snapshot must be referentially stable** when nothing changed.
  `useSyncExternalStore` will loop forever otherwise, and the test that guards
  this is not optional.
- **Do not widen v1.** Tool-call rendering, an Anthropic adapter, virtualisation
  and streaming markdown are tracked as issues on purpose. New surface belongs
  in an issue first.
- Commit messages explain *why*, not *what* — the diff already shows what.

## Before opening a PR

```bash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
