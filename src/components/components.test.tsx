import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createChatStore } from '../core/store';
import { NetworkError } from '../core/errors';
import { createMockTransport } from '../transport/mock';
import { expectNoA11yViolations } from '../../test/a11y';
import { Chat } from './Chat';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

describe('<MessageList />', () => {
  it('renders one row per message with its role label', () => {
    const store = createChatStore({
      initialMessages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });

    render(
      <MessageList store={store} messages={store.getSnapshot().messages} />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
  });

  it('announces politely rather than assertively', () => {
    // Assertive would make a screen reader interrupt itself on every token.
    const store = createChatStore();
    render(
      <MessageList store={store} messages={[]} empty={<p>Nothing yet</p>} />,
    );

    render(
      <MessageList store={store} messages={store.getSnapshot().messages} />,
    );
    expect(screen.getByLabelText('Conversation')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('shows the empty state when there are no messages', () => {
    const store = createChatStore();
    render(
      <MessageList store={store} messages={[]} empty={<p>Nothing yet</p>} />,
    );

    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });

  it('marks the streaming row and shows a caret hidden from screen readers', () => {
    const store = createChatStore();
    const id = store.appendMessage({ role: 'assistant', content: 'partial' });

    const { container } = render(
      <MessageList store={store} messages={store.getSnapshot().messages} />,
    );
    act(() => {
      store.startStreaming(id);
    });

    expect(container.querySelector('[data-streaming]')).toBeInTheDocument();
    expect(container.querySelector('[data-part="caret"]')).toHaveAttribute(
      'aria-hidden',
    );
  });

  it('preserves newlines in model output', () => {
    const store = createChatStore({
      initialMessages: [{ role: 'assistant', content: 'one\ntwo' }],
    });

    const { container } = render(
      <MessageList store={store} messages={store.getSnapshot().messages} />,
    );

    expect(container.querySelector('[data-part="content"]')).toHaveStyle({
      whiteSpace: 'pre-wrap',
    });
  });
});

describe('<Composer />', () => {
  it('sends on Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    await user.type(screen.getByLabelText('Message'), 'hello{Enter}');

    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    await user.type(
      screen.getByLabelText('Message'),
      'one{Shift>}{Enter}{/Shift}two',
    );

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message')).toHaveValue('one\ntwo');
  });

  it('clears the input and keeps focus after sending', async () => {
    const user = userEvent.setup();
    render(<Composer onSend={vi.fn()} />);
    const input = screen.getByLabelText('Message');

    await user.type(input, 'hello{Enter}');

    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('refuses to send whitespace', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    await user.type(screen.getByLabelText('Message'), '   {Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables Send until there is something to send', async () => {
    const user = userEvent.setup();
    render(<Composer onSend={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(screen.getByLabelText('Message'), 'x');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('offers Stop while streaming, not a disabled Send', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<Composer onSend={vi.fn()} onStop={onStop} isStreaming />);

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Send' }),
    ).not.toBeInTheDocument();
  });
});

describe('<Chat />', () => {
  it('runs a full turn end to end', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport({
      script: ['Hello', ' there'],
      delayMs: 0,
    });
    render(<Chat transport={transport} />);

    await user.type(screen.getByLabelText('Message'), 'hi{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Hello there')).toBeInTheDocument(),
    );
  });

  it('surfaces a failure as an alert and keeps the partial reply', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport({
      script: ['par', 'tial', ' more'],
      delayMs: 0,
      failAfter: 2,
      error: new NetworkError('upstream died', { status: 502 }),
    });
    render(<Chat transport={transport} />);

    await user.type(screen.getByLabelText('Message'), 'hi{Enter}');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('partial')).toBeInTheDocument();
  });

  it('reflects the conversation status on the container', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport({ script: ['ok'], delayMs: 0 });
    const { container } = render(<Chat transport={transport} />);

    await user.type(screen.getByLabelText('Message'), 'hi{Enter}');

    await waitFor(() =>
      expect(container.firstElementChild).toHaveAttribute(
        'data-status',
        'idle',
      ),
    );
  });
});

describe('accessibility', () => {
  it('an empty chat has no violations', async () => {
    const transport = createMockTransport({ script: ['x'], delayMs: 0 });
    const { container } = render(<Chat transport={transport} />);

    await expectNoA11yViolations(container);
  });

  it('a chat mid-conversation has no violations', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport({ script: ['reply'], delayMs: 0 });
    const { container } = render(<Chat transport={transport} />);

    await user.type(screen.getByLabelText('Message'), 'hi{Enter}');
    await waitFor(() => expect(screen.getByText('reply')).toBeInTheDocument());

    await expectNoA11yViolations(container);
  });

  it('a chat showing an error has no violations', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport({
      script: ['x'],
      delayMs: 0,
      failAfter: 0,
      error: new NetworkError('upstream died'),
    });
    const { container } = render(<Chat transport={transport} />);

    await user.type(screen.getByLabelText('Message'), 'hi{Enter}');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    await expectNoA11yViolations(container);
  });

  it('a chat mid-stream has no violations', async () => {
    const user = userEvent.setup();
    const transport = createMockTransport({
      script: Array.from({ length: 40 }, () => 'x'),
      delayMs: 10,
    });
    const { container } = render(<Chat transport={transport} />);

    await user.type(screen.getByLabelText('Message'), 'hi{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument(),
    );

    await expectNoA11yViolations(container);
  });
});
