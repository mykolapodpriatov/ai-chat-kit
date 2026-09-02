// The implementation this package ships: the transcript renders ids, and each
// row subscribes to its own message through the external store.

import { memo } from 'react';

import type { ChatStore } from '../src/core/store';
import { useChatMessage } from '../src/hooks/useChatMessage';

export interface SubscribedRowProps {
  store: ChatStore;
  id: string;
  onRender: (id: string) => void;
}

export const SubscribedRow = memo(function SubscribedRow({
  store,
  id,
  onRender,
}: SubscribedRowProps) {
  const message = useChatMessage(store, id);
  onRender(id);
  return <li data-testid={id}>{message?.content}</li>;
});

export interface SubscribedChatProps {
  store: ChatStore;
  ids: string[];
  onRender: (id: string) => void;
}

export function SubscribedChat({ store, ids, onRender }: SubscribedChatProps) {
  return (
    <ul>
      {ids.map((id) => (
        <SubscribedRow key={id} store={store} id={id} onRender={onRender} />
      ))}
    </ul>
  );
}
