// The demo composition used by the stories.
//
// It exists to show what a consumer actually writes: pick a transport, call the
// hook, arrange MessageList and Composer, bring your own classes. The package
// ships no CSS — a library that injects styles fights every design system it
// meets — so all the appearance here comes from .storybook/preview.css.

import {
  Composer,
  MessageList,
  useChatStream,
  type ChatTransport,
} from '../src';

export interface DemoChatProps {
  transport: ChatTransport;
  initialMessages?: ReadonlyArray<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

export function DemoChat({ transport, initialMessages }: DemoChatProps) {
  const chat = useChatStream({
    transport,
    ...(initialMessages !== undefined ? { initialMessages } : {}),
  });

  return (
    <div className="demo-chat" data-status={chat.status}>
      <MessageList
        store={chat.store}
        messages={chat.messages}
        className="demo-list"
        messageClassName="demo-message"
        empty={<p className="demo-empty">Ask something to start.</p>}
      />

      {chat.error ? (
        <div role="alert" className="demo-error">
          {chat.error instanceof Error
            ? chat.error.message
            : 'Something went wrong.'}
        </div>
      ) : null}

      <Composer
        onSend={(content) => void chat.send(content)}
        onStop={chat.stop}
        isStreaming={chat.isStreaming}
        className="demo-composer"
        inputClassName="demo-input"
        buttonClassName="demo-button"
      />
    </div>
  );
}
