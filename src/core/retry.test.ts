import { describe, expect, it, vi } from 'vitest';

import { ChatAbortError, NetworkError, RateLimitError } from './errors';
import { backoffDelay, withRetry } from './retry';

describe('backoffDelay', () => {
  it('grows exponentially from the base delay', () => {
    const noJitter = { baseMs: 100, maxMs: 60_000, jitter: 0 };

    expect(backoffDelay(0, noJitter)).toBe(100);
    expect(backoffDelay(1, noJitter)).toBe(200);
    expect(backoffDelay(2, noJitter)).toBe(400);
    expect(backoffDelay(3, noJitter)).toBe(800);
  });

  it('never exceeds the ceiling', () => {
    expect(backoffDelay(20, { baseMs: 100, maxMs: 5_000, jitter: 0 })).toBe(
      5_000,
    );
  });

  it('keeps jittered delays inside the documented band', () => {
    // Jitter matters when many clients fail at once: without it they all retry
    // on the same millisecond and re-create the outage they are recovering from.
    for (let i = 0; i < 200; i += 1) {
      const delay = backoffDelay(2, {
        baseMs: 100,
        maxMs: 60_000,
        jitter: 0.5,
      });
      expect(delay).toBeGreaterThanOrEqual(200);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });

  it('produces different values across calls when jitter is on', () => {
    const delays = new Set(
      Array.from({ length: 50 }, () =>
        backoffDelay(3, { baseMs: 100, maxMs: 60_000, jitter: 0.5 }),
      ),
    );

    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('withRetry', () => {
  it('returns the first successful result without waiting', async () => {
    const attempt = vi.fn().mockResolvedValue('ok');

    await expect(
      withRetry(attempt, { maxAttempts: 3, sleep: vi.fn() }),
    ).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and succeeds', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError('socket hang up'))
      .mockResolvedValue('ok');

    await expect(
      withRetry(attempt, { maxAttempts: 3, sleep: vi.fn() }),
    ).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and rethrows the last failure', async () => {
    const error = new NetworkError('still down', { status: 503 });
    const attempt = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(attempt, { maxAttempts: 3, sleep: vi.fn() }),
    ).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable failure', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValue(new NetworkError('bad request', { status: 400 }));

    await expect(
      withRetry(attempt, { maxAttempts: 5, sleep: vi.fn() }),
    ).rejects.toThrow('bad request');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('never retries an abort', async () => {
    const attempt = vi.fn().mockRejectedValue(new ChatAbortError());

    await expect(
      withRetry(attempt, { maxAttempts: 5, sleep: vi.fn() }),
    ).rejects.toBeInstanceOf(ChatAbortError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After instead of its own backoff', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(
        new RateLimitError('slow down', { retryAfterMs: 7_500 }),
      )
      .mockResolvedValue('ok');

    await withRetry(attempt, { maxAttempts: 3, sleep });

    expect(sleep).toHaveBeenCalledWith(7_500);
  });

  it('falls back to backoff when a rate limit carries no Retry-After', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError('slow down'))
      .mockResolvedValue('ok');

    await withRetry(attempt, {
      maxAttempts: 3,
      sleep,
      backoff: { baseMs: 100, maxMs: 60_000, jitter: 0 },
    });

    expect(sleep).toHaveBeenCalledWith(100);
  });

  it('passes the attempt number so a caller can report progress', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError('flaky'))
      .mockResolvedValue('ok');

    await withRetry(attempt, { maxAttempts: 3, sleep: vi.fn() });

    expect(attempt).toHaveBeenNthCalledWith(1, 0);
    expect(attempt).toHaveBeenNthCalledWith(2, 1);
  });

  it('stops immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const attempt = vi.fn();

    await expect(
      withRetry(attempt, {
        maxAttempts: 3,
        sleep: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(ChatAbortError);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('does not sleep or retry once the signal aborts mid-flight', async () => {
    const controller = new AbortController();
    const sleep = vi.fn();
    const attempt = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new NetworkError('flaky'));
    });

    await expect(
      withRetry(attempt, {
        maxAttempts: 3,
        sleep,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(ChatAbortError);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
