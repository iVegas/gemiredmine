import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevPreview, type DevPreviewOptions } from '../service';

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
    new DevPreview({
      dataDir,
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

  it('is off by default and records nothing until turned on', () => {
    const preview = create();
    preview.record({ level: 'error', scope: 'ui', message: 'ignored' });
    preview.flush();

    expect(preview.status()).toMatchObject({ available: true, enabled: false, logBytes: 0 });
    expect(existsSync(join(dataDir, 'logs'))).toBe(false);
  });

  it('cannot be enabled in a build that does not offer it', () => {
    const preview = create({ available: false });

    expect(() => preview.setEnabled(true)).toThrow('not available in this build');
    expect(existsSync(dataDir)).toBe(false);
  });

  it('ignores an enabled setting left behind by a build that does not offer the preview', () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ devPreviewEnabled: true }));

    expect(create({ available: false }).status().enabled).toBe(false);
  });

  it('persists the opt-in per channel data directory', () => {
    create().setEnabled(true);

    expect(create().status().enabled).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))).toEqual({ devPreviewEnabled: true });
  });

  it('aggregates events while enabled and writes them on flush', () => {
    const preview = create();
    preview.setEnabled(true);
    preview.record({ level: 'error', scope: 'rpc.listTimeEntries', message: 'Redmine API request failed: 503' });
    preview.record({ level: 'error', scope: 'rpc.listTimeEntries', message: 'Redmine API request failed: 503' });
    preview.flush();

    const [line] = readFileSync(join(dataDir, 'logs', 'diagnostics.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(line)).toMatchObject({ scope: 'rpc.listTimeEntries', count: 2 });
    expect(preview.status().pendingEntries).toBe(0);
  });

  it('refuses feedback while disabled', () => {
    expect(() => create().createFeedback({ title: 't', description: 'd', includeLogs: false })).toThrow(
      'Turn on the developer preview'
    );
  });

  it('saves a full report and returns a prefilled issue link', () => {
    const preview = create();
    preview.setEnabled(true);
    preview.record({ level: 'warn', scope: 'ui', message: 'token=s3cr3t-value leaked?' });

    const result = preview.createFeedback({ title: 'Calendar is empty', description: 'After switching months', includeLogs: true });

    expect(result.issueUrl).toMatch(/^https:\/\/github\.com\/iVegas\/gemiredmine\/issues\/new\?/);
    expect(result.logsIncluded).toBe('all');
    const report = readFileSync(result.reportPath, 'utf8');
    expect(report).toContain('After switching months');
    expect(report).toContain('token=[REDACTED]');
    expect(report).not.toContain('s3cr3t-value');
  });

  it('leaves logs out of the report when the user declines them', () => {
    const preview = create();
    preview.setEnabled(true);
    const result = preview.createFeedback({ title: 't', description: 'd', includeLogs: false });

    expect(result.logsIncluded).toBe('none');
    expect(readFileSync(result.reportPath, 'utf8')).not.toContain('## Aggregated diagnostics');
  });

  it('keeps only the most recent feedback reports', () => {
    const preview = create();
    preview.setEnabled(true);
    for (let i = 0; i < 12; i++) {
      clock += 1000;
      preview.createFeedback({ title: `report ${i}`, description: 'd', includeLogs: false });
    }

    expect(readdirSync(join(dataDir, 'feedback'))).toHaveLength(10);
  });

  it('writes pending entries when turned off', () => {
    const preview = create();
    preview.setEnabled(true);
    preview.record({ level: 'info', scope: 'ui', message: 'opened about' });
    preview.setEnabled(false);

    expect(preview.status()).toMatchObject({ enabled: false, pendingEntries: 0 });
    expect(readFileSync(join(dataDir, 'logs', 'diagnostics.jsonl'), 'utf8')).toContain('opened about');
  });
});
