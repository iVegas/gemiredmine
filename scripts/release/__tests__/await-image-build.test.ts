import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPEAR_GRACE_MS, TIMEOUT_MS, decide } from '../await-image-build.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const unstable = readFileSync(join(ROOT, '.github', 'workflows', 'unstable.yml'), 'utf8');

const done = (conclusion: string) => ({ status: 'completed', conclusion, url: 'https://github.com/o/r/actions/runs/1' });
const running = { status: 'in_progress', conclusion: '', url: 'https://github.com/o/r/actions/runs/1' };

describe('waiting for the image build of a commit', () => {
  it('waits while the image build runs', () => {
    expect(decide([running], 60_000).action).toBe('wait');
  });

  it('proceeds once the image build succeeded', () => {
    expect(decide([done('success')], 10 * 60_000)).toMatchObject({ action: 'proceed' });
  });

  it('stops the release when the image build failed', () => {
    const decision = decide([done('failure')], 10 * 60_000);

    expect(decision.action).toBe('fail');
    expect(decision.message).toContain('cannot pull its images');
  });

  it('gives a queued image run a moment to show up, then accepts that the commit has none', () => {
    expect(decide([], 5_000).action).toBe('wait');
    expect(decide([], APPEAR_GRACE_MS).action).toBe('proceed');
  });

  it('stops when the image build takes longer than the release can wait', () => {
    expect(decide([running], TIMEOUT_MS).action).toBe('fail');
  });
});

describe('the unstable release', () => {
  it('waits for the image build before each of its builds', () => {
    expect(unstable).toMatch(/await-images:\n(?:.*\n)*?\s+run: node scripts\/release\/await-image-build\.mjs "\$GITHUB_SHA"/);
    for (const job of ['build-linux', 'build-windows', 'build-android']) {
      expect(unstable, job).toMatch(new RegExp(`${job}:\\n\\s+needs: await-images\\n`));
    }
  });

  it('keeps one release at a time', () => {
    expect(unstable).toContain('group: release-unstable');
    expect(unstable).toContain('cancel-in-progress: false');
  });
});
