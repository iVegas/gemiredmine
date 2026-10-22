#!/usr/bin/env node
// Packages the signed Android APK of one channel for the release workflow. The APK is built by the Dockerfile
// (docker/android/Dockerfile) into dist/android-build; this only names and checksums it.
//
// Inputs:  CHANNEL, GITHUB_RUN_NUMBER (unstable build number), GITHUB_SHA (optional)
// Outputs: dist/android/<channel>/ containing the APK, SHA256SUMS-android.txt and release.json, which the publish step reads.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveBuildInfo } from './channels.mjs';
import { sha256 } from './checksum.mjs';
import { releaseMetadata } from './release-metadata.mjs';
import { POINTER_TAGS, tagFor } from './policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Where the Dockerfile's release stage leaves the signed APK. */
export const APK_IN_BUILD = join('universal', 'release', 'app-universal-release.apk');

export function packageAndroid({ env = process.env, root = ROOT } = {}) {
  const channel = env.CHANNEL;
  if (!channel) throw new Error('Set CHANNEL to stable, canary or unstable.');

  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const commitSha = env.GITHUB_SHA || 'unknown';
  const info = deriveBuildInfo({
    packageVersion: version,
    channel,
    platform: 'android',
    buildNumber: Number(env.GITHUB_RUN_NUMBER || 0),
    commit: commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 7),
    buildDate: env.BUILD_DATE || new Date().toISOString(),
  });

  const source = join(root, 'dist', 'android-build', APK_IN_BUILD);
  if (!existsSync(source)) {
    throw new Error(`No signed APK at ${source}. Build it with the Dockerfile's default target and the signing secrets.`);
  }

  const outDir = join(root, 'dist', 'android', channel);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const apkName = `${info.appName}-${info.version}.apk`;
  const apkPath = join(outDir, apkName);
  copyFileSync(source, apkPath);

  // Pointer releases hold the same APK under a fixed name, as the Windows packages do. The publish step requires every
  // platform of one channel to name the same pointer tag, so Android names it too.
  const pointerTag = POINTER_TAGS[channel] ?? null;
  const assets = [{ name: apkName, path: apkPath, pointer: false }];
  if (pointerTag) {
    const pointerName = `${info.appName}.apk`;
    const pointerPath = join(outDir, pointerName);
    copyFileSync(apkPath, pointerPath);
    assets.push({ name: pointerName, path: pointerPath, pointer: true });
  }

  const sums = assets.map(asset => `${sha256(asset.path)}  ${asset.name}`).join('\n');
  writeFileSync(join(outDir, 'SHA256SUMS-android.txt'), `${sums}\n`);
  assets.push({ name: 'SHA256SUMS-android.txt', path: join(outDir, 'SHA256SUMS-android.txt'), pointer: false });

  const metadata = releaseMetadata({
    channel,
    platform: 'android',
    version: info.version,
    commit: info.commit,
    commitSha,
    tag: tagFor(channel, info.version),
    pointerTag,
    assets: assets.map(({ name, pointer }) => ({ name, pointer })),
  });
  writeFileSync(join(outDir, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return { outDir, metadata };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir, metadata } = packageAndroid();
  console.log(`packaged ${metadata.version} for ${metadata.channel} into ${outDir}`);
  for (const asset of metadata.assets) console.log(`  ${asset.name}`);
}
