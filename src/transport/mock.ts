// A transport that answers from a script instead of a network.
//
// It exists for three jobs, and doing all three from one implementation is
// deliberate — a demo that drifts from what the tests exercise is worse than no
// demo:
//
//   1. tests, where a real provider would be slow, flaky and expensive;
//   2. the Storybook demo, which must work with no API key;
//   3. reproducing a failure — "it broke after the third token" is a one-line
//      script here and nearly impossible to arrange against a live model.
//
// Timing is simulated rather than instant so a UI built against it has to cope
// with real streaming: partial words, a caret that moves, a Stop button that
// has something to stop.

import { ChatAbortError } from '../core/errors';
import type { ChatRequest, StreamEvent } from '../core/types';
import type { ChatTransport } from './types';

export interface MockTransportOptions {
  /**
   * What to reply.
   *
   * A string is split into word-sized chunks; an array of strings is used as
   * the exact token sequence; an array of arrays plays a different reply per
   * call, repeating the last one once exhausted.
   */
  script: string | string[] | string[][];
  /** Milliseconds between tokens. Keep it small in tests, human in demos. */
  delayMs?: number;
  /** Emit an error after this many tokens instead of finishing. */
  failAfter?: number;
  /** The error to emit. Defaults to a network failure. */
  error?: unknown;
}

export interface MockTransport extends ChatTransport {
  /** Every request received, in order — assert on the prompt without a spy. */
  readonly requests: readonly ChatRequest[];
}

/** Splits text the way a model streams it: words, with their trailing space. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

function normaliseScripts(script: MockTransportOptions['script']): string[][] {
  if (typeof script === 'string') return [tokenize(script)];
  if (script.length === 0) return [[]];
  return script.every((entry): entry is string[] => Array.isArray(entry))
    ? script
    : [script as string[]];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createMockTransport(
  options: MockTransportOptions,
): MockTransport {
  const scripts = normaliseScripts(options.script);
  const delayMs = options.delayMs ?? 25;
  const requests: ChatRequest[] = [];
  let callIndex = 0;

  return {
    requests,

    async send(request, { signal }) {
      requests.push(request);
      // Clamp rather than wrap: a demo that loops back to its first answer
      // after N turns looks like a bug.
      const tokens = scripts[Math.min(callIndex, scripts.length - 1)] ?? [];
      callIndex += 1;

      return new ReadableStream<StreamEvent>({
        async start(controller) {
          try {
            for (const [index, token] of tokens.entries()) {
              if (signal.aborted) {
                controller.enqueue({
                  type: 'error',
                  error: new ChatAbortError(),
                });
                controller.close();
                return;
              }

              if (
                options.failAfter !== undefined &&
                index >= options.failAfter
              ) {
                controller.enqueue({
                  type: 'error',
                  error: options.error ?? new Error('Mock transport failure.'),
                });
                controller.close();
                return;
              }

              controller.enqueue({ type: 'delta', text: token });
              if (delayMs > 0) await sleep(delayMs);
            }

            // A failAfter past the end of the script still has to fail, or a
            // test asking for "fail on the last token" would silently pass.
            if (
              options.failAfter !== undefined &&
              options.failAfter >= tokens.length
            ) {
              controller.enqueue({
                type: 'error',
                error: options.error ?? new Error('Mock transport failure.'),
              });
            } else if (signal.aborted) {
              controller.enqueue({
                type: 'error',
                error: new ChatAbortError(),
              });
            } else {
              controller.enqueue({ type: 'done' });
            }
            controller.close();
          } catch (error) {
            controller.enqueue({ type: 'error', error });
            controller.close();
          }
        },
      });
    },
  };
}
