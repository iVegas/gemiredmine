// Locates the application folder Electrobun produced for one channel.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Electrobun writes build/<env>-<os>-x64/<name>, where <name> is `<app>` for the stable
 * environment and `<app>-<env>` otherwise, for example build/canary-linux-x64/Gemiredmine-Unstable-canary.
 * Only those exact names are accepted, so one channel can never package another channel's build.
 * The launcher is `launcher` on Linux and `launcher.exe` on Windows.
 */
export function findAppBuild(buildRoot, appName) {
  if (!existsSync(buildRoot)) throw new Error(`No Electrobun build found at ${buildRoot}. Run the build first.`);
  for (const envDir of readdirSync(buildRoot)) {
    const electrobunEnv = /^(.+)-(linux|win|windows)-x64$/.exec(envDir)?.[1];
    if (!electrobunEnv) continue;
    for (const name of [appName, `${appName}-${electrobunEnv}`]) {
      const candidate = join(buildRoot, envDir, name);
      if (existsSync(join(candidate, 'bin', 'launcher')) || existsSync(join(candidate, 'bin', 'launcher.exe'))) {
        return candidate;
      }
    }
  }
  throw new Error(`No ${appName} build found under ${buildRoot}.`);
}
