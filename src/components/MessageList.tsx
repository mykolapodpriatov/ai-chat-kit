'use client';

import type { ReactNode } from 'react';

import type { ChatStore } from '../core/store';
import type { ChatMessage } from '../core/types';
import { MessageBubble } from './MessageBubble';

// The transcript.
//
// It renders ids, not content — the rows fetch their own message from the
// store. That is what keeps a delta from re-rendering the list: the array of
// ids only changes when a message is added or removed.
//
// Accessibility: the region is a polite live region, not assertive. A streaming
// answer produces hundreds of mutations a second, and an assertive region would
// make a screen reader interrupt itself continuously — unusable. Polite lets
// the reader finish its sentence and announce the settled text.

export interface MessageListProps {
  store: ChatStore;
  messages: readonly ChatMessage[];
  className?: string;
  messageClassName?: string;
  /** Rendered when the conversation is empty. */
  empty?: ReactNode;
}

export function MessageList({
  store,
  messages,
  className,
  messageClassName,
  empty,
}: MessageListProps) {
  if (messages.length === 0 && empty) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <ul
      className={className}
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Conversation"
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          store={store}
          id={message.id}
          {...(messageClassName !== undefined
            ? { className: messageClassName }
            : {})}
        />
      ))}
    </ul>
  );
}
