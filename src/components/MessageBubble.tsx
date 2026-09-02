'use client';

import { memo } from 'react';

import type { ChatStore } from '../core/store';
import { useChatMessage } from '../hooks/useChatMessage';

// One row of the transcript, subscribed to one message.
//
// The subscription is the point: this component re-renders when its own message
// changes and at no other time, so a reply streaming into the last row leaves
// every earlier row untouched. `memo` is belt and braces — the props are a
// store reference and an id, both stable.

export interface MessageBubbleProps {
  store: ChatStore;
  id: string;
  className?: string;
}

const ROLE_LABEL: Record<string, string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
};

export const MessageBubble = memo(function MessageBubble({
  store,
  id,
  className,
}: MessageBubbleProps) {
  const message = useChatMessage(store, id);
  if (!message) return null;

  return (
    <li
      data-role={message.role}
      data-streaming={message.streaming || undefined}
      className={className}
    >
      <span data-part="role">{ROLE_LABEL[message.role] ?? message.role}</span>
      {/*
        `whiteSpace: pre-wrap` rather than splitting on newlines: model output is
        full of them, and losing them turns a formatted answer into a wall.
      */}
      <div data-part="content" style={{ whiteSpace: 'pre-wrap' }}>
        {message.content}
        {message.streaming ? (
          <span data-part="caret" aria-hidden>
            ▌
          </span>
        ) : null}
      </div>
    </li>
  );
});
