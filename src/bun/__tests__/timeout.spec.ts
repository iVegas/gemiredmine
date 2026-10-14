import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from '../timeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the result through and leaves no timer behind', async () => {
    vi.useFakeTimers();

    await expect(withTimeout(30_000, async () => 'done')).resolves.toBe('done');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up after the time limit and aborts the request', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const outcome = expect(
      withTimeout(30_000, (s) => {
        signal = s;
        return new Promise<never>(() => {});
      })
    ).rejects.toThrow('The Redmine server did not answer within 30 seconds.');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await outcome;
    expect(signal.aborted).toBe(true);
  });

  it('reports the timeout even when the aborted request fails with its own error', async () => {
    vi.useFakeTimers();
    const outcome = expect(
      withTimeout(1_000, (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Request cancelled')));
        })
      )
    ).rejects.toThrow('The Redmine server did not answer within 1 seconds.');

    await vi.advanceTimersByTimeAsync(1_000);

    await outcome;
  });

  it('keeps the error of a request that fails before the limit', async () => {
    vi.useFakeTimers();

    await expect(
      withTimeout(30_000, async () => {
        throw new Error('Redmine API request failed: 503 Service Unavailable');
      })
    ).rejects.toThrow('503');

    expect(vi.getTimerCount()).toBe(0);
  });
});
