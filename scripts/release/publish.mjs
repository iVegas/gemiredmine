#!/usr/bin/env node
// Publishes and prunes GitHub releases according to the channel policy. Used by the
// release workflows; authenticates through the GH_TOKEN environment variable of `gh`.
//
//   node scripts/release/publish.mjs validate --channel <stable|canary|unstable> [--branch <name>] [--releases-json <file>]
//   node scripts/release/publish.mjs publish  --dir dist/linux/<channel> [--dir dist/windows/<channel>] [--dir dist/android/<channel>] [--dry-run]
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
  const options = { command, dir: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--dir') options.dir.push(rest[++i]);
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

const PLATFORM_NOTES = {
  linux: 'Linux: the Flatpak bundle. Install it with `flatpak install --user <file>`. The app does not update itself.',
  windows: 'Windows 11: the .msix package. Open the .appinstaller file to install; Windows keeps it up to date.',
  android: 'Android: the .apk. Install it directly; Android does not update the app itself.',
};

function selfSignedNote(certificateName) {
  return [
    'Windows: this build is signed with a self-signed certificate, so Windows will not install it until the certificate is trusted.',
    `Before opening the .appinstaller, import ${certificateName} as an administrator:`,
    `  Import-Certificate -FilePath ${certificateName} -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople`,
  ].join('\n');
}

function releaseNotes(metadata, platforms, { windowsSigning, certificateName }) {
  const label = CHANNEL_LABEL[metadata.channel];
  const lines = [
    `${label} build ${metadata.version} from commit ${metadata.commit}.`,
    '',
    ...platforms.map(platform => PLATFORM_NOTES[platform]),
    '',
    ...(windowsSigning === 'self-signed' ? [selfSignedNote(certificateName), ''] : []),
    'Each channel is installed separately and keeps its own settings.',
  ];
  return lines.join('\n');
}

/**
 * Reads the artifact folders of one release (one per platform) and checks they belong together.
 * Each folder's release.json names its files; an asset name may only come from one folder.
 */
export function loadArtifacts(dirs) {
  if (dirs.length === 0) throw new Error('Pass at least one --dir with release artifacts.');
  const packages = dirs.map(dir => ({ dir, metadata: JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8')) }));

  const first = packages[0].metadata;
  for (const { metadata } of packages.slice(1)) {
    for (const key of ['channel', 'version', 'tag', 'pointerTag', 'commitSha']) {
      if (metadata[key] !== first[key]) {
        throw new Error(`Artifacts disagree on ${key}: "${first[key]}" and "${metadata[key]}". Build all platforms from the same commit.`);
      }
    }
  }

  const assets = [];
  const names = new Set();
  for (const { dir, metadata } of packages) {
    for (const asset of metadata.assets) {
      const path = join(dir, asset.name);
      if (!existsSync(path)) throw new Error(`Missing artifact ${path}`);
      if (names.has(asset.name)) throw new Error(`${asset.name} is produced by more than one package.`);
      names.add(asset.name);
      assets.push({ name: asset.name, path, pointer: asset.pointer === true, copyToPointer: asset.copyToPointer === true });
    }
  }

  // Stable must never ship a package that only a self-signed certificate signed.
  const windows = packages.find(({ metadata }) => metadata.platform === 'windows');
  const windowsSigning = windows?.metadata.signing ?? null;
  if (first.channel === 'stable' && windows && windowsSigning !== 'trusted') {
    throw new Error(`Stable Windows packages must be signed with trusted signing, but this one is "${windowsSigning}".`);
  }
  const certificate = assets.find(asset => asset.name.endsWith('-self-signed.cer'));

  return {
    metadata: first,
    platforms: packages.map(({ metadata }) => metadata.platform ?? 'linux'),
    assets,
    windowsSigning,
    certificateName: certificate?.name ?? null,
  };
}

/** Checksum files are attached to the pointer release too, so it can be verified on its own. */
const isChecksumFile = name => name.startsWith('SHA256SUMS');

/**
 * The files of the build's own release, and those of the pointer release. A `pointer` asset is only on the pointer
 * release (the fixed-name copies the update feeds follow). Every other asset is on the build's own release, and is
 * also on the pointer release when it is a checksum file or the package asks for it with `copyToPointer`.
 */
export function releaseFiles(assets) {
  return {
    files: assets.filter(asset => !asset.pointer).map(asset => asset.path),
    pointerFiles: assets.filter(asset => asset.pointer || asset.copyToPointer || isChecksumFile(asset.name)).map(asset => asset.path),
  };
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

export function publish({ dirs, dryRun = false, log = console.log }) {
  const { metadata, platforms, assets, windowsSigning, certificateName } = loadArtifacts(dirs);
  const { channel, tag, pointerTag, commitSha } = metadata;
  const { files, pointerFiles } = releaseFiles(assets);

  const title = `${CHANNEL_LABEL[channel]} ${metadata.version}`;
  const createArgs = ['release', 'create', tag, ...files, '--title', title, '--target', commitSha];
  if (channel === 'stable') {
    // GitHub writes the notes from the commits since the previous release.
    createArgs.push('--latest', '--generate-notes');
  } else {
    createArgs.push('--prerelease', '--notes', releaseNotes(metadata, platforms, { windowsSigning, certificateName }));
  }
  gh(createArgs, { dryRun, log });

  if (pointerTag) {
    if (!releaseExists(pointerTag, { dryRun, log })) {
      gh(
        [
          'release', 'create', pointerTag, '--prerelease',
          '--title', `${CHANNEL_LABEL[channel]} (latest build)`,
          '--notes', 'Always points at the newest build of this channel, under a fixed file name. Used by the Windows App Installer.',
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
      publish({ dirs: options.dir, dryRun: options.dryRun });
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

