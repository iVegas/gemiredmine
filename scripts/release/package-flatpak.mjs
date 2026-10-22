#!/usr/bin/env node
// Packages the Flatpak bundle that flatpak-build.sh wrote for one channel: names it, checksums it and writes the
// release.json that the publish step reads. The bundle is built in the Flatpak environment image; this only renames it.
//
// Inputs:  CHANNEL, GITHUB_RUN_NUMBER (unstable build number), GITHUB_SHA (optional)
// Outputs: dist/linux/<channel>/ containing the bundle, its pointer copy (canary and unstable), SHA256SUMS-linux.txt
//          and release.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveBuildInfo } from './channels.mjs';
import { flatpakAppId } from './flatpak-manifest.mjs';
import { releaseMetadata } from './release-metadata.mjs';
import { POINTER_TAGS, tagFor } from './policy.mjs';
import { sha256 } from './checksum.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function packageFlatpak({ env = process.env, root = ROOT } = {}) {
  const channel = env.CHANNEL;
  if (!channel) throw new Error('Set CHANNEL to stable, canary, unstable or dev.');

  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const commitSha = env.GITHUB_SHA || 'unknown';
  const info = deriveBuildInfo({
    packageVersion: version,
    channel,
    platform: 'linux',
    buildNumber: Number(env.GITHUB_RUN_NUMBER || 0),
    commit: commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 7),
    buildDate: env.BUILD_DATE || new Date().toISOString(),
  });

  const source = join(root, 'dist', 'flatpak', channel, 'bundle.flatpak');
  if (!existsSync(source)) throw new Error(`No Flatpak bundle at ${source}. Run scripts/release/flatpak-build.sh first.`);

  const outDir = join(root, 'dist', 'linux', channel);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const bundleName = `${info.appName}-${info.version}-x86_64.flatpak`;
  const bundlePath = join(outDir, bundleName);
  copyFileSync(source, bundlePath);
  const assets = [{ name: bundleName, path: bundlePath, pointer: false }];

  // Pointer releases hold the same bundle under a fixed name, as Windows and Android do, so one channel's platforms
  // all name the same pointer tag.
  const pointerTag = POINTER_TAGS[channel] ?? null;
  if (pointerTag) {
    const pointerName = `${info.appName}-x86_64.flatpak`;
    const pointerPath = join(outDir, pointerName);
    copyFileSync(bundlePath, pointerPath);
    assets.push({ name: pointerName, path: pointerPath, pointer: true });
  }

  const sums = assets.map(asset => `${sha256(asset.path)}  ${asset.name}`).join('\n');
  writeFileSync(join(outDir, 'SHA256SUMS-linux.txt'), `${sums}\n`);
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
  return { outDir, metadata, appId: flatpakAppId(info) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir, metadata } = packageFlatpak();
  console.log(`packaged ${metadata.version} for ${metadata.channel} into ${outDir}`);
  for (const asset of metadata.assets) console.log(`  ${asset.name}${asset.pointer ? ' (pointer)' : ''}`);
}
