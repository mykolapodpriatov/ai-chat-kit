// Retry policy.
//
// Two rules do most of the work here, and both exist because the naive version
// costs the user money:
//
//   - only retry what could plausibly succeed on a replay (see `isRetryable`);
//   - when the provider tells you how long to wait, wait that long. A 429 with
//     `Retry-After: 30` answered by a 100 ms backoff is how an account gets
//     rate-limited harder.
//
// Jitter is not decoration. Without it, every client that failed during an
// outage retries on the same millisecond and re-creates the outage.

import { ChatAbortError, RateLimitError, isRetryable } from './errors';

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Fraction of the delay that is randomised, 0–1. 0.5 means "between 50% and 100%". */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  maxMs: 30_000,
  jitter: 0.5,
};

/**
 * Delay before attempt number `attempt` (0-based), exponential and jittered.
 *
 * The jitter is subtractive — the delay lands in
 * `[exponential * (1 - jitter), exponential]` — so backoff never overshoots the
 * ceiling and the worst case stays predictable.
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
): number {
  const exponential = Math.min(
    options.maxMs,
    options.baseMs * 2 ** Math.max(0, attempt),
  );
  if (options.jitter <= 0) return exponential;

  const spread = exponential * Math.min(1, options.jitter);
  return Math.round(exponential - Math.random() * spread);
}

export interface WithRetryOptions {
  maxAttempts: number;
  backoff?: BackoffOptions;
  /** Injectable so tests do not spend real seconds asleep. */
  sleep?: (ms: number) => Promise<void> | void;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `attempt` until it succeeds, becomes unretryable, or runs out of tries.
 *
 * `attempt` receives the 0-based attempt number so a caller can surface
 * "retrying (2/3)" without threading extra state.
 */
export async function withRetry<T>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? defaultSleep;

  for (let attemptNumber = 0; ; attemptNumber += 1) {
    if (options.signal?.aborted) {
      throw new ChatAbortError();
    }

    try {
      return await attempt(attemptNumber);
    } catch (error) {
      // Check the signal before deciding anything else: a user who pressed Stop
      // during the request should not sit through a backoff and a retry.
      if (options.signal?.aborted) {
        throw new ChatAbortError();
      }

      const isLastAttempt = attemptNumber >= options.maxAttempts - 1;
      if (isLastAttempt || !isRetryable(error)) {
        throw error;
      }

      const retryAfter =
        error instanceof RateLimitError ? error.retryAfterMs : undefined;
      await sleep(retryAfter ?? backoffDelay(attemptNumber, backoff));
    }
  }
}
