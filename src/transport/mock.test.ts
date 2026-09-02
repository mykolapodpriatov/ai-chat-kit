import { describe, expect, it } from 'vitest';

import { ChatAbortError, NetworkError } from '../core/errors';
import type { StreamEvent } from '../core/types';
import { createMockTransport } from './mock';

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

async function drain(
  stream: ReadableStream<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(value);
  }
  return events;
}

function textOf(events: StreamEvent[]): string {
  return events
    .filter(
      (event): event is { type: 'delta'; text: string } =>
        event.type === 'delta',
    )
    .map((event) => event.text)
    .join('');
}

describe('createMockTransport', () => {
  it('replays a scripted reply token by token', async () => {
    const transport = createMockTransport({
      script: ['Hello', ' ', 'world'],
      delayMs: 0,
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(textOf(events)).toBe('Hello world');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('splits a plain string script into word-sized chunks', async () => {
    const transport = createMockTransport({
      script: 'one two three',
      delayMs: 0,
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(textOf(events)).toBe('one two three');
    expect(
      events.filter((event) => event.type === 'delta').length,
    ).toBeGreaterThan(1);
  });

  it('emits exactly one terminal event', async () => {
    const transport = createMockTransport({ script: ['a', 'b'], delayMs: 0 });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    const terminal = events.filter(
      (event) => event.type === 'done' || event.type === 'error',
    );
    expect(terminal).toHaveLength(1);
  });

  it('fails at the requested token, keeping what came before', async () => {
    const transport = createMockTransport({
      script: ['a', 'b', 'c', 'd'],
      delayMs: 0,
      failAfter: 2,
      error: new NetworkError('upstream died', { status: 502 }),
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(textOf(events)).toBe('ab');
    expect(events.at(-1)?.type).toBe('error');
  });

  it('reports the scripted error object itself', async () => {
    const error = new NetworkError('upstream died');
    const transport = createMockTransport({
      script: ['a'],
      delayMs: 0,
      failAfter: 0,
      error,
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(events).toEqual([{ type: 'error', error }]);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    const transport = createMockTransport({
      script: ['a', 'b', 'c'],
      delayMs: 5,
    });

    const stream = await transport.send(request, { signal: controller.signal });
    const reader = stream.getReader();
    const first = await reader.read();
    controller.abort();

    const rest: StreamEvent[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(value);
    }

    expect(first.value).toEqual({ type: 'delta', text: 'a' });
    expect(rest.at(-1)).toEqual({
      type: 'error',
      error: expect.any(ChatAbortError),
    });
  });

  it('records every request it was given, so a test can assert on the prompt', async () => {
    const transport = createMockTransport({ script: ['ok'], delayMs: 0 });

    await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.messages[0]?.content).toBe('hi');
  });

  it('plays a different script on each call when given a list', async () => {
    const transport = createMockTransport({
      script: [['first'], ['second']],
      delayMs: 0,
    });
    const signal = new AbortController().signal;

    const one = await drain(await transport.send(request, { signal }));
    const two = await drain(await transport.send(request, { signal }));

    expect(textOf(one)).toBe('first');
    expect(textOf(two)).toBe('second');
  });

  it('repeats the last script once the list is exhausted', async () => {
    const transport = createMockTransport({ script: [['only']], delayMs: 0 });
    const signal = new AbortController().signal;

    await drain(await transport.send(request, { signal }));
    const second = await drain(await transport.send(request, { signal }));

    expect(textOf(second)).toBe('only');
  });
});
