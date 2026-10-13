// Single source of truth for release channels and version derivation.
//
// The only hand-edited version is `version` in package.json. Everything the
// app and the packaging pipeline need (display version, identifiers, data
// directories, feature gates) is derived here, from that value plus the
// channel and CI metadata. Pure functions only, so the Electrobun config,
// the build-info generator and the release scripts all share one definition.

export const REPOSITORY = Object.freeze({ owner: 'iVegas', name: 'gemiredmine' });

export const REPOSITORY_URL = `https://github.com/${REPOSITORY.owner}/${REPOSITORY.name}`;

const BASE_IDENTIFIER = 'com.gemiredmine.app';

export const CHANNELS = Object.freeze({
  stable: {
    label: 'Stable',
    appName: 'Gemiredmine',
    productName: 'Gemiredmine',
    identifierSuffix: '',
    dataDirName: 'gemiredmine',
    devPreviewAvailable: false,
  },
  canary: {
    label: 'Canary',
    appName: 'Gemiredmine-Canary',
    productName: 'Gemiredmine Canary',
    identifierSuffix: '.canary',
    dataDirName: 'gemiredmine-canary',
    devPreviewAvailable: true,
  },
  unstable: {
    label: 'Unstable',
    appName: 'Gemiredmine-Unstable',
    productName: 'Gemiredmine Unstable',
    identifierSuffix: '.unstable',
    dataDirName: 'gemiredmine-unstable',
    devPreviewAvailable: true,
  },
  dev: {
    label: 'Dev',
    appName: 'Gemiredmine-Dev',
    productName: 'Gemiredmine Dev',
    identifierSuffix: '.dev',
    dataDirName: 'gemiredmine-dev',
    devPreviewAvailable: true,
  },
});

/** Parses `MAJOR.MINOR.PATCH[-prerelease]`. Build metadata (`+...`) is ignored. */
export function parseSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`Not a semantic version: "${version}"`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isStableVersion(version) {
  return parseSemver(version).prerelease.length === 0;
}

function comparePrereleaseIdentifier(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1; // numeric identifiers sort before alphanumeric ones
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence: negative when a < b, positive when a > b, zero when equal. */
export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  // A release sorts after its own pre-releases: 1.0.0 > 1.0.0-rc.1.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const x = left.prerelease[i];
    const y = right.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const result = comparePrereleaseIdentifier(x, y);
    if (result !== 0) return result;
  }
  return 0;
}

export function coreVersion(version) {
  const { major, minor, patch } = parseSemver(version);
  return `${major}.${minor}.${patch}`;
}

/**
 * Derives everything a build needs for one channel.
 *
 * - stable:   the package version must be a release (no pre-release tag).
 * - canary:   the package version must be a release candidate (`x.y.z-rc.N`).
 * - unstable: every main-branch build gets `<core>-unstable.<buildNumber>`.
 * - dev:      local builds use the package version unchanged.
 */
export const PLATFORMS = Object.freeze(['linux', 'windows']);

/** The platform a build targets. Builds run on their target platform, so this is the host platform. */
export function hostPlatform(processPlatform = process.platform) {
  return processPlatform === 'win32' ? 'windows' : 'linux';
}

export function deriveBuildInfo({ packageVersion, channel, platform = 'linux', buildNumber = 0, commit = 'unknown', buildDate }) {
  const config = CHANNELS[channel];
  if (!config) throw new Error(`Unknown channel "${channel}". Expected one of: ${Object.keys(CHANNELS).join(', ')}`);
  if (!PLATFORMS.includes(platform)) throw new Error(`Unknown platform "${platform}". Expected one of: ${PLATFORMS.join(', ')}`);

  let version;
  switch (channel) {
    case 'stable':
      if (!isStableVersion(packageVersion)) {
        throw new Error(`Stable builds need a release version, got "${packageVersion}".`);
      }
      version = packageVersion;
      break;
    case 'canary':
      if (isStableVersion(packageVersion)) {
        throw new Error(`Canary builds need a release candidate version such as 1.0.0-rc.1, got "${packageVersion}".`);
      }
      version = packageVersion;
      break;
    case 'unstable':
      version = `${coreVersion(packageVersion)}-unstable.${buildNumber}`;
      break;
    default:
      version = packageVersion;
  }

  return {
    version,
    channel,
    label: config.label,
    appName: config.appName,
    productName: config.productName,
    identifier: `${BASE_IDENTIFIER}${config.identifierSuffix}`,
    dataDirName: config.dataDirName,
    devPreviewAvailable: config.devPreviewAvailable,
    platform,
    repositoryUrl: REPOSITORY_URL,
    commit,
    buildDate,
  };
}
