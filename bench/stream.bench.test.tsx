// The benchmark, run as a test so CI keeps it honest.
//
// Two things are measured, and only one of them is a stopwatch:
//
//   - row renders: how many times React re-rendered a message component. This
//     is the structural number and it is deterministic, so it can be asserted.
//   - wall time: how long the deltas took to apply. Useful for the README,
//     never asserted — a shared CI runner's timings are noise.
//
// **Deltas are applied one flush at a time, not batched.** That is the single
// decision that makes this benchmark honest. Wrapping 500 deltas in one `act()`
// lets React coalesce them into a single render pass, which reports a tenth of
// the real cost and flatters both implementations — the naive one far more,
// because batching is exactly what hides its problem. Real streaming delivers
// each delta on its own network event, so each one gets its own commit, and
// that is what is measured here.
//
// The assertions are on the deterministic number. A regression that quietly
// reintroduces whole-list re-rendering fails here rather than being noticed by
// a user with a long conversation.

import { act, render } from '@testing-library/react';
import { afterAll, describe, expect, it } from 'vitest';

import { createChatStore } from '../src/core/store';
import type { ChatMessage } from '../src/core/types';
import { NaiveChat } from './naive';
import { SubscribedChat } from './subscribed';

interface Scenario {
  messages: number;
  deltas: number;
}

const SCENARIOS: Scenario[] = [
  { messages: 10, deltas: 200 },
  { messages: 100, deltas: 200 },
  { messages: 1000, deltas: 200 },
  { messages: 100, deltas: 1000 },
];

function seedMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: 'assistant' as const,
    content: `Message ${index}`,
    streaming: false,
    createdAt: 0,
  }));
}

interface Measurement {
  rowRenders: number;
  ms: number;
}

function measureNaive(scenario: Scenario): Measurement {
  let rowRenders = 0;
  let append!: (id: string, text: string) => void;
  const initial = seedMessages(scenario.messages);
  const targetId = initial.at(-1)!.id;

  render(
    <NaiveChat
      initial={initial}
      onRender={() => {
        rowRenders += 1;
      }}
      register={(fn) => {
        append = fn;
      }}
    />,
  );

  const rendersAfterMount = rowRenders;
  const started = performance.now();
  // One act() per delta: each token arrives on its own event in production, so
  // each gets its own commit. Batching them would measure a case that does not
  // happen and would hide precisely the cost being compared.
  for (let i = 0; i < scenario.deltas; i += 1) {
    act(() => {
      append(targetId, 'x');
    });
  }
  const ms = performance.now() - started;

  return { rowRenders: rowRenders - rendersAfterMount, ms };
}

function measureSubscribed(scenario: Scenario): Measurement {
  let rowRenders = 0;
  const store = createChatStore();
  const ids = Array.from({ length: scenario.messages }, (_, index) =>
    store.appendMessage({ role: 'assistant', content: `Message ${index}` }),
  );
  const targetId = ids.at(-1)!;

  render(
    <SubscribedChat
      store={store}
      ids={ids}
      onRender={() => {
        rowRenders += 1;
      }}
    />,
  );

  const rendersAfterMount = rowRenders;
  const started = performance.now();
  for (let i = 0; i < scenario.deltas; i += 1) {
    act(() => {
      store.appendDelta(targetId, 'x');
    });
  }
  const ms = performance.now() - started;

  return { rowRenders: rowRenders - rendersAfterMount, ms };
}

describe('streaming render cost', () => {
  const rows: string[] = [];

  for (const scenario of SCENARIOS) {
    it(`${scenario.messages} messages × ${scenario.deltas} deltas`, () => {
      const naive = measureNaive(scenario);
      const subscribed = measureSubscribed(scenario);

      rows.push(
        [
          `| ${scenario.messages.toLocaleString('en-US')}`,
          `${scenario.deltas.toLocaleString('en-US')}`,
          `${naive.rowRenders.toLocaleString('en-US')}`,
          `${subscribed.rowRenders.toLocaleString('en-US')}`,
          `${(naive.rowRenders / Math.max(1, subscribed.rowRenders)).toFixed(0)}×`,
          `${naive.ms.toFixed(0)} ms`,
          `${subscribed.ms.toFixed(0)} ms |`,
        ].join(' | '),
      );

      // The structural claim: a delta re-renders exactly the row it landed on,
      // no matter how long the transcript is — so the count equals the number
      // of deltas and is independent of the message count.
      expect(subscribed.rowRenders).toBe(scenario.deltas);

      // The naive version re-renders the whole transcript on every delta, so
      // its cost is deltas × messages.
      expect(naive.rowRenders).toBe(scenario.deltas * scenario.messages);
    });
  }

  it('scales with the transcript in the naive version and not in this one', () => {
    // The number that decides the architecture: growing the transcript 10×
    // must not make streaming 10× more expensive.
    const small = measureSubscribed({ messages: 10, deltas: 200 });
    const large = measureSubscribed({ messages: 1000, deltas: 200 });

    expect(large.rowRenders).toBe(small.rowRenders);

    const naiveSmall = measureNaive({ messages: 10, deltas: 200 });
    const naiveLarge = measureNaive({ messages: 1000, deltas: 200 });

    expect(naiveLarge.rowRenders).toBeGreaterThan(naiveSmall.rowRenders * 10);
  });

  afterAll(() => {
    if (process.env.BENCH_TABLE !== '1') return;
    process.stdout.write(
      '\n| Messages | Deltas | Row renders (naive) | Row renders (this) | Ratio | Naive | This |\n' +
        '|---:|---:|---:|---:|---:|---:|---:|\n' +
        rows.join('\n') +
        '\n\n',
    );
  });
});
