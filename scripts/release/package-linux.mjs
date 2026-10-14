#!/usr/bin/env node
// Packages the Tauri Linux executable of one channel as an AppImage.
//
// Inputs:  CHANNEL, GITHUB_RUN_NUMBER (unstable build number), COMMIT (optional)
// Outputs: dist/linux/<channel>/ containing the AppImage, its zsync file(s), SHA256SUMS
//          and release.json, which the publish step reads.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, deriveBuildInfo } from './channels.mjs';
import { POINTER_TAGS, tagFor } from './policy.mjs';
import { findAppBinary } from './build-output.mjs';
import {
  appImageFileName,
  appRunScript,
  desktopEntry,
  pointerFileName,
  releaseMetadata,
  updateInformation,
} from './linux-metadata.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Pinned so every build uses the same packaging tool, verified before use. */
export const APPIMAGETOOL = Object.freeze({
  version: '1.9.1',
  url: 'https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage',
  sha256: 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0',
});

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ensureAppImageTool(cacheDir, run) {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, `appimagetool-${APPIMAGETOOL.version}-x86_64.AppImage`);
  if (!existsSync(path) || sha256(path) !== APPIMAGETOOL.sha256) {
    rmSync(path, { force: true });
    run('curl', ['-fsSL', '-o', path, APPIMAGETOOL.url]);
    if (sha256(path) !== APPIMAGETOOL.sha256) {
      rmSync(path, { force: true });
      throw new Error('appimagetool checksum mismatch; refusing to package with an unverified tool.');
    }
  }
  chmodSync(path, 0o755);
  return path;
}

function gitCommit(root, ref = 'HEAD', short = false) {
  try {
    const args = ['rev-parse', ...(short ? ['--short'] : []), ref];
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * `appimagetool` is the path of a ready-to-run tool. By default the pinned one is downloaded and verified.
 *
 * @param {{ env?: NodeJS.ProcessEnv, root?: string, run?: typeof execFileSync, appimagetool?: string }} [options]
 */
export function packageLinux({ env = process.env, root = ROOT, run = execFileSync, appimagetool } = {}) {
  const channel = env.CHANNEL;
  if (!channel) throw new Error('Set CHANNEL to stable, canary or unstable.');

  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const commitSha = env.GITHUB_SHA || gitCommit(root);
  const info = deriveBuildInfo({
    packageVersion: version,
    channel,
    buildNumber: Number(env.GITHUB_RUN_NUMBER || 0),
    commit: gitCommit(root, commitSha, true),
    buildDate: env.BUILD_DATE || new Date().toISOString(),
  });

  const binary = findAppBinary(root, info.appName, 'linux', env);
  const outDir = join(root, 'dist', 'linux', channel);
  const appDir = join(outDir, 'AppDir');
  const installedBinary = `usr/bin/${info.appName}`;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(appDir, 'usr', 'bin'), { recursive: true });

  // The Tauri executable is self-contained: the web assets are inside it, and it finds the system's WebKitGTK.
  copyFileSync(binary, join(appDir, installedBinary));
  chmodSync(join(appDir, installedBinary), 0o755);

  writeFileSync(join(appDir, 'AppRun'), appRunScript(installedBinary), { mode: 0o755 });
  writeFileSync(join(appDir, `${info.identifier}.desktop`), desktopEntry({ ...info, appName: info.appName }));
  copyFileSync(join(root, 'assets', 'icons', `${channel}.png`), join(appDir, `${info.identifier}.png`));
  symlinkSync(`${info.identifier}.png`, join(appDir, '.DirIcon'));

  const tool = appimagetool ?? ensureAppImageTool(join(root, 'dist', 'tools'), run);
  const appImageName = appImageFileName(info.appName, info.version);
  const appImagePath = join(outDir, appImageName);
  const updateInfo = updateInformation({ channel, owner: REPOSITORY.owner, repo: REPOSITORY.name, appName: info.appName });

  // appimagetool writes the .zsync file into its working directory, so run it inside outDir.
  run(tool, ['--appimage-extract-and-run', '--no-appstream', '-u', updateInfo, appDir, appImagePath], {
    cwd: outDir,
    env: { ...env, ARCH: 'x86_64' },
    stdio: 'inherit',
  });

  const assets = [{ name: appImageName, path: appImagePath, pointer: false }];
  const zsyncPath = `${appImagePath}.zsync`;
  if (existsSync(zsyncPath)) assets.push({ name: `${appImageName}.zsync`, path: zsyncPath, pointer: false });

  // Pointer releases hold the same binary under a fixed name, so the update URL never changes.
  const pointerTag = POINTER_TAGS[channel] ?? null;
  if (pointerTag) {
    const pointerName = pointerFileName(info.appName);
    const pointerPath = join(outDir, pointerName);
    copyFileSync(appImagePath, pointerPath);
    chmodSync(pointerPath, 0o755);
    if (existsSync(zsyncPath)) {
      run('zsyncmake', ['-u', pointerName, '-o', `${pointerPath}.zsync`, pointerPath], { cwd: outDir });
      assets.push({ name: pointerName, path: pointerPath, pointer: true });
      assets.push({ name: `${pointerName}.zsync`, path: `${pointerPath}.zsync`, pointer: true });
    } else {
      assets.push({ name: pointerName, path: pointerPath, pointer: true });
    }
  }

  // Platform-specific checksum names, so Linux and Windows assets can share one release.
  const checksums = assets.map(asset => `${sha256(asset.path)}  ${asset.name}`).join('\n');
  writeFileSync(join(outDir, 'SHA256SUMS-linux.txt'), `${checksums}\n`);
  assets.push({ name: 'SHA256SUMS-linux.txt', path: join(outDir, 'SHA256SUMS-linux.txt'), pointer: false });

  const metadata = releaseMetadata({
    channel,
    platform: 'linux',
    version: info.version,
    commit: info.commit,
    commitSha,
    tag: tagFor(channel, info.version),
    pointerTag,
    assets: assets.map(({ name, pointer }) => ({ name, pointer })),
  });
  writeFileSync(join(outDir, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`);

  rmSync(appDir, { recursive: true, force: true });
  return { outDir, metadata };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir, metadata } = packageLinux();
  console.log(`packaged ${metadata.version} for ${metadata.channel} into ${outDir}`);
  for (const asset of metadata.assets) console.log(`  ${asset.name}${asset.pointer ? ' (pointer)' : ''}`);
}
