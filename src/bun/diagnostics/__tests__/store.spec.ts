import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticsStore } from '../store';

describe('DiagnosticsStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gemi-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends one JSON line per entry', () => {
    const store = new DiagnosticsStore(dir);
    store.append(['{"a":1}', '{"a":2}']);

    expect(readFileSync(join(dir, 'diagnostics.jsonl'), 'utf8')).toBe('{"a":1}\n{"a":2}\n');
  });

  it('rotates when the current file would exceed its size, keeping a bounded number of files', () => {
    const store = new DiagnosticsStore(dir, { maxBytesPerFile: 100, files: 3 });
    const line = 'x'.repeat(59);

    for (let i = 0; i < 5; i++) store.append([line]);

    expect(existsSync(join(dir, 'diagnostics.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'diagnostics.1.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'diagnostics.2.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'diagnostics.3.jsonl'))).toBe(false);
    expect(store.totalBytes).toBeLessThanOrEqual(300);
  });

  it('returns the newest bytes, oldest first, cut at a line boundary', () => {
    const store = new DiagnosticsStore(dir, { maxBytesPerFile: 1000, files: 3 });
    store.append(['first', 'second', 'third']);

    expect(store.readRecent(12)).toBe('third\n');
    expect(store.readRecent(1000)).toBe('first\nsecond\nthird\n');
  });

  it('clear removes every log file', () => {
    const store = new DiagnosticsStore(dir);
    store.append(['line']);
    store.clear();

    expect(store.totalBytes).toBe(0);
  });
});
