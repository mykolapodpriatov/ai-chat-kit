// A Server-Sent Events parser that survives real networks.
//
// The wire format is trivial to describe and easy to get wrong, because chunk
// boundaries have nothing to do with message boundaries. Three failures show up
// again and again in hand-rolled parsers:
//
//   1. an event split across two chunks is dropped or duplicated;
//   2. a multi-byte character split across two chunks decodes to U+FFFD;
//   3. the final event is discarded when the provider closes the connection
//      without a trailing blank line — which silently truncates the last token.
//
// This handles all three: decoding is streaming (`TextDecoder` with
// `{ stream: true }`), the buffer persists across chunks, and `flush` emits
// whatever is left.
//
// Only `data:` is interpreted. `event:`, `id:` and `retry:` are consumed and
// ignored — no provider this targets uses them, and inventing semantics for
// them would be guessing.

import { ParseError } from './errors';

export interface ParseSseOptions {
  /**
   * Turns a raw `data:` payload into the value the consumer wants.
   *
   * Return `null` to drop the event — that is how a transport skips sentinels
   * such as `[DONE]` without the parser knowing they exist. Throwing is
   * reported as a `ParseError` carrying the offending payload.
   */
  decode?: (raw: string) => string | null;
}

const FIELD_SEPARATOR = ':';

/** Extracts the `data:` payload from one event block, or null if it has none. */
function payloadOf(block: string): string | null {
  const lines: string[] = [];

  for (const line of block.split('\n')) {
    // A line starting with a colon is a comment; providers send them as
    // keep-alives to stop intermediaries closing an idle connection.
    if (line.startsWith(FIELD_SEPARATOR)) continue;

    const separator = line.indexOf(FIELD_SEPARATOR);
    const field = separator === -1 ? line : line.slice(0, separator);
    if (field !== 'data') continue;

    const value = separator === -1 ? '' : line.slice(separator + 1);
    // The spec strips exactly one leading space, so `data:x` and `data: x` mean
    // the same thing and `data:  x` keeps one space.
    lines.push(value.startsWith(' ') ? value.slice(1) : value);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Turn a byte stream of SSE into a stream of payloads.
 *
 * The result is a `ReadableStream` rather than an async generator so it can be
 * cancelled by the same `AbortController` that cancels the fetch, and so
 * back-pressure from a slow consumer reaches the socket.
 */
export function parseSseStream(
  source: ReadableStream<Uint8Array>,
  options: ParseSseOptions = {},
): ReadableStream<string> {
  const decoder = new TextDecoder();
  const decode = options.decode;
  let buffer = '';

  const emit = (
    block: string,
    controller: TransformStreamDefaultController<string>,
  ): void => {
    const raw = payloadOf(block);
    if (raw === null) return;

    if (!decode) {
      controller.enqueue(raw);
      return;
    }

    let decoded: string | null;
    try {
      decoded = decode(raw);
    } catch (cause) {
      throw new ParseError('Could not decode a server-sent event.', {
        chunk: raw,
        cause,
      });
    }
    if (decoded !== null) controller.enqueue(decoded);
  };

  const transform = new TransformStream<Uint8Array, string>({
    transform(chunk, controller) {
      // `stream: true` keeps a partial multi-byte character in the decoder
      // rather than emitting a replacement character for it.
      buffer += decoder.decode(chunk, { stream: true });
      // Normalise CRLF up front so the block split below only needs one rule.
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.length > 0) emit(block, controller);
        boundary = buffer.indexOf('\n\n');
      }
    },

    flush(controller) {
      buffer += decoder.decode();
      const remainder = buffer.replace(/\r\n/g, '\n').trim();
      buffer = '';
      if (remainder.length > 0) emit(remainder, controller);
    },
  });

  return source.pipeThrough(transform);
}
