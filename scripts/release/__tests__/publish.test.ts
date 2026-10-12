import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, prune, publish } from '../publish.mjs';

describe('publish CLI logic', () => {
  let dir: string;
  let releasesFile: string;
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gemi-publish-'));
    logs.length = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const withReleases = (releases: Array<{ tagName: string }>) => {
    releasesFile = join(dir, 'releases.json');
    writeFileSync(releasesFile, JSON.stringify(releases.map(r => ({ ...r, isPrerelease: false, publishedAt: '2026-01-01' }))));
    return releasesFile;
  };

  it('validates stable only from main and only for a new release version', () => {
    const releasesJson = withReleases([{ tagName: 'v0.9.0' }]);
    // package.json holds 1.0.0, which is newer than 0.9.0 and not yet released.
    expect(validate({ channel: 'stable', branch: 'main', releasesJson, env: {}, log }).version).toBe('1.0.0');
    expect(() => validate({ channel: 'stable', branch: 'feature/x', releasesJson, env: {}, log })).toThrow('made from main');
  });

  it('refuses a stable version that is already released', () => {
    const releasesJson = withReleases([{ tagName: 'v1.0.0' }]);
    expect(() => validate({ channel: 'stable', branch: 'main', releasesJson, env: {}, log })).toThrow('already released');
  });

  it('validates canary as a release candidate and writes the version to the workflow output', () => {
    const outputFile = join(dir, 'github-output');
    writeFileSync(outputFile, '');
    // package.json holds 1.0.0 (stable), which canary must refuse.
    const releasesJson = withReleases([]);
    expect(() => validate({ channel: 'canary', branch: 'main', releasesJson, env: {}, log })).toThrow(
      'release candidate'
    );
  });

  it('lists what pruning would remove during a dry run, without touching GitHub', () => {
    const releasesJson = withReleases([
      { tagName: 'v1.0.0' },
      { tagName: 'v1.1.0' },
      { tagName: 'v1.2.0' },
      { tagName: 'unstable-v1.2.0-unstable.1' },
      { tagName: 'unstable-v1.2.0-unstable.2' },
      { tagName: 'unstable-v1.2.0-unstable.3' },
      { tagName: 'unstable-v1.2.0-unstable.4' },
      { tagName: 'unstable-latest' },
    ]);

    const planned = prune({ releasesJson, dryRun: true, log });

    expect(planned.map(p => p.tagName).sort()).toEqual(['unstable-v1.2.0-unstable.1', 'v1.0.0'].sort());
    expect(logs.some(line => line.includes('[dry-run] gh release delete unstable-v1.2.0-unstable.1 --yes --cleanup-tag'))).toBe(true);
    expect(logs.some(line => line.includes('[dry-run] gh release delete v1.0.0 --yes') && !line.includes('cleanup-tag'))).toBe(true);
  });

  it('plans a publish with the full commit SHA as the release target and the pointer upload', () => {
    const artifacts = join(dir, 'linux');
    mkdirSync(artifacts);
    writeFileSync(join(artifacts, 'Gemiredmine-Unstable-1.0.0-unstable.7-x86_64.AppImage'), 'x');
    writeFileSync(join(artifacts, 'Gemiredmine-Unstable-x86_64.AppImage'), 'x');
    writeFileSync(join(artifacts, 'SHA256SUMS'), 'x');
    writeFileSync(
      join(artifacts, 'release.json'),
      JSON.stringify({
        channel: 'unstable',
        version: '1.0.0-unstable.7',
        commit: 'abc1234',
        commitSha: 'abc1234567890abcdef1234567890abcdef12345',
        tag: 'unstable-v1.0.0-unstable.7',
        pointerTag: 'unstable-latest',
        assets: [
          { name: 'Gemiredmine-Unstable-1.0.0-unstable.7-x86_64.AppImage', pointer: false },
          { name: 'Gemiredmine-Unstable-x86_64.AppImage', pointer: true },
          { name: 'SHA256SUMS', pointer: false },
        ],
      })
    );

    publish({ dir: artifacts, dryRun: true, log });

    expect(logs.find(line => line.includes('release create unstable-v1.0.0-unstable.7'))).toContain(
      '--target abc1234567890abcdef1234567890abcdef12345'
    );
    expect(logs.find(line => line.includes('release upload unstable-latest'))).toContain('--clobber');
    expect(logs.find(line => line.includes('release upload unstable-latest'))).toContain('SHA256SUMS');
    expect(readFileSync(join(artifacts, 'release.json'), 'utf8')).toContain('unstable-latest');
  });
});
