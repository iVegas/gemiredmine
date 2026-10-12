import { describe, it, expect } from 'vitest';
import { LogAggregator } from '../aggregator';

describe('LogAggregator', () => {
  it('collapses repeated events into one entry with a count', () => {
    const aggregator = new LogAggregator(10, () => 1000);
    aggregator.record({ level: 'error', scope: 'rpc', message: 'boom' });
    aggregator.record({ level: 'error', scope: 'rpc', message: 'boom' });

    const { entries } = aggregator.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'error', scope: 'rpc', message: 'boom', count: 2 });
  });

  it('groups messages that differ only in numbers', () => {
    const aggregator = new LogAggregator();
    aggregator.record({ level: 'warn', scope: 'rpc', message: 'issue 12 failed' });
    aggregator.record({ level: 'warn', scope: 'rpc', message: 'issue 99 failed' });

    expect(aggregator.drain().entries).toHaveLength(1);
  });

  it('redacts before aggregating, so secrets never reach an entry', () => {
    const aggregator = new LogAggregator();
    aggregator.record({ level: 'error', scope: 'auth', message: 'password=hunter2 rejected' });

    const [entry] = aggregator.drain().entries;
    expect(entry.message).toBe('password=[REDACTED] rejected');
    expect(JSON.stringify(entry)).not.toContain('hunter2');
  });

  it('caps the number of distinct entries and reports how many were dropped', () => {
    const aggregator = new LogAggregator(2);
    aggregator.record({ level: 'info', scope: 'a', message: 'one' });
    aggregator.record({ level: 'info', scope: 'b', message: 'two' });
    aggregator.record({ level: 'info', scope: 'c', message: 'three' });

    const { entries, dropped } = aggregator.drain();
    expect(entries).toHaveLength(2);
    expect(dropped).toBe(1);
  });

  it('starts a new window after drain', () => {
    const aggregator = new LogAggregator();
    aggregator.record({ level: 'info', scope: 'a', message: 'x' });
    aggregator.drain();

    expect(aggregator.pending).toBe(0);
    expect(aggregator.drain().entries).toEqual([]);
  });
});
