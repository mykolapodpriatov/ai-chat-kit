'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import { ChatAbortError } from '../core/errors';
import { createChatStore, type ChatStore } from '../core/store';
import type { ChatMessage, ChatRole, ChatStatus } from '../core/types';
import type { ChatTransport } from '../transport/types';

// The bridge between the store and React.
//
// Everything interesting already happened in `createChatStore`; this hook's
// only jobs are to subscribe through `useSyncExternalStore`, own the
// AbortController, and make sure an unmount never leaves a request running.
//
// Why not `useState`: a streamed reply arrives as hundreds of deltas, and each
// `setState` re-renders this component and its whole subtree. Subscribing to an
// external store means a delta re-renders only the components that asked for
// the message it landed on — see `useChatMessage` and the benchmark.

export interface UseChatStreamOptions {
  transport: ChatTransport;
  initialMessages?: ReadonlyArray<{ role: ChatRole; content: string }>;
  /** Provider knobs, passed to the transport untouched. */
  options?: Readonly<Record<string, unknown>>;
  onError?: (error: unknown) => void;
  onFinish?: (message: ChatMessage) => void;
  /** Supply an external store to share one conversation across components. */
  store?: ChatStore;
}

export interface UseChatStreamResult {
  messages: readonly ChatMessage[];
  status: ChatStatus;
  error: unknown;
  isStreaming: boolean;
  send: (content: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  store: ChatStore;
}

export function useChatStream(
  options: UseChatStreamOptions,
): UseChatStreamResult {
  // The store must survive re-renders, and creating it in a ref initialiser
  // rather than useState avoids constructing a throwaway on every render.
  const storeRef = useRef<ChatStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current =
      options.store ??
      createChatStore(
        options.initialMessages !== undefined
          ? { initialMessages: options.initialMessages }
          : {},
      );
  }
  const store = storeRef.current;

  const abortRef = useRef<AbortController | null>(null);

  // Callbacks live in a ref so a consumer passing inline arrows does not
  // invalidate `send` on every render — which would restart effects downstream.
  const callbacks = useRef(options);
  callbacks.current = options;

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const send = useCallback(
    async (content: string): Promise<void> => {
      const trimmed = content.trim();
      if (trimmed.length === 0) return;

      // A second send while one is in flight replaces it rather than
      // interleaving two streams into the same transcript.
      stop();

      const controller = new AbortController();
      abortRef.current = controller;

      // Settle the UI the moment Stop is pressed, without waiting for the
      // transport to notice. A well-behaved transport rejects promptly on
      // abort, but a badly-behaved one leaves the caret blinking forever — and
      // that is not a failure mode worth inheriting from a third-party adapter.
      controller.signal.addEventListener(
        'abort',
        () => {
          store.fail(new ChatAbortError());
        },
        { once: true },
      );

      store.appendMessage({ role: 'user', content: trimmed });
      store.setStatus('submitted');
      const assistantId = store.appendMessage({
        role: 'assistant',
        content: '',
      });

      const request = {
        messages: store
          .getSnapshot()
          .messages.filter((message) => message.id !== assistantId)
          .map((message) => ({ role: message.role, content: message.content })),
        ...(callbacks.current.options !== undefined
          ? { options: callbacks.current.options }
          : {}),
      };

      try {
        const stream = await callbacks.current.transport.send(request, {
          signal: controller.signal,
        });
        store.startStreaming(assistantId);

        const reader = stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value.type === 'delta') {
            store.appendDelta(assistantId, value.text);
          } else if (value.type === 'done') {
            store.finishStreaming(assistantId);
            const finished = store.getMessageSnapshot(assistantId);
            if (finished) callbacks.current.onFinish?.(finished);
          } else {
            store.fail(value.error);
            if (!(value.error instanceof ChatAbortError)) {
              callbacks.current.onError?.(value.error);
            }
          }
        }
      } catch (error) {
        const normalised = controller.signal.aborted
          ? new ChatAbortError()
          : error;
        store.fail(normalised);
        if (!(normalised instanceof ChatAbortError)) {
          callbacks.current.onError?.(normalised);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [store, stop],
  );

  const reset = useCallback(() => {
    stop();
    store.reset();
  }, [store, stop]);

  // An unmount mid-stream must cancel the request. Without this the fetch runs
  // to completion in the background, billing the user for tokens nobody will
  // ever see and writing into a store nothing is reading.
  useEffect(() => () => abortRef.current?.abort(), []);

  return useMemo(
    () => ({
      messages: snapshot.messages,
      status: snapshot.status,
      error: snapshot.error,
      isStreaming: snapshot.status === 'streaming',
      send,
      stop,
      reset,
      store,
    }),
    [snapshot, send, stop, reset, store],
  );
}
