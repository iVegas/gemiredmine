// A stand-in for @tauri-apps/plugin-fs that follows the plugin's Rust commands (tauri-plugin-fs
// commands.rs): the same failures for missing paths, the same append/create/mode options, and
// permission bits as the system would leave them after the umask. Errors are plain strings, the way
// the plugin rejects.

const UMASK = 0o022;

interface Entry {
  kind: 'file' | 'folder';
  mode: number;
  data: Uint8Array;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

const notFound = (action: string, path: string) =>
  `failed to ${action} ${path} with error: No such file or directory (os error 2)`;

export function createFakePluginFs() {
  const entries = new Map<string, Entry>([['/', { kind: 'folder', mode: 0o755, data: new Uint8Array() }]]);

  const requireEntry = (action: string, path: string) => {
    const entry = entries.get(path);
    if (!entry) return Promise.reject(notFound(action, path));
    return Promise.resolve(entry);
  };

  return {
    entries,
    /** Permission bits of a file or folder */
    modeOf: (path: string) => entries.get(path)?.mode,

    exists: async (path: string) => entries.has(path),

    async stat(path: string) {
      const entry = await requireEntry('get metadata of path:', path);
      return { size: entry.data.length, isFile: entry.kind === 'file', isDirectory: entry.kind === 'folder', isSymlink: false };
    },

    async mkdir(path: string, options?: { recursive?: boolean; mode?: number }) {
      const mode = (options?.mode ?? 0o777) & ~UMASK;
      const missing: string[] = [];
      for (let folder = path; !entries.has(folder); folder = parentOf(folder)) missing.unshift(folder);
      if (missing.length === 0 && !options?.recursive) {
        throw `failed to create directory at path: ${path} with error: File exists (os error 17)`;
      }
      if (missing.length > 1 && !options?.recursive) throw notFound('create directory at path:', path);
      for (const folder of missing) entries.set(folder, { kind: 'folder', mode, data: new Uint8Array() });
    },

    async readFile(path: string) {
      const entry = await requireEntry('read file at path:', path);
      return new Uint8Array(entry.data);
    },

    async writeFile(
      path: string,
      data: Uint8Array,
      options?: { append?: boolean; create?: boolean; mode?: number }
    ) {
      const existing = entries.get(path);
      if (!existing && options?.create === false) throw notFound('write bytes to file at path:', path);
      if (!existing && entries.get(parentOf(path))?.kind !== 'folder') throw notFound('write bytes to file at path:', path);
      const previous = options?.append && existing ? existing.data : new Uint8Array();
      const combined = new Uint8Array(previous.length + data.length);
      combined.set(previous);
      combined.set(data, previous.length);
      entries.set(path, {
        kind: 'file',
        // An existing file keeps its bits, like open(2) with O_CREAT.
        mode: existing?.mode ?? (options?.mode ?? 0o666) & ~UMASK,
        data: combined,
      });
    },

    async readDir(path: string) {
      const folder = await requireEntry('read directory at path:', path);
      if (folder.kind !== 'folder') throw `failed to read directory at path: ${path} with error: Not a directory (os error 20)`;
      return [...entries]
        .filter(([child]) => child !== path && parentOf(child) === path)
        .map(([child, entry]) => ({
          name: child.slice(child.lastIndexOf('/') + 1),
          isFile: entry.kind === 'file',
          isDirectory: entry.kind === 'folder',
          isSymlink: false,
        }));
    },

    async rename(from: string, to: string) {
      const entry = await requireEntry('rename', from);
      entries.set(to, entry);
      entries.delete(from);
    },

    async remove(path: string) {
      await requireEntry('get metadata of path:', path);
      entries.delete(path);
    },
  };
}

export type FakePluginFs = ReturnType<typeof createFakePluginFs>;

/** The fake that the plugin module mock currently serves. Tests create a new one before each test. */
export const current: { fs: FakePluginFs } = { fs: createFakePluginFs() };

export function resetFakePluginFs(): FakePluginFs {
  current.fs = createFakePluginFs();
  return current.fs;
}

/** The module's exports, which go to the current fake. Only the commands the app is allowed to use exist. */
export const pluginFsModule = {
  exists: (...args: Parameters<FakePluginFs['exists']>) => current.fs.exists(...args),
  stat: (...args: Parameters<FakePluginFs['stat']>) => current.fs.stat(...args),
  mkdir: (...args: Parameters<FakePluginFs['mkdir']>) => current.fs.mkdir(...args),
  readFile: (...args: Parameters<FakePluginFs['readFile']>) => current.fs.readFile(...args),
  writeFile: (...args: Parameters<FakePluginFs['writeFile']>) => current.fs.writeFile(...args),
  readDir: (...args: Parameters<FakePluginFs['readDir']>) => current.fs.readDir(...args),
  rename: (...args: Parameters<FakePluginFs['rename']>) => current.fs.rename(...args),
  remove: (...args: Parameters<FakePluginFs['remove']>) => current.fs.remove(...args),
};
