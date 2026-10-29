import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextCandidate } from '../candidate.mjs';
import { writeVersion } from '../publish.mjs';

const canary = (tagName: string) => ({ tagName });

describe('canary candidates', () => {
  it('next-rc starts the first candidate of the version in package.json', () => {
    expect(nextCandidate({ packageVersion: '1.0.0', candidate: 'next-rc', releases: [] })).toBe('1.0.0-rc.1');
  });

  it('next-rc takes the number after the newest candidate of that version only', () => {
    const releases = [
      canary('canary-v1.0.0-rc.1'),
      canary('canary-v1.0.0-rc.3'),
      canary('canary-v1.0.1-rc.7'),
      canary('canary-v0.9.0-rc.9'),
      { tagName: 'unstable-v1.0.0-unstable.38' },
      { tagName: 'v0.9.0' },
    ];

    expect(nextCandidate({ packageVersion: '1.0.0', candidate: 'next-rc', releases })).toBe('1.0.0-rc.4');
    // A candidate already in package.json still counts by its core version.
    expect(nextCandidate({ packageVersion: '1.0.0-rc.3', candidate: 'next-rc', releases })).toBe('1.0.0-rc.4');
  });

  it('the bumps raise the core version of package.json and start the new series at rc.1', () => {
    expect(nextCandidate({ packageVersion: '1.2.3', candidate: 'next-patch', releases: [] })).toBe('1.2.4-rc.1');
    expect(nextCandidate({ packageVersion: '1.2.3', candidate: 'next-minor', releases: [] })).toBe('1.3.0-rc.1');
    expect(nextCandidate({ packageVersion: '1.2.3', candidate: 'next-major', releases: [] })).toBe('2.0.0-rc.1');
  });

  it('a bump counts the candidates of the version it raises to', () => {
    const releases = [canary('canary-v1.2.4-rc.1')];

    expect(nextCandidate({ packageVersion: '1.2.3', candidate: 'next-patch', releases })).toBe('1.2.4-rc.2');
    expect(nextCandidate({ packageVersion: '1.2.3', candidate: 'next-minor', releases })).toBe('1.3.0-rc.1');
  });

  it('a bump raises the core version even when package.json already holds a candidate', () => {
    expect(nextCandidate({ packageVersion: '1.0.0-rc.2', candidate: 'next-minor', releases: [] })).toBe('1.1.0-rc.1');
  });

  it('manual uses the version typed in, trimmed, and leaves the check to the policy', () => {
    expect(nextCandidate({ packageVersion: '1.0.0', candidate: 'manual', manualVersion: ' 1.1.0-rc.1 ', releases: [] })).toBe('1.1.0-rc.1');
    // A stable version comes back as typed, so the canary policy can refuse it.
    expect(nextCandidate({ packageVersion: '1.0.0', candidate: 'manual', manualVersion: '1.0.0', releases: [] })).toBe('1.0.0');
  });

  it('refuses manual without a version and a choice it does not know', () => {
    expect(() => nextCandidate({ packageVersion: '1.0.0', candidate: 'manual', manualVersion: ' ', releases: [] })).toThrow(/manual_version/);
    expect(() => nextCandidate({ packageVersion: '1.0.0', candidate: 'next-ultra', releases: [] })).toThrow(/Unknown candidate "next-ultra"/);
  });
});

describe('writing the version', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gemi-version-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets the version in package.json and keeps the rest of the file in order', () => {
    const manifest = { name: 'app', version: '1.0.0', private: true, scripts: { test: 'vitest run' } };
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    writeVersion('1.0.0-rc.1', dir);

    const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(written).toEqual({ ...manifest, version: '1.0.0-rc.1' });
    expect(Object.keys(written)).toEqual(Object.keys(manifest));
  });
});
