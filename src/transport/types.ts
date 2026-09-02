// The seam between this library and any particular provider.
//
// The core knows nothing about URLs, headers, auth or payload shapes. A
// transport translates one provider's wire format into `StreamEvent`s and
// nothing else crosses the boundary. That is what lets the same store, hooks
// and components serve OpenAI, a self-hosted model, a recorded fixture, or a
// company's own gateway without any of them knowing about the others.
//
// The contract a transport must honour:
//
//   - emit zero or more `delta` events, then exactly one terminal event
//     (`done` or `error`), then close the stream;
//   - reject or emit `error` with one of the library's typed errors, so retry
//     policy can classify it;
//   - stop promptly when `signal` aborts, and not treat that as a failure.

import type { ChatRequest, StreamEvent } from '../core/types';

export interface ChatTransport {
  /**
   * Start a completion.
   *
   * Returning a stream rather than taking a callback keeps cancellation and
   * back-pressure in one object, and lets the caller compose it with other
   * streams without inventing an adapter.
   */
  send(
    request: ChatRequest,
    options: { signal: AbortSignal },
  ): Promise<ReadableStream<StreamEvent>>;
}
