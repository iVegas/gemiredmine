// Locates the executable `tauri build` produced for one release channel.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `tauri build --no-bundle` leaves <target>/release/<mainBinaryName>[.exe], where the target folder is
 * CARGO_TARGET_DIR or src-tauri/target, and mainBinaryName is the channel's app name (see tauri-config.mjs).
 * Only that exact name is accepted, so one channel can never package another channel's build.
 */
export function findAppBinary(root, appName, platform, env = process.env) {
  const targetDir = env.CARGO_TARGET_DIR ? resolve(root, env.CARGO_TARGET_DIR) : join(root, 'src-tauri', 'target');
  const binary = join(targetDir, 'release', platform === 'windows' ? `${appName}.exe` : appName);
  if (!existsSync(binary)) {
    throw new Error(`No ${appName} executable found at ${binary}. Run \`npm run build:desktop\` for this channel first.`);
  }
  return binary;
}
