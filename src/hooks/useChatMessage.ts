'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { ChatStore } from '../core/store';
import type { ChatMessage } from '../core/types';

// Subscribe to exactly one message.
//
// This is the hook the whole architecture exists to make possible. A component
// using it re-renders when *its* message changes and at no other time — so a
// 500-token reply streaming into the last message leaves the other forty rows
// of the transcript untouched, rather than re-rendering all of them 500 times.
//
// `useChatStream` still re-renders its own component per delta, because the
// conversation snapshot genuinely changed. Keep that component thin and let the
// rows subscribe individually; that is the pattern the components in this
// package follow.

export function useChatMessage(
  store: ChatStore,
  id: string,
): ChatMessage | undefined {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeToMessage(id, listener),
    [store, id],
  );

  const getSnapshot = useCallback(
    () => store.getMessageSnapshot(id),
    [store, id],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
