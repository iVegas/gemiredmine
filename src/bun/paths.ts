import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where a channel keeps its own settings and logs. Each channel has a different directory
 * name, so installs never read or overwrite each other's configuration. On Windows the
 * packaged app's LocalAppData is also private to its package identity, which keeps channels apart too.
 * GEMIREDMINE_DATA_DIR overrides the location, for portable setups and tests.
 */
export function dataDirFor(
  dataDirName: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env.GEMIREDMINE_DATA_DIR) return env.GEMIREDMINE_DATA_DIR;
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), dataDirName);
  }
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), dataDirName);
}
