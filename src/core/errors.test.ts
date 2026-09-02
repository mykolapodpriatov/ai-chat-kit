import { describe, expect, it } from 'vitest';

import {
  ChatAbortError,
  ChatError,
  NetworkError,
  ParseError,
  RateLimitError,
  isRetryable,
} from './errors';

describe('error hierarchy', () => {
  it('keeps instanceof working across the class hierarchy', () => {
    const error = new NetworkError('upstream refused', { status: 503 });

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toBeInstanceOf(Error);
  });

  it('exposes a stable discriminant so consumers can switch without instanceof', () => {
    expect(new NetworkError('x').kind).toBe('network');
    expect(new RateLimitError('x').kind).toBe('rate-limit');
    expect(new ChatAbortError().kind).toBe('abort');
    expect(new ParseError('x', { chunk: '' }).kind).toBe('parse');
  });

  it('preserves the underlying cause', () => {
    const cause = new TypeError('fetch failed');
    const error = new NetworkError('could not reach the provider', { cause });

    expect(error.cause).toBe(cause);
  });

  it('carries the HTTP status when there was one', () => {
    expect(new NetworkError('boom', { status: 502 }).status).toBe(502);
  });

  it('omits status rather than setting it to undefined', () => {
    expect('status' in new NetworkError('boom')).toBe(false);
  });

  it('records how long a rate limit asked us to wait', () => {
    const error = new RateLimitError('slow down', { retryAfterMs: 4200 });

    expect(error.retryAfterMs).toBe(4200);
    expect(error.status).toBe(429);
  });

  it('keeps the offending chunk on a parse error, truncated', () => {
    const chunk = 'x'.repeat(500);
    const error = new ParseError('unparseable event', { chunk });

    expect(error.chunk.length).toBeLessThanOrEqual(200);
    expect(error.chunk.startsWith('x')).toBe(true);
  });

  it('names each error after its class so logs are readable', () => {
    expect(new RateLimitError('x').name).toBe('RateLimitError');
    expect(new ChatAbortError().name).toBe('ChatAbortError');
  });
});

describe('isRetryable', () => {
  it('never retries an abort — the user asked us to stop', () => {
    expect(isRetryable(new ChatAbortError())).toBe(false);
  });

  it('retries a rate limit', () => {
    expect(isRetryable(new RateLimitError('slow down'))).toBe(true);
  });

  it('retries a transport failure with no status', () => {
    expect(isRetryable(new NetworkError('socket hang up'))).toBe(true);
  });

  it('retries 5xx but not 4xx — a bad request will be bad again', () => {
    expect(isRetryable(new NetworkError('x', { status: 503 }))).toBe(true);
    expect(isRetryable(new NetworkError('x', { status: 400 }))).toBe(false);
    expect(isRetryable(new NetworkError('x', { status: 401 }))).toBe(false);
  });

  it('does not retry a parse error — replaying the request yields the same bytes', () => {
    expect(isRetryable(new ParseError('x', { chunk: '' }))).toBe(false);
  });

  it('does not retry an error it does not recognise', () => {
    expect(isRetryable(new Error('who knows'))).toBe(false);
  });
});
