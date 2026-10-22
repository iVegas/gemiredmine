#!/usr/bin/env node
// Builds the Tauri desktop executable for one release channel. Reads CHANNEL (default: dev).
//
// It builds the bare executable (`--no-bundle`): the Flatpak bundle and the MSIX are made from it by
// flatpak-build.sh and package-windows.mjs, which Tauri's own bundlers cannot produce. The channel's
// identity comes from tauri-config.mjs, laid over src-tauri/tauri.conf.json with `--config`.
//
// The web assets are built by the config's `beforeBuildCommand` (`npm run build`), whose `prebuild`
// step writes the build info for this same CHANNEL.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS, deriveBuildInfo, hostPlatform } from './channels.mjs';
import { tauriBuildArgs, tauriChannelConfig } from './tauri-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const channel = process.env.CHANNEL || 'dev';
if (!(channel in CHANNELS)) {
  throw new Error(`Unknown channel "${channel}". Expected one of: ${Object.keys(CHANNELS).join(', ')}`);
}

const { version: packageVersion } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const info = deriveBuildInfo({
  packageVersion,
  channel,
  platform: process.env.TARGET_PLATFORM || hostPlatform(),
  buildNumber: Number(process.env.GITHUB_RUN_NUMBER || 0),
  buildDate: process.env.BUILD_DATE || new Date().toISOString(),
});

const overlayPath = join(ROOT, 'build', `tauri.${channel}.conf.json`);
mkdirSync(dirname(overlayPath), { recursive: true });
writeFileSync(overlayPath, `${JSON.stringify(tauriChannelConfig(info), null, 2)}\n`);

// Runs the CLI's script with this Node.js, so no shell is needed on any platform
// (npx is a batch file on Windows, and running it needs a shell).
const packageDir = join(ROOT, 'node_modules', '@tauri-apps', 'cli');
const { bin } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const cli = join(packageDir, typeof bin === 'string' ? bin : bin.tauri);

const args = tauriBuildArgs(info, { cli, overlayPath });
execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
