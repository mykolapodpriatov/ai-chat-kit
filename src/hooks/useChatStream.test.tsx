import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createChatStore } from '../core/store';
import { NetworkError } from '../core/errors';
import { createMockTransport } from '../transport/mock';
import type { ChatTransport } from '../transport/types';
import { useChatMessage } from './useChatMessage';
import { useChatStream } from './useChatStream';

describe('useChatStream', () => {
  it('starts idle with no messages', () => {
    const transport = createMockTransport({ script: ['hi'], delayMs: 0 });
    const { result } = renderHook(() => useChatStream({ transport }));

    expect(result.current.status).toBe('idle');
    expect(result.current.messages).toEqual([]);
  });

  it('seeds the conversation with initial messages', () => {
    const transport = createMockTransport({ script: ['hi'], delayMs: 0 });
    const { result } = renderHook(() =>
      useChatStream({
        transport,
        initialMessages: [{ role: 'system', content: 'Be brief.' }],
      }),
    );

    expect(result.current.messages).toHaveLength(1);
  });

  it('appends the user message and streams the reply', async () => {
    const transport = createMockTransport({
      script: ['Hello', ' there'],
      delayMs: 0,
    });
    const { result } = renderHook(() => useChatStream({ transport }));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.content).toBe('hi');
    expect(result.current.messages[1]?.content).toBe('Hello there');
    expect(result.current.status).toBe('idle');
  });

  it('ignores an empty or whitespace-only send', async () => {
    const transport = createMockTransport({ script: ['x'], delayMs: 0 });
    const { result } = renderHook(() => useChatStream({ transport }));

    await act(async () => {
      await result.current.send('   ');
    });

    expect(result.current.messages).toHaveLength(0);
    expect(transport.requests).toHaveLength(0);
  });

  it('trims the message before sending it', async () => {
    const transport = createMockTransport({ script: ['x'], delayMs: 0 });
    const { result } = renderHook(() => useChatStream({ transport }));

    await act(async () => {
      await result.current.send('  hi  ');
    });

    expect(transport.requests[0]?.messages.at(-1)?.content).toBe('hi');
  });

  it('does not send the empty assistant placeholder to the provider', async () => {
    const transport = createMockTransport({ script: ['x'], delayMs: 0 });
    const { result } = renderHook(() => useChatStream({ transport }));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(transport.requests[0]?.messages).toHaveLength(1);
    expect(transport.requests[0]?.messages[0]?.role).toBe('user');
  });

  it('sends the whole conversation on a follow-up turn', async () => {
    const transport = createMockTransport({
      script: [['first reply'], ['second reply']],
      delayMs: 0,
    });
    const { result } = renderHook(() => useChatStream({ transport }));

    await act(async () => {
      await result.current.send('one');
    });
    await act(async () => {
      await result.current.send('two');
    });

    expect(transport.requests[1]?.messages).toHaveLength(3);
  });

  it('reports a transport failure and keeps the partial reply', async () => {
    const onError = vi.fn();
    const transport = createMockTransport({
      script: ['par', 'tial', ' more'],
      delayMs: 0,
      failAfter: 2,
      error: new NetworkError('upstream died', { status: 502 }),
    });
    const { result } = renderHook(() => useChatStream({ transport, onError }));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.messages[1]?.content).toBe('partial');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('calls onFinish with the completed message', async () => {
    const onFinish = vi.fn();
    const transport = createMockTransport({ script: ['done'], delayMs: 0 });
    const { result } = renderHook(() => useChatStream({ transport, onFinish }));

    await act(async () => {
      await result.current.send('hi');
    });

    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'done', streaming: false }),
    );
  });

  it('stop() ends the stream without reporting an error', async () => {
    const onError = vi.fn();
    // Long enough that the reply is still arriving when Stop is pressed —
    // a four-token script finishes before the first assertion runs.
    const transport = createMockTransport({
      script: Array.from({ length: 60 }, () => 'x'),
      delayMs: 10,
    });
    const { result } = renderHook(() => useChatStream({ transport, onError }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.send('hi');
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      result.current.stop();
    });
    await act(async () => {
      await pending;
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('settles immediately even when the transport ignores the abort signal', async () => {
    // A third-party adapter that never checks its signal would otherwise leave
    // the UI streaming forever. Stop is the user's, not the transport's.
    const transport: ChatTransport = {
      send: async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'delta', text: 'partial' });
            // and then nothing, ever
          },
        }),
    };
    const { result } = renderHook(() => useChatStream({ transport }));

    act(() => {
      void result.current.send('hi');
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.error).toBeNull();
  });

  it('aborts the in-flight request when the component unmounts', async () => {
    // Without this the fetch runs to completion in the background: the user is
    // billed for tokens nobody will see, written into a store nobody reads.
    const abortSpy = vi.fn();
    const transport: ChatTransport = {
      send: async (_request, { signal }) => {
        signal.addEventListener('abort', abortSpy);
        return new ReadableStream({
          start() {
            /* never resolves on its own */
          },
        });
      },
    };
    const { result, unmount } = renderHook(() => useChatStream({ transport }));

    act(() => {
      void result.current.send('hi');
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    unmount();

    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it('replaces an in-flight request rather than interleaving two streams', async () => {
    const transport = createMockTransport({
      script: [['aaa'], ['bbb']],
      delayMs: 5,
    });
    const { result } = renderHook(() => useChatStream({ transport }));

    act(() => {
      void result.current.send('one');
    });
    await act(async () => {
      await result.current.send('two');
    });

    const assistantMessages = result.current.messages.filter(
      (message) => message.role === 'assistant',
    );
    expect(
      assistantMessages.some((message) => message.content === 'aaabbb'),
    ).toBe(false);
  });

  it('reset clears the conversation back to its seed', async () => {
    const transport = createMockTransport({ script: ['x'], delayMs: 0 });
    const { result } = renderHook(() =>
      useChatStream({
        transport,
        initialMessages: [{ role: 'system', content: 'Be brief.' }],
      }),
    );

    await act(async () => {
      await result.current.send('hi');
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.status).toBe('idle');
  });

  it('shares one conversation between components when given a store', async () => {
    const store = createChatStore();
    const transport = createMockTransport({ script: ['shared'], delayMs: 0 });
    const first = renderHook(() => useChatStream({ transport, store }));
    const second = renderHook(() => useChatStream({ transport, store }));

    await act(async () => {
      await first.result.current.send('hi');
    });

    expect(second.result.current.messages).toHaveLength(2);
  });
});

describe('useChatMessage render isolation', () => {
  it('does not re-render a row whose message did not change', async () => {
    // The claim the whole package rests on, asserted rather than assumed.
    const renderCounts = new Map<string, number>();

    function Row({
      store,
      id,
    }: {
      store: ReturnType<typeof createChatStore>;
      id: string;
    }) {
      const message = useChatMessage(store, id);
      const count = useRef(0);
      count.current += 1;
      renderCounts.set(id, count.current);
      return <li data-testid={id}>{message?.content}</li>;
    }

    const store = createChatStore();
    const stableId = store.appendMessage({ role: 'assistant', content: 'old' });
    const streamingId = store.appendMessage({ role: 'assistant', content: '' });

    render(
      <ul>
        <Row store={store} id={stableId} />
        <Row store={store} id={streamingId} />
      </ul>,
    );

    const stableRendersBefore = renderCounts.get(stableId);

    act(() => {
      store.startStreaming(streamingId);
      for (let i = 0; i < 100; i += 1) store.appendDelta(streamingId, 'x');
      store.finishStreaming(streamingId);
    });

    expect(screen.getByTestId(streamingId)).toHaveTextContent('x'.repeat(100));
    expect(renderCounts.get(stableId)).toBe(stableRendersBefore);
  });
});
