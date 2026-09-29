import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatAbortError, NetworkError, RateLimitError } from '../core/errors';
import type { StreamEvent } from '../core/types';
import { createAnthropicTransport } from './anthropic';

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

function sseResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

/** One `content_block_delta` frame carrying a text delta, as Anthropic sends it. */
function textDelta(text: string, index = 0): string {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  })}\n\n`;
}

/** A minimal but realistic reply: start, one text block, stop. */
function fullReply(...tokens: string[]): string {
  const start = `event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-test',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  })}\n\n`;
  const blockStart = `event: content_block_start\ndata: ${JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })}\n\n`;
  const ping = `event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`;
  const deltas = tokens.map((token) => textDelta(token)).join('');
  const blockStop = `event: content_block_stop\ndata: ${JSON.stringify({
    type: 'content_block_stop',
    index: 0,
  })}\n\n`;
  const messageDelta = `event: message_delta\ndata: ${JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: tokens.length },
  })}\n\n`;
  const messageStop = `event: message_stop\ndata: ${JSON.stringify({
    type: 'message_stop',
  })}\n\n`;

  return (
    start + blockStart + ping + deltas + blockStop + messageDelta + messageStop
  );
}

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createAnthropicTransport', () => {
  it('streams text deltas out of content_block_delta events', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse(fullReply('Hello', ' world')));
    const transport = createAnthropicTransport({
      apiKey: 'sk-ant-test',
      model: 'claude-test',
      fetch: fetchMock,
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(textOf(events)).toBe('Hello world');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('sends the key as x-api-key, not a bearer token, with the version header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(fullReply()));
    const transport = createAnthropicTransport({
      apiKey: 'sk-ant-test',
      model: 'claude-test',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe('claude-test');
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('targets a custom baseUrl for gateway deployments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(fullReply()));
    const transport = createAnthropicTransport({
      apiKey: 'sk-ant-test',
      model: 'claude-test',
      baseUrl: 'https://gateway.example.com/anthropic',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://gateway.example.com/anthropic/messages',
    );
  });

  it('omits x-api-key entirely when there is no key', async () => {
    // A backend route that injects the key server-side is the documented
    // pattern; sending "x-api-key: undefined" would fail in a way that is hard
    // to spot.
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(fullReply()));
    const transport = createAnthropicTransport({
      model: 'claude-test',
      baseUrl: '/api/llm',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect('x-api-key' in (init.headers as Record<string, string>)).toBe(false);
  });

  it('moves system-role messages into a top-level system field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(fullReply()));
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(
        {
          messages: [
            { role: 'system', content: 'Be concise.' },
            { role: 'user', content: 'hi' },
          ],
        },
        { signal: new AbortController().signal },
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      system?: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.system).toBe('Be concise.');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('ignores content block deltas that carry no text, such as tool_use input_json_delta', async () => {
    const toolUseDelta = `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"location":' },
    })}\n\n`;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse(
          `event: message_start\ndata: ${JSON.stringify({ type: 'message_start' })}\n\n` +
            toolUseDelta +
            textDelta('hi') +
            `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
        ),
      );
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(events.filter((event) => event.type === 'delta')).toHaveLength(1);
    expect(textOf(events)).toBe('hi');
  });

  it('maps 429 to a RateLimitError carrying Retry-After in milliseconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '3' },
      }),
    );
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    const promise = transport.send(request, {
      signal: new AbortController().signal,
    });

    await expect(promise).rejects.toBeInstanceOf(RateLimitError);
    await expect(promise).rejects.toMatchObject({ retryAfterMs: 3000 });
  });

  it('maps a 5xx (such as an overloaded model) to a NetworkError carrying the status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('overloaded_error', { status: 529 }));
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    const promise = transport.send(request, {
      signal: new AbortController().signal,
    });

    await expect(promise).rejects.toBeInstanceOf(NetworkError);
    await expect(promise).rejects.toMatchObject({ status: 529 });
  });

  it('maps a transport-level throw to a NetworkError with the cause attached', async () => {
    const cause = new TypeError('fetch failed');
    const fetchMock = vi.fn().mockRejectedValue(cause);
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    const promise = transport.send(request, {
      signal: new AbortController().signal,
    });

    await expect(promise).rejects.toBeInstanceOf(NetworkError);
    await expect(promise).rejects.toMatchObject({ cause });
  });

  it('reports an aborted request as an abort, not a network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
      }),
    );
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    await expect(
      transport.send(request, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ChatAbortError);
  });

  it('fails clearly when the provider answers without a body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    await expect(
      transport.send(request, { signal: new AbortController().signal }),
    ).rejects.toThrow(/body/i);
  });

  it('passes provider-specific options through untouched, including overriding max_tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(fullReply()));
    const transport = createAnthropicTransport({
      apiKey: 'k',
      model: 'claude-test',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(
        { ...request, options: { max_tokens: 8192, temperature: 0.2 } },
        { signal: new AbortController().signal },
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(8192);
    expect(body.temperature).toBe(0.2);
  });
});
