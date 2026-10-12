#!/usr/bin/env node
// Publishes and prunes GitHub releases according to the channel policy. Used by the
// release workflows; authenticates through the GH_TOKEN environment variable of `gh`.
//
//   node scripts/release/publish.mjs validate --channel <stable|canary|unstable> [--branch <name>] [--releases-json <file>]
//   node scripts/release/publish.mjs publish  --dir dist/linux/<channel> [--dry-run]
//   node scripts/release/publish.mjs prune    [--releases-json <file>] [--dry-run]
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEEP,
  assertCanaryRelease,
  assertStableRelease,
  latestStableVersion,
  selectPrunable,
  shouldCleanupTag,
  tagFor,
} from './policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHANNEL_LABEL = { stable: 'Stable', canary: 'Canary', unstable: 'Unstable' };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) options[arg.slice(2)] = rest[++i];
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return options;
}

function gh(args, { dryRun = false, log = console.log, input } = {}) {
  if (dryRun) {
    log(`[dry-run] gh ${args.join(' ')}`);
    return '';
  }
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

export function listReleases({ releasesJson, dryRun = false, log }) {
  if (releasesJson) return JSON.parse(readFileSync(releasesJson, 'utf8'));
  const output = gh(['release', 'list', '--limit', '500', '--json', 'tagName,isPrerelease,publishedAt'], { dryRun, log });
  return output ? JSON.parse(output) : [];
}

function packageVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

export function validate({ channel, branch, releasesJson, env = process.env, log = console.log }) {
  const releases = listReleases({ releasesJson, log });
  const version = packageVersion();

  if (channel === 'stable') {
    if (branch !== 'main') throw new Error(`Stable releases are made from main, not from "${branch}".`);
    assertStableRelease({ version, releases });
  } else if (channel === 'canary') {
    assertCanaryRelease({ version, releases });
  } else if (channel !== 'unstable') {
    throw new Error(`Unknown channel "${channel}".`);
  }

  const latest = latestStableVersion(releases);
  log(`version ${version} may be released on ${channel} (latest stable: ${latest ?? 'none yet'})`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `version=${version}\n`);
  return { version, latestStable: latest };
}

function releaseNotes(metadata) {
  const label = CHANNEL_LABEL[metadata.channel];
  const lines = [
    `${label} build ${metadata.version} from commit ${metadata.commit}.`,
    '',
    'Install the AppImage for this channel. Updates come from AppImageUpdate, not from the app.',
    '',
    'Each channel is installed separately and keeps its own settings.',
  ];
  return lines.join('\n');
}

function releaseExists(tag, { dryRun, log }) {
  if (dryRun) return false;
  try {
    gh(['release', 'view', tag, '--json', 'tagName'], { log });
    return true;
  } catch {
    return false;
  }
}

export function publish({ dir, dryRun = false, log = console.log }) {
  const metadata = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
  const { channel, tag, pointerTag, commitSha } = metadata;
  const files = metadata.assets.filter(asset => !asset.pointer).map(asset => join(dir, asset.name));
  // Checksums describe every file, so the pointer release carries them too.
  const pointerFiles = metadata.assets
    .filter(asset => asset.pointer || asset.name === 'SHA256SUMS')
    .map(asset => join(dir, asset.name));

  for (const file of [...files, ...pointerFiles]) {
    if (!existsSync(file)) throw new Error(`Missing artifact ${file}`);
  }

  const title = `${CHANNEL_LABEL[channel]} ${metadata.version}`;
  const createArgs = ['release', 'create', tag, ...files, '--title', title, '--target', commitSha];
  if (channel === 'stable') {
    // GitHub writes the notes from the commits since the previous release.
    createArgs.push('--latest', '--generate-notes');
  } else {
    createArgs.push('--prerelease', '--notes', releaseNotes(metadata));
  }
  gh(createArgs, { dryRun, log });

  if (pointerTag) {
    if (!releaseExists(pointerTag, { dryRun, log })) {
      gh(
        [
          'release', 'create', pointerTag, '--prerelease',
          '--title', `${CHANNEL_LABEL[channel]} (latest build)`,
          '--notes', 'Always points at the newest build of this channel. Used by AppImageUpdate.',
          '--target', commitSha,
        ],
        { dryRun, log }
      );
    }
    gh(['release', 'upload', pointerTag, ...pointerFiles, '--clobber'], { dryRun, log });
  }

  return { tag, pointerTag };
}

export function prune({ releasesJson, dryRun = false, log = console.log }) {
  const releases = listReleases({ releasesJson, log });
  const planned = selectPrunable(releases);
  for (const entry of planned) {
    const args = ['release', 'delete', entry.tagName, '--yes'];
    if (shouldCleanupTag(entry.channel)) args.push('--cleanup-tag');
    gh(args, { dryRun, log });
  }
  log(`${dryRun ? 'would remove' : 'removed'} ${planned.length} release(s); keep policy: stable ${KEEP.stable}, unstable ${KEEP.unstable}, canary newer than latest stable`);
  return planned;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  switch (options.command) {
    case 'validate':
      validate({ channel: options.channel, branch: options.branch ?? process.env.GITHUB_REF_NAME, releasesJson: options['releases-json'] });
      break;
    case 'publish':
      publish({ dir: options.dir, dryRun: options.dryRun });
      prune({ dryRun: options.dryRun });
      break;
    case 'prune':
      prune({ releasesJson: options['releases-json'], dryRun: options.dryRun });
      break;
    default:
      throw new Error('Usage: publish.mjs <validate|publish|prune> [options]');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

