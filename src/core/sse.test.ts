import { describe, expect, it } from 'vitest';

import { ParseError } from './errors';
import { parseSseStream } from './sse';

/** Feeds the parser arbitrary chunk boundaries, which is the whole point. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<string>): Promise<string[]> {
  const out: string[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe('parseSseStream', () => {
  it('reads a single complete event', async () => {
    const events = await collect(parseSseStream(streamOf('data: hello\n\n')));

    expect(events).toEqual(['hello']);
  });

  it('reassembles an event split across chunk boundaries', async () => {
    // The single most common way a hand-rolled SSE parser breaks: the network
    // does not respect message boundaries.
    const events = await collect(
      parseSseStream(streamOf('data: hel', 'lo wo', 'rld\n\n')),
    );

    expect(events).toEqual(['hello world']);
  });

  it('splits multiple events delivered in one chunk', async () => {
    const events = await collect(
      parseSseStream(streamOf('data: one\n\ndata: two\n\ndata: three\n\n')),
    );

    expect(events).toEqual(['one', 'two', 'three']);
  });

  it('handles a boundary that falls between the two newlines', async () => {
    const events = await collect(
      parseSseStream(streamOf('data: one\n', '\ndata: two\n\n')),
    );

    expect(events).toEqual(['one', 'two']);
  });

  it('accepts CRLF line endings', async () => {
    const events = await collect(
      parseSseStream(streamOf('data: one\r\n\r\ndata: two\r\n\r\n')),
    );

    expect(events).toEqual(['one', 'two']);
  });

  it('joins multi-line data fields with a newline, per the spec', async () => {
    const events = await collect(
      parseSseStream(streamOf('data: first\ndata: second\n\n')),
    );

    expect(events).toEqual(['first\nsecond']);
  });

  it('ignores comment lines used as keep-alives', async () => {
    const events = await collect(
      parseSseStream(streamOf(': ping\n\ndata: real\n\n')),
    );

    expect(events).toEqual(['real']);
  });

  it('ignores fields it does not care about', async () => {
    const events = await collect(
      parseSseStream(streamOf('event: message\nid: 7\ndata: payload\n\n')),
    );

    expect(events).toEqual(['payload']);
  });

  it('tolerates a missing space after the colon', async () => {
    const events = await collect(parseSseStream(streamOf('data:tight\n\n')));

    expect(events).toEqual(['tight']);
  });

  it('emits a trailing event that was never terminated by a blank line', async () => {
    // Providers close the connection after the final chunk often enough that
    // dropping it silently truncates the last token.
    const events = await collect(parseSseStream(streamOf('data: last')));

    expect(events).toEqual(['last']);
  });

  it('emits nothing for an empty stream', async () => {
    expect(await collect(parseSseStream(streamOf()))).toEqual([]);
  });

  it('emits nothing for a stream of only keep-alives', async () => {
    expect(
      await collect(parseSseStream(streamOf(': ping\n\n: ping\n\n'))),
    ).toEqual([]);
  });

  it('handles a multi-byte character split across chunks', async () => {
    // "…" is three bytes; cutting between them must not produce a replacement
    // character. This is why decoding is streaming rather than per-chunk.
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: héllo…\n\n');
    const cut = 9;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });

    expect(await collect(parseSseStream(stream))).toEqual(['héllo…']);
  });

  it('propagates a failure from the underlying stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('socket hang up'));
      },
    });

    await expect(collect(parseSseStream(stream))).rejects.toThrow(
      'socket hang up',
    );
  });
});

describe('parseSseStream with a payload decoder', () => {
  it('applies the decoder to each event', async () => {
    const events = await collect(
      parseSseStream(streamOf('data: {"n":1}\n\ndata: {"n":2}\n\n'), {
        decode: (raw) => String((JSON.parse(raw) as { n: number }).n * 10),
      }),
    );

    expect(events).toEqual(['10', '20']);
  });

  it('skips events the decoder declines by returning null', async () => {
    const events = await collect(
      parseSseStream(streamOf('data: keep\n\ndata: drop\n\ndata: keep\n\n'), {
        decode: (raw) => (raw === 'drop' ? null : raw),
      }),
    );

    expect(events).toEqual(['keep', 'keep']);
  });

  it('wraps a decoder throw in a ParseError carrying the chunk', async () => {
    const promise = collect(
      parseSseStream(streamOf('data: not-json\n\n'), {
        decode: (raw) => JSON.parse(raw) as string,
      }),
    );

    await expect(promise).rejects.toBeInstanceOf(ParseError);
    await expect(promise).rejects.toMatchObject({ chunk: 'not-json' });
  });
});
