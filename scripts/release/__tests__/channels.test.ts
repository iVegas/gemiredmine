import { describe, it, expect } from 'vitest';
import { androidVersionCode, compareSemver, deriveBuildInfo, isStableVersion, parseSemver } from '../channels.mjs';

describe('parseSemver', () => {
  it('parses core and pre-release parts', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver('1.2.3-rc.4')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ['rc', '4'] });
  });

  it('rejects anything that is not semver', () => {
    expect(() => parseSemver('1.2')).toThrow('Not a semantic version');
    expect(() => parseSemver('v1.2.3')).toThrow('Not a semantic version');
    expect(() => parseSemver('01.2.3')).toThrow('Not a semantic version');
  });
});

describe('compareSemver', () => {
  it('orders core versions numerically, not lexically', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '10.0.0')).toBeLessThan(0);
  });

  it('sorts a release after its own release candidates', () => {
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
  });

  it('treats build metadata as irrelevant', () => {
    expect(compareSemver('1.0.0+build.5', '1.0.0')).toBe(0);
  });
});

describe('isStableVersion', () => {
  it('is true only for versions without a pre-release tag', () => {
    expect(isStableVersion('1.0.0')).toBe(true);
    expect(isStableVersion('1.0.0-rc.1')).toBe(false);
  });
});

describe('deriveBuildInfo', () => {
  const buildDate = '2026-10-12T00:00:00.000Z';

  it('uses the package version unchanged for stable builds', () => {
    const info = deriveBuildInfo({ packageVersion: '1.0.0', channel: 'stable', buildDate });
    expect(info).toMatchObject({
      version: '1.0.0',
      appName: 'Gemiredmine',
      identifier: 'com.gemiredmine.app',
      dataDirName: 'gemiredmine',
      devPreviewAvailable: false,
    });
  });

  it('refuses a stable build from a pre-release version', () => {
    expect(() => deriveBuildInfo({ packageVersion: '1.0.0-rc.1', channel: 'stable', buildDate })).toThrow(
      'Stable builds need a release version'
    );
  });

  it('requires canary builds to be release candidates', () => {
    expect(deriveBuildInfo({ packageVersion: '1.0.0-rc.1', channel: 'canary', buildDate }).version).toBe('1.0.0-rc.1');
    expect(() => deriveBuildInfo({ packageVersion: '1.0.0', channel: 'canary', buildDate })).toThrow(
      'Canary builds need a release candidate'
    );
  });

  it('numbers each unstable build from the core version', () => {
    const info = deriveBuildInfo({ packageVersion: '1.0.0-rc.1', channel: 'unstable', buildNumber: 42, buildDate });
    expect(info.version).toBe('1.0.0-unstable.42');
  });

  it('gives every channel its own identifier and data directory', () => {
    const channels = ['stable', 'canary', 'unstable', 'dev'].map(channel =>
      deriveBuildInfo({ packageVersion: channel === 'canary' ? '1.0.0-rc.1' : '1.0.0', channel, buildDate })
    );
    expect(new Set(channels.map(c => c.identifier)).size).toBe(4);
    expect(new Set(channels.map(c => c.appName)).size).toBe(4);
    expect(new Set(channels.map(c => c.dataDirName)).size).toBe(4);
  });

  it('enables the developer preview everywhere except stable', () => {
    const enabled = Object.fromEntries(
      ['stable', 'canary', 'unstable', 'dev'].map(channel => [
        channel,
        deriveBuildInfo({ packageVersion: channel === 'canary' ? '1.0.0-rc.1' : '1.0.0', channel, buildDate }).devPreviewAvailable,
      ])
    );
    expect(enabled).toEqual({ stable: false, canary: true, unstable: true, dev: true });
  });

  it('rejects unknown channels', () => {
    expect(() => deriveBuildInfo({ packageVersion: '1.0.0', channel: 'nightly', buildDate })).toThrow('Unknown channel');
  });

  it('names the Android platform, and rejects platforms that are not built', () => {
    const info = deriveBuildInfo({ packageVersion: '1.0.0', channel: 'unstable', buildNumber: 12, platform: 'android', buildDate });
    expect(info.platform).toBe('android');
    expect(() => deriveBuildInfo({ packageVersion: '1.0.0', channel: 'stable', platform: 'macos', buildDate })).toThrow('Unknown platform');
  });
});

describe('androidVersionCode', () => {
  const code = (packageVersion: string, channel: string, buildNumber = 0) =>
    androidVersionCode(deriveBuildInfo({ packageVersion, channel: channel as 'stable', buildNumber, platform: 'android', buildDate: 'x' }));

  it('grows with every build of one channel', () => {
    const unstable = [1, 2, 3].map(n => code('1.0.0', 'unstable', n));
    expect(unstable[1]).toBeGreaterThan(unstable[0]);
    expect(unstable[2]).toBeGreaterThan(unstable[1]);
    expect(code('1.0.0-rc.2', 'canary')).toBeGreaterThan(code('1.0.0-rc.1', 'canary'));
  });

  it('sorts unstable below a release candidate, and a release candidate below the release', () => {
    expect(code('1.0.0', 'unstable', 4999)).toBeLessThan(code('1.0.0-rc.1', 'canary'));
    expect(code('1.0.0-rc.4998', 'canary')).toBeLessThan(code('1.0.0', 'stable'));
  });

  it('refuses a build number that would overflow its stage', () => {
    expect(() => code('1.0.0', 'unstable', 5000)).toThrow('below 5000');
  });
});
