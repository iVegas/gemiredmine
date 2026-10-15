import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findAppBinary } from '../build-output.mjs';

describe('findAppBinary', () => {
  let root: string;

  const executable = (targetDir: string, name: string) => {
    const dir = join(targetDir, 'release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), '');
    return join(dir, name);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gemi-build-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the Linux executable in the crate target folder', () => {
    const binary = executable(join(root, 'src-tauri', 'target'), 'Gemiredmine-Unstable');

    expect(findAppBinary(root, 'Gemiredmine-Unstable', 'linux', {})).toBe(binary);
  });

  it('finds the Windows executable, which has an .exe extension', () => {
    const binary = executable(join(root, 'src-tauri', 'target'), 'Gemiredmine-Unstable.exe');

    expect(findAppBinary(root, 'Gemiredmine-Unstable', 'windows', {})).toBe(binary);
    expect(() => findAppBinary(root, 'Gemiredmine-Unstable', 'linux', {})).toThrow('No Gemiredmine-Unstable executable');
  });

  it('follows CARGO_TARGET_DIR, absolute or relative to the repository', () => {
    const absolute = executable(join(root, 'elsewhere'), 'Gemiredmine');
    expect(findAppBinary(root, 'Gemiredmine', 'linux', { CARGO_TARGET_DIR: join(root, 'elsewhere') })).toBe(absolute);

    const relative = executable(join(root, 'out'), 'Gemiredmine-Canary');
    expect(findAppBinary(root, 'Gemiredmine-Canary', 'linux', { CARGO_TARGET_DIR: 'out' })).toBe(relative);
  });

  it('never returns another channel build', () => {
    executable(join(root, 'src-tauri', 'target'), 'Gemiredmine-Canary');

    expect(() => findAppBinary(root, 'Gemiredmine-Unstable', 'linux', {})).toThrow('No Gemiredmine-Unstable executable');
    // The stable app name is a prefix of the others, so a prefix match would pick the wrong build.
    expect(() => findAppBinary(root, 'Gemiredmine', 'linux', {})).toThrow('No Gemiredmine executable');
  });

  it('says which build command to run when nothing was built', () => {
    expect(() => findAppBinary(root, 'Gemiredmine-Dev', 'linux', {})).toThrow('npm run build:desktop');
  });
});
