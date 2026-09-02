// The implementation this package argues against, written fairly.
//
// This is not a straw man: it is what a competent developer writes first, and
// it is correct. Streaming state lives in React, deltas arrive through
// setState, and the transcript is rendered from that state. The problem is
// structural rather than a mistake — every delta invalidates the state that
// owns the whole list, so React re-renders every row.

import { useCallback, useEffect, useState } from 'react';

import type { ChatMessage } from '../src/core/types';

export interface NaiveRowProps {
  message: ChatMessage;
  onRender: (id: string) => void;
}

export function NaiveRow({ message, onRender }: NaiveRowProps) {
  onRender(message.id);
  return <li data-testid={message.id}>{message.content}</li>;
}

export interface NaiveChatProps {
  initial: ChatMessage[];
  onRender: (id: string) => void;
  register: (append: (id: string, text: string) => void) => void;
}

export function NaiveChat({ initial, onRender, register }: NaiveChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);

  const append = useCallback((id: string, text: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? { ...message, content: message.content + text }
          : message,
      ),
    );
  }, []);

  // Registered in an effect rather than during render: touching a ref while
  // rendering is exactly the kind of thing React's lint rules exist to catch,
  // and effects have flushed by the time render() returns in Testing Library,
  // so the benchmark still has `append` when it needs it.
  useEffect(() => {
    register(append);
  }, [register, append]);

  return (
    <ul>
      {messages.map((message) => (
        <NaiveRow key={message.id} message={message} onRender={onRender} />
      ))}
    </ul>
  );
}
