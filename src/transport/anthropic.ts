// Adapter for Anthropic's own Messages API.
//
// The OpenAI-compatible adapter already reaches most of the market, so this one
// earns its place only where the compatible endpoint falls short: extended
// thinking and prompt caching are Anthropic-specific and unreachable through the
// OpenAI-shaped surface. Otherwise this is the same job as
// `createOpenAICompatibleTransport`, just translation, not a new design:
//
//   request  → HTTP + JSON, with caller options passed through untouched
//   response → HTTP status mapped onto the library's typed errors
//   body     → SSE frames decoded into `delta` events
//
// The wire format differs from OpenAI's in three ways worth naming: the
// endpoint is `/messages`, not `/chat/completions`; authentication is
// `x-api-key` plus a required `anthropic-version` header, not a bearer token;
// and a system prompt is a top-level `system` field, not a message with role
// `system`.
//
// Anthropic names each SSE frame with an `event:` line, but every payload also
// carries its own `type` in the JSON body (`content_block_delta`,
// `message_stop`, …), which is all this adapter reads. `event:`, like `id:`
// and `retry:`, is already ignored by `parseSseStream`.
//
// Tool use streams as `input_json_delta` events. This library has no tool-call
// rendering yet (ADR 003), so those deltas are recognised and dropped rather
// than surfaced as text. That is the same treatment the OpenAI adapter gives
// the opening role frame that carries no content.

import { ChatAbortError, NetworkError, RateLimitError } from '../core/errors';
import { parseSseStream } from '../core/sse';
import type { ChatRequest, StreamEvent } from '../core/types';
import type { ChatTransport } from './types';

export interface AnthropicTransportOptions {
  /** Omitted entirely when absent, since a backend proxy may inject it instead. */
  apiKey?: string;
  model: string;
  /** Defaults to Anthropic. Point it at a gateway otherwise. */
  baseUrl?: string;
  /** Extra headers, e.g. a gateway's routing header or a newer `anthropic-version`. */
  headers?: Readonly<Record<string, string>>;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
// Anthropic requires max_tokens on every request; unlike OpenAI it has no
// server-side default. Overridable through `request.options`, same as
// everything else. This is a sensible default, not a limit anyone asked for.
const DEFAULT_MAX_TOKENS = 4096;

interface AnthropicStreamEvent {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
}

/** `Retry-After` is seconds or an HTTP date; both are worth honouring. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const timestamp = Date.parse(header);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

async function toTypedError(response: Response): Promise<never> {
  // Read the body for the message, but never let a failure to read it mask the
  // status: a truncated error body is still a 529.
  const detail = await response.text().catch(() => '');
  const summary = detail.slice(0, 200);

  if (response.status === 429) {
    const options: { retryAfterMs?: number } = {};
    const wait = retryAfterMs(response.headers.get('retry-after'));
    if (wait !== undefined) options.retryAfterMs = wait;
    throw new RateLimitError(
      `The provider rate-limited the request. ${summary}`.trim(),
      options,
    );
  }

  throw new NetworkError(
    `The provider returned ${response.status} ${response.statusText}. ${summary}`.trim(),
    { status: response.status },
  );
}

export function createAnthropicTransport(
  options: AnthropicTransportOptions,
): ChatTransport {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async send(request: ChatRequest, { signal }) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'anthropic-version': ANTHROPIC_VERSION,
        ...options.headers,
      };
      if (options.apiKey !== undefined) {
        headers['x-api-key'] = options.apiKey;
      }

      // Anthropic takes a system prompt as a top-level field, not a message,
      // unlike OpenAI, which treats `system` as just another role in the array.
      const systemPrompt = request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');
      const conversationMessages = request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content }));

      const body = JSON.stringify({
        model: options.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        stream: true,
        ...(systemPrompt.length > 0 ? { system: systemPrompt } : {}),
        messages: conversationMessages,
        // Caller options last so a consumer can override anything above,
        // including the model or max_tokens.
        ...request.options,
      });

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers,
          body,
          signal,
        });
      } catch (error) {
        if (isAbort(error, signal)) throw new ChatAbortError();
        throw new NetworkError('Could not reach the provider.', {
          cause: error,
        });
      }

      if (!response.ok) await toTypedError(response);

      if (!response.body) {
        throw new NetworkError(
          'The provider returned a successful status with no response body.',
          { status: response.status },
        );
      }

      const text = parseSseStream(response.body, {
        decode: (raw) => {
          const parsed = JSON.parse(raw) as AnthropicStreamEvent;
          if (parsed.type !== 'content_block_delta') return null;
          // `input_json_delta` (tool use) and `thinking_delta` (extended
          // thinking) are recognised, not just ignored by accident. This
          // library only surfaces text_delta as `delta` events until tool-call
          // rendering gets its own design (ADR 003).
          if (parsed.delta?.type !== 'text_delta') return null;
          const chunkText = parsed.delta.text;
          return typeof chunkText === 'string' && chunkText.length > 0
            ? chunkText
            : null;
        },
      });

      // One more transform rather than an async generator so the stream stays
      // cancellable through the same signal that cancels the fetch.
      return text.pipeThrough(
        new TransformStream<string, StreamEvent>({
          transform(chunkText, controller) {
            controller.enqueue({ type: 'delta', text: chunkText });
          },
          flush(controller) {
            controller.enqueue(
              signal.aborted
                ? { type: 'error', error: new ChatAbortError() }
                : { type: 'done' },
            );
          },
        }),
      );
    },
  };
}
