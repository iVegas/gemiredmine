#!/usr/bin/env node
// Runs the Electrobun build for one release channel. Reads CHANNEL (default: dev).
//
// Every channel uses Electrobun's unpacked "dev" layout. The stable and canary layouts
// are compressed self-extracting installers that need Electrobun's installer to run;
// the AppImage is already a compressed, self-contained package, so it wraps the
// unpacked layout instead. Channel identity (name, identifier, version) comes from
// electrobun.config.ts, not from Electrobun's environment.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHANNELS = ['stable', 'canary', 'unstable', 'dev'];

const channel = process.env.CHANNEL || 'dev';
if (!CHANNELS.includes(channel)) {
  throw new Error(`Unknown channel "${channel}". Expected one of: ${CHANNELS.join(', ')}`);
}

// Runs Electrobun's CLI script with this Node.js, so no shell is needed on any platform
// (npx is a batch file on Windows, and running it needs a shell).
const packageDir = join(ROOT, 'node_modules', 'electrobun');
const { bin } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const cli = join(packageDir, typeof bin === 'string' ? bin : bin.electrobun);
execFileSync(process.execPath, [cli, 'build', '--env=dev'], {
  stdio: 'inherit',
  env: process.env,
});
