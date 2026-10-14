import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataFs } from './diagnostics/fs';

/** DataFs on node:fs, for Bun and Node. Creates files with mode 0600 and folders with 0700. */
export const nodeDataFs: DataFs = {
  join: (...parts) => join(...parts),

  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },

  size: async (path) => (await stat(path)).size,

  readText: (path) => readFile(path, 'utf8'),

  async writeText(path, text, options) {
    if (options?.append) await appendFile(path, text, { mode: 0o600 });
    else await writeFile(path, text, { mode: 0o600 });
  },

  async mkdirp(path) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  },

  rename: (from, to) => rename(from, to),

  remove: (path) => rm(path, { force: true }),

  async list(path) {
    try {
      return await readdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  },
};
