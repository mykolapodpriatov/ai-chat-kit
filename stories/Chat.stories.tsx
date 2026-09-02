import type { Meta, StoryObj } from '@storybook/react-vite';

import { NetworkError, RateLimitError, createMockTransport } from '../src';
import { DemoChat } from './DemoChat';

const REPLY =
  'Streaming state lives outside React in this library, so each token replaces ' +
  'one message object instead of invalidating the whole transcript. Try typing ' +
  'again while this is still arriving — the Send button becomes Stop.';

const meta = {
  title: 'Chat',
  component: DemoChat,
  parameters: {
    docs: {
      description: {
        component:
          'Every story runs on MockTransport: no API key, works offline, and ' +
          'reaches states a live demo cannot produce on demand — a failure ' +
          'after two tokens, a rate limit, a stream you can interrupt.',
      },
    },
  },
} satisfies Meta<typeof DemoChat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The everyday case. Type something and watch it stream in. */
export const Streaming: Story = {
  args: {
    transport: createMockTransport({ script: REPLY, delayMs: 45 }),
  },
};

/** A conversation already in progress, so the transcript has something in it. */
export const WithHistory: Story = {
  args: {
    transport: createMockTransport({ script: REPLY, delayMs: 45 }),
    initialMessages: [
      { role: 'user', content: 'What makes this different from useState?' },
      {
        role: 'assistant',
        content:
          'With useState every token re-renders the whole transcript. Here a ' +
          'token re-renders one row.',
      },
      { role: 'user', content: 'Does that matter in practice?' },
      {
        role: 'assistant',
        content:
          'At 1,000 messages the naive approach performs 200,000 row renders ' +
          'where this one performs 200.',
      },
    ],
  },
};

/** Slow enough to press Stop and see the partial reply kept. */
export const SlowEnoughToInterrupt: Story = {
  args: {
    transport: createMockTransport({
      script: `${REPLY} ${REPLY}`,
      delayMs: 140,
    }),
  },
};

/**
 * The provider dies mid-answer. Whatever streamed is kept — a half-written
 * reply with an error beside it beats a blank space.
 */
export const FailsMidStream: Story = {
  args: {
    transport: createMockTransport({
      script: REPLY,
      delayMs: 45,
      failAfter: 6,
      error: new NetworkError('The provider returned 502 Bad Gateway.', {
        status: 502,
      }),
    }),
  },
};

/** A 429. The typed error carries Retry-After so a retry can obey it. */
export const RateLimited: Story = {
  args: {
    transport: createMockTransport({
      script: REPLY,
      delayMs: 45,
      failAfter: 0,
      error: new RateLimitError(
        'Rate limited. The provider asked to wait 30 seconds.',
        { retryAfterMs: 30_000 },
      ),
    }),
  },
};

/** A reply with newlines and structure, to show whitespace is preserved. */
export const MultilineReply: Story = {
  args: {
    transport: createMockTransport({
      script: [
        'Three',
        ' things',
        ' matter:\n\n',
        '1. ',
        'chunk',
        ' boundaries\n',
        '2. ',
        'multi-byte',
        ' characters\n',
        '3. ',
        'the',
        ' final',
        ' event\n',
      ],
      delayMs: 90,
    }),
  },
};
