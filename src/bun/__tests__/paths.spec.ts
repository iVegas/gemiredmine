import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { dataDirFor } from '../paths';

describe('dataDirFor', () => {
  it('uses the per-channel folder under XDG_DATA_HOME on Linux', () => {
    expect(dataDirFor('gemiredmine-unstable', { XDG_DATA_HOME: '/data' }, 'linux')).toBe(join('/data', 'gemiredmine-unstable'));
  });

  it('uses the per-channel folder under LocalAppData on Windows', () => {
    expect(dataDirFor('gemiredmine-canary', { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, 'win32')).toBe(
      join('C:\\Users\\ana\\AppData\\Local', 'gemiredmine-canary')
    );
  });

  it('lets GEMIREDMINE_DATA_DIR override the location on any platform', () => {
    expect(dataDirFor('gemiredmine', { GEMIREDMINE_DATA_DIR: '/portable' }, 'win32')).toBe('/portable');
  });

  it('gives every channel a different folder', () => {
    const names = ['gemiredmine', 'gemiredmine-canary', 'gemiredmine-unstable', 'gemiredmine-dev'];
    const dirs = names.map(name => dataDirFor(name, { XDG_DATA_HOME: '/d' }, 'linux'));
    expect(new Set(dirs).size).toBe(names.length);
  });
});
