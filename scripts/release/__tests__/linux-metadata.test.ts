import { describe, it, expect } from 'vitest';
import { appImageFileName, appRunScript, desktopEntry, pointerFileName, releaseMetadata, updateInformation } from '../linux-metadata.mjs';

describe('file names', () => {
  it('versions the AppImage and keeps a fixed pointer name per channel', () => {
    expect(appImageFileName('Gemiredmine-Canary', '1.0.0-rc.2')).toBe('Gemiredmine-Canary-1.0.0-rc.2-x86_64.AppImage');
    expect(pointerFileName('Gemiredmine-Canary')).toBe('Gemiredmine-Canary-x86_64.AppImage');
  });
});

describe('updateInformation', () => {
  it('stable follows the latest non-prerelease release', () => {
    expect(updateInformation({ channel: 'stable', owner: 'iVegas', repo: 'gemiredmine', appName: 'Gemiredmine' })).toBe(
      'gh-releases-zsync|iVegas|gemiredmine|latest|Gemiredmine-*-x86_64.AppImage.zsync'
    );
  });

  it('pre-release channels follow their pointer release', () => {
    expect(updateInformation({ channel: 'unstable', owner: 'iVegas', repo: 'gemiredmine', appName: 'Gemiredmine-Unstable' })).toBe(
      'gh-releases-zsync|iVegas|gemiredmine|unstable-latest|Gemiredmine-Unstable-x86_64.AppImage.zsync'
    );
  });

  it('never points a channel at another channel', () => {
    const canary = updateInformation({ channel: 'canary', owner: 'o', repo: 'r', appName: 'Gemiredmine-Canary' });
    expect(canary).toContain('|canary-latest|');
    expect(canary).not.toContain('unstable');
  });

  it('refuses channels without a pointer', () => {
    expect(() => updateInformation({ channel: 'dev', owner: 'o', repo: 'r', appName: 'x' })).toThrow('no update pointer');
  });
});

describe('desktopEntry', () => {
  it('gives each channel its own identity so installs stay side by side', () => {
    const entry = desktopEntry({
      productName: 'Gemiredmine Canary',
      version: '1.0.0-rc.2',
      channel: 'canary',
      identifier: 'com.gemiredmine.app.canary',
      appName: 'Gemiredmine-Canary',
    });
    expect(entry).toContain('Name=Gemiredmine Canary');
    expect(entry).toContain('Icon=com.gemiredmine.app.canary');
    expect(entry).toContain('X-AppImage-Identifier=com.gemiredmine.app.canary');
    expect(entry).toContain('Exec=AppRun %U');
  });
});

describe('appRunScript', () => {
  const script = appRunScript('usr/bin/Gemiredmine');

  it('starts the bundled executable from the AppImage mount point', () => {
    expect(script.startsWith('#!/bin/sh')).toBe(true);
    expect(script).toContain('HERE="$(dirname "$(readlink -f "$0")")"');
    expect(script).toContain('exec "$HERE/usr/bin/Gemiredmine" "$@"');
    // The app finds everything it needs inside its executable, so it has no reason to change directory.
    expect(script).not.toContain('cd ');
  });

  it('leaves the display server to GTK, so that a Wayland session runs natively', () => {
    // Forcing X11 here would put every Wayland user on XWayland. A user can still set GDK_BACKEND themselves.
    expect(script).not.toContain('GDK_BACKEND');
    expect(script).not.toContain('DISPLAY');
  });
});

describe('releaseMetadata', () => {
  it('carries the tags and assets the publish step needs', () => {
    expect(releaseMetadata({ channel: 'stable', version: '1.0.0', commit: 'abc', tag: 'v1.0.0', pointerTag: null, assets: [] })).toEqual({
      channel: 'stable',
      platform: 'linux',
      version: '1.0.0',
      commit: 'abc',
      commitSha: 'abc',
      tag: 'v1.0.0',
      pointerTag: null,
      assets: [],
    });
  });
});
