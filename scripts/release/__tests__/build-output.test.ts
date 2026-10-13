import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findAppBuild } from '../build-output.mjs';

describe('findAppBuild', () => {
  let root: string;

  const app = (envDir: string, name: string, launcher: string) => {
    const dir = join(root, envDir, name, 'bin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, launcher), '');
    return join(root, envDir, name);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gemi-build-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the Linux and Windows builds of the requested app', () => {
    expect(app('canary-linux-x64', 'Gemiredmine-Unstable-canary', 'launcher')).toBeTruthy();
    expect(findAppBuild(root, 'Gemiredmine-Unstable')).toBe(join(root, 'canary-linux-x64', 'Gemiredmine-Unstable-canary'));

    const windows = app('dev-win-x64', 'Gemiredmine-Unstable-dev', 'launcher.exe');
    expect(findAppBuild(join(root), 'Gemiredmine-Unstable')).toBeTruthy();
    expect(windows).toContain('dev-win-x64');
  });

  it('never returns another channel build', () => {
    app('canary-win-x64', 'Gemiredmine-Canary-canary', 'launcher.exe');
    expect(() => findAppBuild(root, 'Gemiredmine-Unstable')).toThrow('No Gemiredmine-Unstable build');
  });

  it('requires a launcher, not just a folder', () => {
    mkdirSync(join(root, 'stable-win-x64', 'Gemiredmine'), { recursive: true });
    expect(() => findAppBuild(root, 'Gemiredmine')).toThrow('No Gemiredmine build');
  });
});
