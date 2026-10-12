import { describe, it, expect } from 'vitest';
import {
  assertCanaryRelease,
  assertStableRelease,
  latestStableVersion,
  parseReleaseTag,
  selectPrunable,
  tagFor,
} from '../policy.mjs';

const release = (tagName: string) => ({ tagName });

describe('tagFor and parseReleaseTag', () => {
  it('round-trips each channel tag', () => {
    expect(parseReleaseTag(tagFor('stable', '1.2.0'))).toEqual({ channel: 'stable', version: '1.2.0' });
    expect(parseReleaseTag(tagFor('canary', '1.2.0-rc.3'))).toEqual({ channel: 'canary', version: '1.2.0-rc.3' });
    expect(parseReleaseTag(tagFor('unstable', '1.2.0-unstable.9'))).toEqual({
      channel: 'unstable',
      version: '1.2.0-unstable.9',
    });
  });

  it('ignores pointer and unrelated tags', () => {
    expect(parseReleaseTag('canary-latest')).toBeNull();
    expect(parseReleaseTag('unstable-latest')).toBeNull();
    expect(parseReleaseTag('v1.0.0-rc.1')).toBeNull();
    expect(parseReleaseTag('canary-v1.0.0')).toBeNull();
    expect(parseReleaseTag('unstable-v1.0.0-rc.1')).toBeNull();
    expect(parseReleaseTag('random')).toBeNull();
  });
});

describe('latestStableVersion', () => {
  it('finds the highest stable version, comparing numbers properly', () => {
    expect(latestStableVersion([release('v1.9.0'), release('v1.10.0'), release('canary-v2.0.0-rc.1')])).toBe('1.10.0');
  });

  it('is null before the first stable release', () => {
    expect(latestStableVersion([release('canary-v1.0.0-rc.1')])).toBeNull();
  });
});

describe('assertStableRelease', () => {
  it('allows the first stable release', () => {
    expect(() => assertStableRelease({ version: '1.0.0', releases: [] })).not.toThrow();
  });

  it('refuses pre-release versions', () => {
    expect(() => assertStableRelease({ version: '1.0.0-rc.1', releases: [] })).toThrow('plain version');
  });

  it('refuses a version that is already released', () => {
    expect(() => assertStableRelease({ version: '1.0.0', releases: [release('v1.0.0')] })).toThrow('already released');
  });

  it('refuses a version that is not newer than the latest stable', () => {
    expect(() => assertStableRelease({ version: '1.0.0', releases: [release('v1.1.0')] })).toThrow('must be newer');
  });
});

describe('assertCanaryRelease', () => {
  it('allows any candidate before the first stable release', () => {
    expect(() => assertCanaryRelease({ version: '1.0.0-rc.1', releases: [] })).not.toThrow();
  });

  it('only offers candidates newer than the latest stable release', () => {
    const releases = [release('v1.0.0')];
    expect(() => assertCanaryRelease({ version: '1.0.0-rc.1', releases })).toThrow('not newer than the latest stable');
    expect(() => assertCanaryRelease({ version: '1.1.0-rc.1', releases })).not.toThrow();
  });

  it('refuses a stable version and a duplicate candidate', () => {
    expect(() => assertCanaryRelease({ version: '1.1.0', releases: [] })).toThrow('release candidate');
    expect(() => assertCanaryRelease({ version: '1.1.0-rc.1', releases: [release('canary-v1.1.0-rc.1')] })).toThrow(
      'already exists'
    );
  });
});

describe('selectPrunable', () => {
  it('keeps only the two newest stable releases', () => {
    const pruned = selectPrunable([release('v1.0.0'), release('v1.1.0'), release('v1.2.0'), release('v1.3.0')]);
    expect(pruned.filter(p => p.channel === 'stable').map(p => p.tagName)).toEqual(['v1.1.0', 'v1.0.0']);
  });

  it('keeps only the three newest unstable builds and never prunes pointers', () => {
    const builds = [1, 2, 3, 4, 5].map(n => release(`unstable-v1.0.0-unstable.${n}`));
    const pruned = selectPrunable([...builds, release('unstable-latest')]);

    expect(pruned.map(p => p.tagName).sort()).toEqual(['unstable-v1.0.0-unstable.1', 'unstable-v1.0.0-unstable.2']);
  });

  it('removes canary builds that are no longer newer than the latest stable release', () => {
    const pruned = selectPrunable([
      release('v1.0.0'),
      release('canary-v1.0.0-rc.1'),
      release('canary-v1.1.0-rc.1'),
      release('canary-latest'),
    ]);
    expect(pruned).toEqual([{ channel: 'canary', tagName: 'canary-v1.0.0-rc.1', version: '1.0.0-rc.1' }]);
  });

  it('keeps every canary build while no stable release exists', () => {
    const pruned = selectPrunable([release('canary-v1.0.0-rc.1'), release('canary-v1.0.0-rc.2')]);
    expect(pruned).toEqual([]);
  });
});
