import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeDataFs } from './support/node-data-fs';
import { DiagnosticsStore } from '../store';

describe('DiagnosticsStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gemi-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends one JSON line per entry', async () => {
    const store = new DiagnosticsStore(nodeDataFs, dir);
    await store.append(['{"a":1}', '{"a":2}']);

    expect(readFileSync(join(dir, 'diagnostics.jsonl'), 'utf8')).toBe('{"a":1}\n{"a":2}\n');
  });

  it('writes nothing, not even the folder, when there are no lines', async () => {
    const logs = join(dir, 'logs');
    await new DiagnosticsStore(nodeDataFs, logs).append([]);

    expect(existsSync(logs)).toBe(false);
  });

  it('rotates when the current file would exceed its size, keeping a bounded number of files', async () => {
    const store = new DiagnosticsStore(nodeDataFs, dir, { maxBytesPerFile: 100, files: 3 });
    const line = 'x'.repeat(59);

    for (let i = 0; i < 5; i++) await store.append([line]);

    expect(existsSync(join(dir, 'diagnostics.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'diagnostics.1.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'diagnostics.2.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'diagnostics.3.jsonl'))).toBe(false);
    expect(await store.totalBytes()).toBeLessThanOrEqual(300);
  });

  it('returns the newest bytes, oldest first, cut at a line boundary', async () => {
    const store = new DiagnosticsStore(nodeDataFs, dir, { maxBytesPerFile: 1000, files: 3 });
    await store.append(['first', 'second', 'third']);

    expect(await store.readRecent(12)).toBe('third\n');
    expect(await store.readRecent(1000)).toBe('first\nsecond\nthird\n');
  });

  it('counts bytes, not characters, when cutting the newest part', async () => {
    const store = new DiagnosticsStore(nodeDataFs, dir, { maxBytesPerFile: 1000, files: 3 });
    await store.append(['€€€€', 'ok']); // 16 bytes, but only 8 characters

    // Counting characters would find that it all fits. Counting bytes cuts into the euro signs.
    expect(await store.readRecent(10)).toBe('ok\n');
    expect(await store.readRecent(16)).toBe('€€€€\nok\n');
  });

  it('clear removes every log file', async () => {
    const store = new DiagnosticsStore(nodeDataFs, dir);
    await store.append(['line']);
    await store.clear();

    expect(await store.totalBytes()).toBe(0);
  });

  it('keeps every line, in order, when appends are not awaited one by one', async () => {
    const store = new DiagnosticsStore(nodeDataFs, dir, { maxBytesPerFile: 100, files: 3 });
    // 28 bytes plus the newline: three lines fit into a file, a fourth starts a new one.
    const lines = Array.from({ length: 50 }, (_, i) => `line-${String(i).padStart(2, '0')}-${'x'.repeat(21)}`);

    await Promise.all(lines.map((line) => store.append([line])));

    const kept = (await store.readRecent(10_000)).split('\n').filter(Boolean);
    expect(kept.length).toBeGreaterThanOrEqual(7);
    expect(kept.length).toBeLessThanOrEqual(9);
    // The newest lines, none missing and none twice, in the order they were appended.
    expect(kept).toEqual(lines.slice(-kept.length));
    expect(existsSync(join(dir, 'diagnostics.3.jsonl'))).toBe(false);
  });
});
