#!/usr/bin/env node
// Runs the Electrobun build for one release channel. Reads CHANNEL (default: dev).
//
// Every channel uses Electrobun's unpacked "dev" layout. The stable and canary layouts
// are compressed self-extracting installers that need Electrobun's installer to run;
// the AppImage is already a compressed, self-contained package, so it wraps the
// unpacked layout instead. Channel identity (name, identifier, version) comes from
// electrobun.config.ts, not from Electrobun's environment.
import { execFileSync } from 'node:child_process';

const CHANNELS = ['stable', 'canary', 'unstable', 'dev'];

const channel = process.env.CHANNEL || 'dev';
if (!CHANNELS.includes(channel)) {
  throw new Error(`Unknown channel "${channel}". Expected one of: ${CHANNELS.join(', ')}`);
}

execFileSync('npx', ['electrobun', 'build', '--env=dev'], { stdio: 'inherit', env: process.env });
