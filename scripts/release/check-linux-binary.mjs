#!/usr/bin/env node
// Checks that the Linux executable runs on the oldest system the AppImage supports.
//
// usage: node scripts/release/check-linux-binary.mjs [executable]   (default: the executable built for $CHANNEL)
//
// The AppImage carries only the executable; the system supplies GTK, WebKitGTK and the C library. So the
// executable has to be built on an old enough system (the CI runner sets the floor), find all its libraries,
// and not need a tray library, which many desktops do not have installed.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from './channels.mjs';
import { findAppBinary } from './build-output.mjs';

/** The newest glibc the supported systems have: Ubuntu 22.04 and Debian 12 ship 2.35 and 2.36. */
export const MAX_GLIBC = '2.35';

/** Libraries the app must not need, because most desktops do not have them. */
const FORBIDDEN_LIBRARIES = [/libayatana-appindicator/, /libappindicator/];

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The newest GLIBC_x.y symbol version named in `objdump -T` output, or null when there is none. */
export function maxGlibcVersion(objdumpOutput) {
  const versions = [...objdumpOutput.matchAll(/GLIBC_(\d+(?:\.\d+)+)/g)].map(match => match[1]);
  return versions.length === 0 ? null : versions.reduce((newest, version) => (compareVersions(version, newest) > 0 ? version : newest));
}

/** The problems with an executable, from `ldd` and `objdump -T` output. Empty when it is fine. */
export function findProblems({ ldd, objdump, maxGlibc = MAX_GLIBC }) {
  const problems = [];

  for (const line of ldd.split('\n')) {
    if (/not found/.test(line)) problems.push(`A library is missing: ${line.trim()}`);
    if (FORBIDDEN_LIBRARIES.some(pattern => pattern.test(line))) problems.push(`A tray library is linked: ${line.trim()}`);
  }

  const glibc = maxGlibcVersion(objdump);
  if (glibc === null) problems.push('No GLIBC symbol versions were found; is this a Linux executable?');
  else if (compareVersions(glibc, maxGlibc) > 0) problems.push(`It needs glibc ${glibc}, and ${maxGlibc} is the newest supported.`);

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const channel = process.env.CHANNEL || 'dev';
  if (!(channel in CHANNELS)) throw new Error(`Unknown channel "${channel}".`);
  const executable = process.argv[2] ?? findAppBinary(root, CHANNELS[channel].appName, 'linux');

  const ldd = execFileSync('ldd', [executable], { encoding: 'utf8' });
  const objdump = execFileSync('objdump', ['-T', executable], { encoding: 'utf8' });
  const problems = findProblems({ ldd, objdump });

  console.log(`${executable}: needs glibc ${maxGlibcVersion(objdump)} or newer; ${ldd.split('\n').filter(Boolean).length} libraries`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error title=Linux executable::${problem}`);
    process.exit(1);
  }
}
