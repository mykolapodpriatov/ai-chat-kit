'use client';

import {
  useChatStream,
  type UseChatStreamOptions,
} from '../hooks/useChatStream';
import type { ReactNode } from 'react';

import { Composer } from './Composer';
import { MessageList } from './MessageList';

// The batteries-included component: a working chat in one line.
//
// It is deliberately thin. Anything beyond "transcript plus composer plus an
// error line" belongs in the consumer's own composition of MessageList,
// Composer and useChatStream — a component with thirty props to cover every
// layout is worse than no component at all.

export interface ChatProps extends UseChatStreamOptions {
  className?: string;
  placeholder?: string;
  empty?: ReactNode;
  /** Renders the failure; defaults to a plain alert with the message. */
  renderError?: (error: unknown) => ReactNode;
}

function defaultRenderError(error: unknown): ReactNode {
  const message =
    error instanceof Error ? error.message : 'Something went wrong.';
  return <div role="alert">{message}</div>;
}

export function Chat({
  className,
  placeholder,
  empty,
  renderError = defaultRenderError,
  ...options
}: ChatProps) {
  const chat = useChatStream(options);

  return (
    <div className={className} data-status={chat.status}>
      <MessageList
        store={chat.store}
        messages={chat.messages}
        {...(empty !== undefined ? { empty } : {})}
      />
      {chat.error ? renderError(chat.error) : null}
      <Composer
        onSend={(content) => void chat.send(content)}
        onStop={chat.stop}
        isStreaming={chat.isStreaming}
        {...(placeholder !== undefined ? { placeholder } : {})}
      />
    </div>
  );
}
