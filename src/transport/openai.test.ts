import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatAbortError, NetworkError, RateLimitError } from '../core/errors';
import type { StreamEvent } from '../core/types';
import { createOpenAICompatibleTransport } from './openai';

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

function sseResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

function chunk(content: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content } }],
  })}\n\n`;
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

describe('createOpenAICompatibleTransport', () => {
  it('streams deltas out of the choices array', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse(chunk('Hello') + chunk(' world') + 'data: [DONE]\n\n'),
      );
    const transport = createOpenAICompatibleTransport({
      apiKey: 'sk-test',
      model: 'gpt-test',
      fetch: fetchMock,
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(textOf(events)).toBe('Hello world');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('sends the key as a bearer token and asks for a stream', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse('data: [DONE]\n\n'));
    const transport = createOpenAICompatibleTransport({
      apiKey: 'sk-test',
      model: 'gpt-test',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test',
    );
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe('gpt-test');
  });

  it('targets a custom baseUrl for self-hosted and gateway deployments', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse('data: [DONE]\n\n'));
    const transport = createOpenAICompatibleTransport({
      apiKey: 'sk-test',
      model: 'local',
      baseUrl: 'http://localhost:11434/v1',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('omits the Authorization header entirely when there is no key', async () => {
    // Local models routinely need no key, and sending "Bearer undefined" makes
    // them 401 for a reason that is hard to spot.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse('data: [DONE]\n\n'));
    const transport = createOpenAICompatibleTransport({
      model: 'local',
      baseUrl: 'http://localhost:11434/v1',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect('Authorization' in (init.headers as Record<string, string>)).toBe(
      false,
    );
  });

  it('ignores chunks that carry no content, such as the opening role frame', async () => {
    const roleFrame = `data: ${JSON.stringify({
      choices: [{ delta: { role: 'assistant' } }],
    })}\n\n`;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse(roleFrame + chunk('hi') + 'data: [DONE]\n\n'),
      );
    const transport = createOpenAICompatibleTransport({
      apiKey: 'k',
      model: 'm',
      fetch: fetchMock,
    });

    const events = await drain(
      await transport.send(request, { signal: new AbortController().signal }),
    );

    expect(events.filter((event) => event.type === 'delta')).toHaveLength(1);
  });

  it('maps 429 to a RateLimitError carrying Retry-After in milliseconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '3' },
      }),
    );
    const transport = createOpenAICompatibleTransport({
      apiKey: 'k',
      model: 'm',
      fetch: fetchMock,
    });

    const promise = transport.send(request, {
      signal: new AbortController().signal,
    });

    await expect(promise).rejects.toBeInstanceOf(RateLimitError);
    await expect(promise).rejects.toMatchObject({ retryAfterMs: 3000 });
  });

  it('maps a 5xx to a NetworkError carrying the status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('upstream died', { status: 502 }));
    const transport = createOpenAICompatibleTransport({
      apiKey: 'k',
      model: 'm',
      fetch: fetchMock,
    });

    const promise = transport.send(request, {
      signal: new AbortController().signal,
    });

    await expect(promise).rejects.toBeInstanceOf(NetworkError);
    await expect(promise).rejects.toMatchObject({ status: 502 });
  });

  it('maps a transport-level throw to a NetworkError with the cause attached', async () => {
    const cause = new TypeError('fetch failed');
    const fetchMock = vi.fn().mockRejectedValue(cause);
    const transport = createOpenAICompatibleTransport({
      apiKey: 'k',
      model: 'm',
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
    const transport = createOpenAICompatibleTransport({
      apiKey: 'k',
      model: 'm',
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
    const transport = createOpenAICompatibleTransport({
      apiKey: 'k',
      model: 'm',
      fetch: fetchMock,
    });

    await expect(
      transport.send(request, { signal: new AbortController().signal }),
    ).rejects.toThrow(/body/i);
  });

  it('passes provider-specific options through untouched', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse('data: [DONE]\n\n'));
    const transport = createOpenAICompatibleTransport({
      apiKey: 'k',
      model: 'm',
      fetch: fetchMock,
    });

    await drain(
      await transport.send(
        { ...request, options: { temperature: 0.2, top_p: 0.9 } },
        { signal: new AbortController().signal },
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBe(0.9);
  });
});
