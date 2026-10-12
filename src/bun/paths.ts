import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where a channel keeps its own settings and logs. Each channel has a different
 * directory name, so installs never read or overwrite each other's configuration.
 * GEMIREDMINE_DATA_DIR overrides the location, for portable setups and tests.
 */
export function dataDirFor(dataDirName: string, env: Record<string, string | undefined> = process.env): string {
  if (env.GEMIREDMINE_DATA_DIR) return env.GEMIREDMINE_DATA_DIR;
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), dataDirName);
}
