import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageLinux, sha256 } from '../package-linux.mjs';

// A stand-in for appimagetool that records the AppDir it was given (the packager deletes it afterwards)
// and the arguments, then writes the files the real tool would. The real one runs on the Linux CI runner.
const FAKE_APPIMAGETOOL = `#!/bin/sh
# appimagetool --appimage-extract-and-run --no-appstream -u <update info> <AppDir> <output>
echo "$@" > "$TOOL_LOG"
(cd "$5" && find . -printf '%m %p %l\\n' | sort -k2) > "$TOOL_TREE"
cp "$5/AppRun" "$TOOL_APPRUN"
cp "$5"/*.desktop "$TOOL_DESKTOP"
echo APPIMAGE > "$6"
echo ZSYNC > "$6.zsync"
`;

type Asset = { name: string; pointer: boolean };

describe('packageLinux', () => {
  let root: string;
  let tools: string;
  let appimagetool: string;

  const env = (overrides: Record<string, string> = {}) => ({
    CHANNEL: 'unstable',
    GITHUB_RUN_NUMBER: '7',
    GITHUB_SHA: 'abc1234567890abcdef1234567890abcdef12345',
    BUILD_DATE: '2026-10-13T00:00:00.000Z',
    TOOL_LOG: join(tools, 'args'),
    TOOL_TREE: join(tools, 'tree'),
    TOOL_APPRUN: join(tools, 'AppRun'),
    TOOL_DESKTOP: join(tools, 'desktop'),
    ...overrides,
  });

  /** Runs the real fake tool, and stands in for zsyncmake, which the pointer copy needs. */
  const run = ((command: string, args: string[], options?: object) => {
    if (command !== 'zsyncmake') return execFileSync(command, args, options);
    writeFileSync(args[args.indexOf('-o') + 1], `ZSYNC for ${args[args.indexOf('-u') + 1]}`);
    return undefined;
  }) as typeof execFileSync;

  const pack = (overrides: Record<string, string> = {}) => packageLinux({ env: env(overrides), root, run, appimagetool });
  const read = (name: string) => readFileSync(join(tools, name), 'utf8');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gemi-linux-'));
    tools = join(root, 'tools');
    mkdirSync(tools);
    appimagetool = join(tools, 'appimagetool');
    writeFileSync(appimagetool, FAKE_APPIMAGETOOL);
    chmodSync(appimagetool, 0o755);

    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    // `tauri build` leaves one executable per channel, named after the app.
    mkdirSync(join(root, 'src-tauri', 'target', 'release'), { recursive: true });
    for (const name of ['Gemiredmine-Unstable', 'Gemiredmine']) {
      writeFileSync(join(root, 'src-tauri', 'target', 'release', name), `ELF ${name}`, { mode: 0o755 });
    }
    mkdirSync(join(root, 'assets', 'icons'), { recursive: true });
    for (const channel of ['unstable', 'stable']) writeFileSync(join(root, 'assets', 'icons', `${channel}.png`), `png ${channel}`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('puts the executable, AppRun, the desktop entry and the icon in the AppDir, and nothing else', () => {
    pack();

    expect(read('tree')).toBe(
      [
        '755 . ',
        '777 ./.DirIcon com.gemiredmine.app.unstable.png',
        '755 ./AppRun ',
        '644 ./com.gemiredmine.app.unstable.desktop ',
        '644 ./com.gemiredmine.app.unstable.png ',
        '755 ./usr ',
        '755 ./usr/bin ',
        '755 ./usr/bin/Gemiredmine-Unstable ',
        '',
      ].join('\n')
    );
  });

  it('starts the executable on X11 from AppRun, and names it in the desktop entry', () => {
    pack();

    expect(read('AppRun')).toContain('exec "$HERE/usr/bin/Gemiredmine-Unstable" "$@"');
    expect(read('AppRun')).toContain('export GDK_BACKEND="${GDK_BACKEND:-x11}"');
    // The window class Tauri gives the window is the executable name, which the desktop entry has to match.
    expect(read('desktop')).toContain('StartupWMClass=Gemiredmine-Unstable');
    expect(read('desktop')).toContain('Exec=AppRun %U');
  });

  it('embeds the update information of the channel and names the AppImage after the version', () => {
    const { outDir } = pack();

    const args = read('args').trim().split(' ');
    expect(args.slice(0, 3)).toEqual(['--appimage-extract-and-run', '--no-appstream', '-u']);
    expect(args[3]).toBe('gh-releases-zsync|iVegas|gemiredmine|unstable-latest|Gemiredmine-Unstable-x86_64.AppImage.zsync');
    expect(args[5]).toBe(join(outDir, 'Gemiredmine-Unstable-1.0.0-unstable.7-x86_64.AppImage'));
  });

  it('publishes the versioned AppImage and its pointer copy, with checksums', () => {
    const { outDir, metadata } = pack();

    expect(metadata).toMatchObject({ channel: 'unstable', platform: 'linux', tag: 'unstable-v1.0.0-unstable.7', pointerTag: 'unstable-latest' });
    expect(metadata.assets).toEqual([
      { name: 'Gemiredmine-Unstable-1.0.0-unstable.7-x86_64.AppImage', pointer: false },
      { name: 'Gemiredmine-Unstable-1.0.0-unstable.7-x86_64.AppImage.zsync', pointer: false },
      { name: 'Gemiredmine-Unstable-x86_64.AppImage', pointer: true },
      { name: 'Gemiredmine-Unstable-x86_64.AppImage.zsync', pointer: true },
      { name: 'SHA256SUMS-linux.txt', pointer: false },
    ] satisfies Asset[]);

    const sums = readFileSync(join(outDir, 'SHA256SUMS-linux.txt'), 'utf8').trim().split('\n');
    expect(sums).toHaveLength(4);
    expect(sums[0]).toBe(`${sha256(join(outDir, 'Gemiredmine-Unstable-1.0.0-unstable.7-x86_64.AppImage'))}  Gemiredmine-Unstable-1.0.0-unstable.7-x86_64.AppImage`);
    expect(JSON.parse(readFileSync(join(outDir, 'release.json'), 'utf8')).assets).toHaveLength(5);
    expect(existsSync(join(outDir, 'AppDir'))).toBe(false);
  });

  it('packages the stable executable for stable, which follows the latest release and has no pointer', () => {
    const { outDir, metadata } = pack({ CHANNEL: 'stable' });

    expect(read('args')).toContain('gh-releases-zsync|iVegas|gemiredmine|latest|Gemiredmine-*-x86_64.AppImage.zsync');
    expect(read('AppRun')).toContain('"$HERE/usr/bin/Gemiredmine"');
    expect(read('AppRun')).not.toContain('Unstable');
    expect(metadata.pointerTag).toBeNull();
    expect(metadata.assets.map((asset: Asset) => asset.name)).toEqual([
      'Gemiredmine-1.0.0-x86_64.AppImage',
      'Gemiredmine-1.0.0-x86_64.AppImage.zsync',
      'SHA256SUMS-linux.txt',
    ]);
    expect(existsSync(join(outDir, 'Gemiredmine-1.0.0-x86_64.AppImage'))).toBe(true);
  });

  it('refuses to package when the channel has not been built', () => {
    rmSync(join(root, 'src-tauri', 'target', 'release', 'Gemiredmine-Unstable'));

    expect(() => pack()).toThrow('No Gemiredmine-Unstable executable');
  });
});
