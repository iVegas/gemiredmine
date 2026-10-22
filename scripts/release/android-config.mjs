// Prints one part of the Android build for the channel in CHANNEL, for the Dockerfile:
//   config (default): the Tauri overlay that `tauri android init` and `tauri android build` take with --config
//   features:         the Cargo features as --features arguments, empty when the channel has none
// The identifier, name, icons and version code all come from channels.mjs and tauri-config.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveBuildInfo } from './channels.mjs';
import { androidBuildFeatures, tauriAndroidConfig } from './tauri-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const env = process.env;
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const info = deriveBuildInfo({
  packageVersion: version,
  channel: env.CHANNEL || 'dev',
  platform: 'android',
  buildNumber: Number(env.GITHUB_RUN_NUMBER || 0),
});

const part = process.argv[2] ?? 'config';
if (part === 'config') process.stdout.write(JSON.stringify(tauriAndroidConfig(info)));
else if (part === 'features') {
  const features = androidBuildFeatures(info);
  process.stdout.write(features.length ? `--features ${features.join(',')}` : '');
} else throw new Error(`Unknown part "${part}". Use config or features.`);
