// The versions a canary can be started with. The Canary workflow offers the choices in CANDIDATE_CHOICES; `manual`
// takes the version typed into its form. Pure functions, so the rules are unit tested.
import { parseSemver } from './channels.mjs';
import { parseReleaseTag } from './policy.mjs';

export const CANDIDATE_CHOICES = Object.freeze(['next-rc', 'next-patch', 'next-minor', 'next-major', 'manual']);

/**
 * The number after the newest canary release of `base` (1.0.0 gives 1 when none exists). Other versions do not count.
 */
export function nextRcNumber(base, releases) {
  let highest = 0;
  for (const release of releases) {
    const parsed = parseReleaseTag(release.tagName);
    if (parsed?.channel !== 'canary') continue;
    const match = /^(\d+\.\d+\.\d+)-rc\.(\d+)$/.exec(parsed.version);
    if (match?.[1] === base) highest = Math.max(highest, Number(match[2]));
  }
  return highest + 1;
}

/**
 * The version a canary is started with. `next-rc` keeps the core version (x.y.z) of package.json and takes the number after
 * its newest candidate. `next-patch`, `next-minor` and `next-major` raise the core version first, so the new series starts
 * at rc.1. `manual` returns the version typed in, which the policy then checks.
 */
export function nextCandidate({ packageVersion, candidate, manualVersion = '', releases }) {
  if (candidate === 'manual') {
    const version = manualVersion.trim();
    if (version === '') throw new Error('Choose manual and type the version in manual_version, for example 1.1.0-rc.1.');
    return version;
  }
  if (!CANDIDATE_CHOICES.includes(candidate)) {
    throw new Error(`Unknown candidate "${candidate}". Expected one of: ${CANDIDATE_CHOICES.join(', ')}.`);
  }
  const { major, minor, patch } = parseSemver(packageVersion);
  const core = {
    'next-rc': [major, minor, patch],
    'next-patch': [major, minor, patch + 1],
    'next-minor': [major, minor + 1, 0],
    'next-major': [major + 1, 0, 0],
  }[candidate];
  const base = core.join('.');
  return `${base}-rc.${nextRcNumber(base, releases)}`;
}
