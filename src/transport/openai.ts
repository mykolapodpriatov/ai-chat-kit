// Adapter for any provider speaking the OpenAI chat-completions wire format.
//
// That covers OpenAI itself, Azure OpenAI, Groq, Together, OpenRouter, vLLM,
// Ollama's compatibility endpoint, and most corporate gateways — which is why
// this is the one adapter worth shipping in v1. Everything provider-specific
// lives here; the core never learns any of it.
//
// The job is small and entirely about translation:
//
//   request  → HTTP + JSON, with caller options passed through untouched
//   response → HTTP status mapped onto the library's typed errors
//   body     → SSE frames decoded into `delta` events
//
// A note on where errors surface: a non-2xx rejects the promise rather than
// emitting an `error` event, because there is no stream yet. Failures that
// happen mid-stream arrive as events. Retry policy handles both because both
// carry the same error types.

import { ChatAbortError, NetworkError, RateLimitError } from '../core/errors';
import { parseSseStream } from '../core/sse';
import type { ChatRequest, StreamEvent } from '../core/types';
import type { ChatTransport } from './types';

export interface OpenAICompatibleOptions {
  /** Omitted entirely when absent — local models 401 on "Bearer undefined". */
  apiKey?: string;
  model: string;
  /** Defaults to OpenAI. Point it at a gateway or a local server otherwise. */
  baseUrl?: string;
  /** Extra headers, e.g. an org id or a gateway's routing header. */
  headers?: Readonly<Record<string, string>>;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DONE_SENTINEL = '[DONE]';

interface CompletionChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
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
  // status — a truncated error body is still a 502.
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

export function createOpenAICompatibleTransport(
  options: OpenAICompatibleOptions,
): ChatTransport {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async send(request: ChatRequest, { signal }) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...options.headers,
      };
      if (options.apiKey !== undefined) {
        headers.Authorization = `Bearer ${options.apiKey}`;
      }

      const body = JSON.stringify({
        model: options.model,
        stream: true,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        // Caller options last so a consumer can override anything above,
        // including the model — a gateway may route on it.
        ...request.options,
      });

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
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
          if (raw === DONE_SENTINEL) return null;
          const parsed = JSON.parse(raw) as CompletionChunk;
          // The first frame carries `role` and no content; later frames can
          // carry an empty string. Neither is worth waking the UI for.
          const content = parsed.choices?.[0]?.delta?.content;
          return typeof content === 'string' && content.length > 0
            ? content
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
