#!/usr/bin/env node
// Checks that the Windows executable runs on a clean Windows 11, where no Visual C++ redistributable or
// WebView2 loader is installed next to it.
//
// usage: node scripts/release/check-windows-binary.mjs [executable]   (default: the executable built for $CHANNEL)
//        DUMPBIN=<path to dumpbin.exe> overrides where dumpbin is looked for.
//
// The MSIX holds only the executable. Tauri links the Visual C++ runtime and the WebView2 loader into it,
// so none of those DLLs may show up as a dependency; the system DLLs (kernel32, the Universal CRT) may.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from './channels.mjs';
import { findAppBinary } from './build-output.mjs';

/** DLLs the user would have to install, and that the executable must therefore not need. */
const FORBIDDEN_DLLS = [/^vcruntime\d+(_\d+)?\.dll$/i, /^msvcp\d+(_\d+)?\.dll$/i, /^concrt\d+\.dll$/i, /^webview2loader\.dll$/i];

/** The DLL names `dumpbin /DEPENDENTS` lists, delay-loaded ones included. */
export function dependentsOf(dumpbinOutput) {
  return [...dumpbinOutput.matchAll(/^\s+(\S+\.dll)\s*$/gim)].map(match => match[1]);
}

/** The problems with an executable, from `dumpbin /DEPENDENTS` output. Empty when it is fine. */
export function findProblems(dumpbinOutput) {
  const dependents = dependentsOf(dumpbinOutput);
  if (dependents.length === 0) return ['dumpbin listed no dependencies; is this a Windows executable?'];
  return dependents.filter(dll => FORBIDDEN_DLLS.some(pattern => pattern.test(dll))).map(dll => `It needs ${dll}, which a clean Windows does not have.`);
}

/** Finds dumpbin.exe with vswhere, the way the Visual Studio installer documents. */
export function findDumpbin({ env = process.env, run = execFileSync } = {}) {
  if (env.DUMPBIN) return env.DUMPBIN;
  const vswhere = join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (existsSync(vswhere)) {
    const found = run(vswhere, ['-latest', '-products', '*', '-find', 'VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\dumpbin.exe'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .find(Boolean);
    if (found) return found.trim();
  }
  throw new Error('dumpbin.exe was not found. Install the Visual Studio C++ build tools or set DUMPBIN.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const channel = process.env.CHANNEL || 'dev';
  if (!(channel in CHANNELS)) throw new Error(`Unknown channel "${channel}".`);
  const executable = process.argv[2] ?? findAppBinary(root, CHANNELS[channel].appName, 'windows');

  const output = execFileSync(findDumpbin(), ['/DEPENDENTS', executable], { encoding: 'utf8' });
  const problems = findProblems(output);

  console.log(`${executable} depends on: ${dependentsOf(output).join(', ')}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error title=Windows executable::${problem}`);
    process.exit(1);
  }
}
