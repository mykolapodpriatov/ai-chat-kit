// Typed errors for everything that can go wrong between a prompt and a token.
//
// Callers need to answer three questions, and a bare `Error` answers none of
// them: should this be retried, should it be shown to the user, and did the
// user cause it by pressing Stop? Each subclass answers all three, and `kind`
// gives consumers a discriminant they can `switch` on without `instanceof` —
// which matters across bundler boundaries, where a duplicated copy of the
// package would break prototype checks.

export type ChatErrorKind = 'network' | 'rate-limit' | 'abort' | 'parse';

export abstract class ChatError extends Error {
  abstract readonly kind: ChatErrorKind;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    // Subclassing Error loses the prototype chain when the package is compiled
    // to ES5 or bundled by a downlevelling toolchain. Restoring it explicitly
    // keeps `instanceof` honest for consumers we do not control.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The request never completed: DNS, TCP, TLS, a timeout, or a 5xx. */
export class NetworkError extends ChatError {
  readonly kind = 'network' as const;
  // `declare` on purpose: with useDefineForClassFields (the ES2022 default) a
  // plain optional field is emitted as `status = undefined`, so `'status' in
  // error` would be true even when there was no HTTP response. Declaring it
  // emits nothing, and the constructor assigns only when there is a value.
  /** Present only when the server actually answered. */
  declare readonly status?: number;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options);
    if (options?.status !== undefined) {
      this.status = options.status;
    }
  }
}

/** The provider asked us to slow down. Always a 429. */
export class RateLimitError extends ChatError {
  readonly kind = 'rate-limit' as const;
  readonly status = 429;
  /**
   * How long the provider asked us to wait, from `Retry-After`. Absent when the
   * header was missing or unparseable — the caller falls back to its backoff.
   */
  declare readonly retryAfterMs?: number;

  constructor(
    message: string,
    options?: { retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, options);
    if (options?.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

/** The caller aborted — a Stop button, a navigation, an unmount. Never an error to show. */
export class ChatAbortError extends ChatError {
  readonly kind = 'abort' as const;

  constructor(message = 'The request was aborted.') {
    super(message);
  }
}

/** The stream arrived but did not say what we expected. */
export class ParseError extends ChatError {
  readonly kind = 'parse' as const;
  /** The offending payload, truncated — it can contain user content. */
  readonly chunk: string;

  constructor(message: string, options: { chunk: string; cause?: unknown }) {
    super(message, options);
    this.chunk = options.chunk.slice(0, 200);
  }
}

/**
 * Whether retrying the identical request could plausibly succeed.
 *
 * Deliberately conservative. A 4xx means the request was wrong and will be
 * wrong again; a parse failure means the bytes were wrong and replaying yields
 * the same bytes; an abort means a human said stop. Retrying any of those burns
 * the user's money and their patience.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ChatAbortError) return false;
  if (error instanceof RateLimitError) return true;
  if (error instanceof ParseError) return false;
  if (error instanceof NetworkError) {
    return error.status === undefined || error.status >= 500;
  }
  return false;
}
