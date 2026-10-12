// Release channel policy as pure functions. The publish workflows call these after
// reading GitHub releases; the logic is kept free of I/O so it can be unit tested.
//
//   stable    v<x.y.z>                  keeps the 2 newest releases
//   canary    canary-v<x.y.z>-rc.<n>    only versions newer than the latest stable
//   unstable  unstable-v<core>-unstable.<n>   keeps the 3 newest builds of main
//
// Pointer releases `canary-latest` and `unstable-latest` hold the newest build of their
// channel under a fixed file name, so AppImageUpdate can follow them. They are never pruned.
import { compareSemver, isStableVersion, parseSemver } from './channels.mjs';

export const KEEP = Object.freeze({ stable: 2, unstable: 3 });

export const POINTER_TAGS = Object.freeze({ canary: 'canary-latest', unstable: 'unstable-latest' });

const TAG_PATTERNS = [
  { channel: 'stable', pattern: /^v(.+)$/ },
  { channel: 'canary', pattern: /^canary-v(.+)$/ },
  { channel: 'unstable', pattern: /^unstable-v(.+)$/ },
];

export function tagFor(channel, version) {
  switch (channel) {
    case 'stable':
      return `v${version}`;
    case 'canary':
      return `canary-v${version}`;
    case 'unstable':
      return `unstable-v${version}`;
    default:
      throw new Error(`No release tags for channel "${channel}".`);
  }
}

/** Maps a git tag to its channel and version, or null when the tag is not part of the scheme. */
export function parseReleaseTag(tag) {
  for (const { channel, pattern } of TAG_PATTERNS) {
    const match = pattern.exec(tag);
    if (!match) continue;
    try {
      const version = match[1];
      const prerelease = parseSemver(version).prerelease.length > 0;
      if (channel === 'stable' && prerelease) return null;
      if (channel !== 'stable' && !prerelease) return null;
      if (channel === 'unstable' && !/^unstable\.\d+$/.test(parseSemver(version).prerelease.join('.'))) return null;
      return { channel, version };
    } catch {
      return null;
    }
  }
  return null;
}

/** The newest stable version among the releases, or null when none exists yet. */
export function latestStableVersion(releases) {
  let latest = null;
  for (const release of releases) {
    const parsed = parseReleaseTag(release.tagName);
    if (parsed?.channel !== 'stable') continue;
    if (latest === null || compareSemver(parsed.version, latest) > 0) latest = parsed.version;
  }
  return latest;
}

/** Throws unless `version` may be released as a stable build. */
export function assertStableRelease({ version, releases }) {
  if (!isStableVersion(version)) {
    throw new Error(`Stable releases need a plain version such as 1.0.0, got "${version}".`);
  }
  const tag = tagFor('stable', version);
  if (releases.some(release => release.tagName === tag)) {
    throw new Error(`${tag} is already released. Bump the version in package.json first.`);
  }
  const latest = latestStableVersion(releases);
  if (latest !== null && compareSemver(version, latest) <= 0) {
    throw new Error(`Stable ${version} must be newer than the latest stable release ${latest}.`);
  }
}

/**
 * Throws unless `version` may be released as a canary. A canary is only allowed when it is
 * newer than the latest stable release; before the first stable release any candidate works.
 */
export function assertCanaryRelease({ version, releases }) {
  if (isStableVersion(version)) {
    throw new Error(`Canary builds need a release candidate such as 1.0.0-rc.1, got "${version}".`);
  }
  const tag = tagFor('canary', version);
  if (releases.some(release => release.tagName === tag)) {
    throw new Error(`${tag} already exists. Bump the release candidate number in package.json.`);
  }
  const latest = latestStableVersion(releases);
  if (latest !== null && compareSemver(version, latest) <= 0) {
    throw new Error(`Canary ${version} is not newer than the latest stable release ${latest}, so it would not be offered.`);
  }
}

/** Releases (by tag) that the channel policy no longer allows. Pointer releases are never listed. */
export function selectPrunable(releases) {
  const versioned = { stable: [], canary: [], unstable: [] };
  for (const release of releases) {
    const parsed = parseReleaseTag(release.tagName);
    if (parsed) versioned[parsed.channel].push({ ...parsed, tagName: release.tagName });
  }
  const newestFirst = list => [...list].sort((a, b) => compareSemver(b.version, a.version));

  const prunable = [];

  const stable = newestFirst(versioned.stable);
  prunable.push(...stable.slice(KEEP.stable));

  const unstable = newestFirst(versioned.unstable);
  prunable.push(...unstable.slice(KEEP.unstable));

  // Canary holds only versions newer than the latest stable release.
  const latest = stable.length > 0 ? stable[0].version : null;
  if (latest !== null) {
    prunable.push(...versioned.canary.filter(entry => compareSemver(entry.version, latest) <= 0));
  }

  return prunable.map(entry => ({ channel: entry.channel, tagName: entry.tagName, version: entry.version }));
}

/** Whether a prunable release should also lose its git tag (unstable tags are throwaway). */
export function shouldCleanupTag(channel) {
  return channel === 'unstable';
}
