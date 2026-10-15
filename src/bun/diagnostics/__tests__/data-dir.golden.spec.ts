import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { nodeDataFs } from './support/node-data-fs';
import { DevPreview } from '../service';

// Golden snapshot of the per-channel data folder. Users keep this folder across updates,
// including an update that swaps the desktop shell, so its layout, file contents and
// permissions must come out byte for byte the same.

const environment = {
  productName: 'Gemiredmine Unstable',
  version: '1.0.0-unstable.7',
  channel: 'unstable',
  commit: 'abc1234',
  buildDate: '2026-10-12T00:00:00.000Z',
  platform: 'linux',
  arch: 'x64',
  runtime: 'bun 1.0.0',
};

interface Entry {
  path: string;
  kind: 'dir' | 'file';
  mode: number;
  content?: string;
}

/** Every file and folder under `root`, sorted, with POSIX paths. */
function walk(root: string, directory = root): Entry[] {
  const entries: Entry[] = [];
  for (const name of readdirSync(directory).sort()) {
    const full = join(directory, name);
    const path = relative(root, full).split(sep).join('/');
    const stats = statSync(full);
    if (stats.isDirectory()) {
      entries.push({ path, kind: 'dir', mode: stats.mode & 0o777 });
      entries.push(...walk(root, full));
    } else {
      entries.push({ path, kind: 'file', mode: stats.mode & 0o777, content: readFileSync(full, 'utf8') });
    }
  }
  return entries;
}

describe('developer preview data folder', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = join(mkdtempSync(join(tmpdir(), 'gemi-golden-')), 'data');
    const clock = Date.parse('2026-10-12T10:00:00.000Z');
    const preview = await DevPreview.open({
      dataDir,
      fs: nodeDataFs,
      available: true,
      repositoryUrl: 'https://github.com/iVegas/gemiredmine',
      environment,
      flushIntervalMs: 0,
      now: () => clock,
    });

    await preview.setEnabled(true);
    preview.record({ level: 'error', scope: 'rpc.listTimeEntries', message: 'Redmine API request failed: 503 Service Unavailable' });
    preview.record({ level: 'error', scope: 'rpc.listTimeEntries', message: 'Redmine API request failed: 503 Service Unavailable' });
    preview.record({ level: 'warn', scope: 'ui', message: 'token=s3cr3t-value leaked?' });
    await preview.flush();
    await preview.createFeedback({ title: 'Calendar is empty', description: 'After switching months', includeLogs: true });
  });

  afterEach(() => {
    rmSync(join(dataDir, '..'), { recursive: true, force: true });
  });

  it('keeps its layout and file contents', () => {
    expect(
      walk(dataDir).map(({ path, kind, content }) => (content === undefined ? { path, kind } : { path, kind, content }))
    ).toMatchSnapshot();
  });

  it('writes settings.json as exactly this text', () => {
    expect(readFileSync(join(dataDir, 'settings.json'), 'utf8')).toBe('{\n  "devPreviewEnabled": true\n}');
  });

  // Windows has no POSIX permission bits; the data folder there is protected by the package identity.
  it.skipIf(process.platform === 'win32')('keeps folders private (0700) and files owner-only (0600)', () => {
    expect(Object.fromEntries(walk(dataDir).map(({ path, mode }) => [path, mode.toString(8)]))).toEqual({
      feedback: '700',
      'feedback/feedback-2026-10-12T10-00-00-000Z.md': '600',
      logs: '700',
      'logs/diagnostics.jsonl': '600',
      'settings.json': '600',
    });
  });
});
