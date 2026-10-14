import type { DataFs } from '../../fs';

const encoder = new TextEncoder();

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

function missing(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });
}

/**
 * A DataFs held in memory, for tests that should not touch the disk. Paths are absolute and use "/".
 * It does not model permission bits.
 */
export function createMemoryDataFs(): DataFs & { files: Map<string, string>; folders: Set<string> } {
  const files = new Map<string, string>();
  const folders = new Set<string>(['/']);

  return {
    files,
    folders,

    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),

    exists: async (path) => files.has(path) || folders.has(path),

    async size(path) {
      const text = files.get(path);
      if (text === undefined) throw missing(path);
      return encoder.encode(text).length;
    },

    async readText(path) {
      const text = files.get(path);
      if (text === undefined) throw missing(path);
      return text;
    },

    async writeText(path, text, options) {
      if (!folders.has(parentOf(path))) throw missing(path);
      files.set(path, options?.append ? (files.get(path) ?? '') + text : text);
    },

    async mkdirp(path) {
      for (let folder = path; folder !== '/'; folder = parentOf(folder)) folders.add(folder);
    },

    async rename(from, to) {
      const text = files.get(from);
      if (text === undefined) throw missing(from);
      files.set(to, text);
      files.delete(from);
    },

    async remove(path) {
      files.delete(path);
    },

    async list(path) {
      const names = new Set<string>();
      for (const entry of [...files.keys(), ...folders]) {
        if (entry !== path && parentOf(entry) === path) names.add(entry.slice(path === '/' ? 1 : path.length + 1));
      }
      return [...names];
    },
  };
}
