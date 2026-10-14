import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeDataFs } from '../../node-data-fs';
import type { DataFs } from '../fs';
import { DevPreview, type DevPreviewOptions } from '../service';
import { createMemoryDataFs } from './support/memory-data-fs';

const environment = {
  productName: 'Gemiredmine Unstable',
  version: '1.0.0-unstable.7',
  channel: 'unstable',
  commit: 'abc1234',
  buildDate: '2026-10-12T00:00:00.000Z',
  platform: 'linux',
  arch: 'x64',
  runtime: 'bun',
};

describe('DevPreview', () => {
  let dataDir: string;
  let clock: number;

  const create = (overrides: Partial<DevPreviewOptions> = {}) =>
    DevPreview.open({
      dataDir,
      fs: nodeDataFs,
      available: true,
      repositoryUrl: 'https://github.com/iVegas/gemiredmine',
      environment,
      flushIntervalMs: 0,
      now: () => clock,
      ...overrides,
    });

  beforeEach(() => {
    dataDir = join(mkdtempSync(join(tmpdir(), 'gemi-dev-')), 'data');
    clock = Date.parse('2026-10-12T10:00:00.000Z');
  });

  afterEach(() => {
    rmSync(join(dataDir, '..'), { recursive: true, force: true });
  });

  it('is off by default and records nothing until turned on', async () => {
    const preview = await create();
    preview.record({ level: 'error', scope: 'ui', message: 'ignored' });
    await preview.flush();

    expect(await preview.status()).toMatchObject({ available: true, enabled: false, logBytes: 0 });
    expect(existsSync(join(dataDir, 'logs'))).toBe(false);
  });

  it('cannot be enabled in a build that does not offer it', async () => {
    const preview = await create({ available: false });

    await expect(preview.setEnabled(true)).rejects.toThrow('not available in this build');
    expect(existsSync(dataDir)).toBe(false);
  });

  it('ignores an enabled setting left behind by a build that does not offer the preview', async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ devPreviewEnabled: true }));

    expect((await (await create({ available: false })).status()).enabled).toBe(false);
  });

  it('persists the opt-in per channel data directory', async () => {
    await (await create()).setEnabled(true);

    expect((await (await create()).status()).enabled).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))).toEqual({ devPreviewEnabled: true });
  });

  it('starts off when the saved setting cannot be read', async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), '{ not json');

    expect((await (await create()).status()).enabled).toBe(false);
  });

  it('aggregates events while enabled and writes them on flush', async () => {
    const preview = await create();
    await preview.setEnabled(true);
    preview.record({ level: 'error', scope: 'rpc.listTimeEntries', message: 'Redmine API request failed: 503' });
    preview.record({ level: 'error', scope: 'rpc.listTimeEntries', message: 'Redmine API request failed: 503' });
    await preview.flush();

    const [line] = readFileSync(join(dataDir, 'logs', 'diagnostics.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(line)).toMatchObject({ scope: 'rpc.listTimeEntries', count: 2 });
    expect((await preview.status()).pendingEntries).toBe(0);
  });

  it('refuses feedback while disabled', async () => {
    const preview = await create();

    await expect(preview.createFeedback({ title: 't', description: 'd', includeLogs: false })).rejects.toThrow(
      'Turn on the developer preview'
    );
  });

  it('saves a full report and returns a prefilled issue link', async () => {
    const preview = await create();
    await preview.setEnabled(true);
    preview.record({ level: 'warn', scope: 'ui', message: 'token=s3cr3t-value leaked?' });

    const result = await preview.createFeedback({
      title: 'Calendar is empty',
      description: 'After switching months',
      includeLogs: true,
    });

    expect(result.issueUrl).toMatch(/^https:\/\/github\.com\/iVegas\/gemiredmine\/issues\/new\?/);
    expect(result.logsIncluded).toBe('all');
    const report = readFileSync(result.reportPath, 'utf8');
    expect(report).toContain('After switching months');
    expect(report).toContain('token=[REDACTED]');
    expect(report).not.toContain('s3cr3t-value');
  });

  it('leaves logs out of the report when the user declines them', async () => {
    const preview = await create();
    await preview.setEnabled(true);
    const result = await preview.createFeedback({ title: 't', description: 'd', includeLogs: false });

    expect(result.logsIncluded).toBe('none');
    expect(readFileSync(result.reportPath, 'utf8')).not.toContain('## Aggregated diagnostics');
  });

  it('keeps only the most recent feedback reports', async () => {
    const preview = await create();
    await preview.setEnabled(true);
    for (let i = 0; i < 12; i++) {
      clock += 1000;
      await preview.createFeedback({ title: `report ${i}`, description: 'd', includeLogs: false });
    }

    expect(readdirSync(join(dataDir, 'feedback'))).toHaveLength(10);
  });

  it('writes pending entries when turned off', async () => {
    const preview = await create();
    await preview.setEnabled(true);
    preview.record({ level: 'info', scope: 'ui', message: 'opened about' });
    await preview.setEnabled(false);

    expect(await preview.status()).toMatchObject({ enabled: false, pendingEntries: 0 });
    expect(readFileSync(join(dataDir, 'logs', 'diagnostics.jsonl'), 'utf8')).toContain('opened about');
  });

  describe('with the files held in memory', () => {
    const memoryPreview = async (wrap: (fs: DataFs) => DataFs = (fs) => fs, overrides: Partial<DevPreviewOptions> = {}) => {
      const files = createMemoryDataFs();
      const preview = await DevPreview.open({
        dataDir: '/data',
        fs: wrap(files),
        available: true,
        repositoryUrl: 'https://github.com/iVegas/gemiredmine',
        environment,
        now: () => clock,
        ...overrides,
      });
      return { preview, files };
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('writes the log on a timer, and keeps running when a scheduled write fails', async () => {
      vi.useFakeTimers();
      let failures = 0;
      const { preview, files } = await memoryPreview(
        (fs) => ({
          ...fs,
          writeText: async (path, text, options) => {
            if (path.includes('/logs/') && failures++ === 0) throw new Error('disk full');
            return fs.writeText(path, text, options);
          },
        }),
        { flushIntervalMs: 60_000 }
      );
      await preview.setEnabled(true);

      preview.record({ level: 'error', scope: 'ui', message: 'first window' });
      await vi.advanceTimersByTimeAsync(60_000); // this write fails; nothing may escape from the timer
      preview.record({ level: 'error', scope: 'ui', message: 'second window' });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(failures).toBe(2);
      expect(files.files.get('/data/logs/diagnostics.jsonl')).toContain('second window');
      await preview.dispose();
    });

    it('applies requests to turn it on and off one at a time, so the saved setting matches the last one', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let settingsWrites = 0;
      const { preview, files } = await memoryPreview((fs) => ({
        ...fs,
        writeText: async (path, text, options) => {
          // The first write of the setting is slow; the second would finish before it without the queue.
          if (path.endsWith('/settings.json') && settingsWrites++ === 0) await gate;
          return fs.writeText(path, text, options);
        },
      }));

      const turnedOn = preview.setEnabled(true);
      const turnedOff = preview.setEnabled(false);
      await Promise.resolve();
      release();
      await Promise.all([turnedOn, turnedOff]);

      expect(JSON.parse(files.files.get('/data/settings.json')!)).toEqual({ devPreviewEnabled: false });
      expect((await preview.status()).enabled).toBe(false);
    });
  });
});
