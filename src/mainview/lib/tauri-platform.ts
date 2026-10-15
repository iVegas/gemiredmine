import { invoke } from '@tauri-apps/api/core';
import { localDataDir, sep } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readFile, remove, rename, stat, writeFile } from '@tauri-apps/plugin-fs';
import { fetch as pluginFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import Database from '@tauri-apps/plugin-sql';
import { buildInfo } from '../../shared/build-info.generated';
import type { BackendPlatform, CredentialStore } from '../../bun/backend';
import type { DataFs } from '../../bun/diagnostics/fs';
import type { FetchLike } from '../../bun/redmine/client';
import type { SqlDatabase, SqlRow } from '../../bun/storage/database';

// The desktop shell runs the backend inside the webview. These are its hands: Rust-side HTTP and
// file plugins (the webview itself may not connect anywhere, see the CSP), and the system browser.

/** How long to wait for a connection before telling the user the server is not reachable. */
const CONNECT_TIMEOUT_MS = 10_000;

/** The plugins reject with a bare string, where the rest of the app expects an Error, as fetch rejects with. */
const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/**
 * Sends a request through the Rust HTTP client, which needs no CORS headers from the server.
 * Redirects are not followed: the client would send the API key header to the new host too, and a
 * moved server is something the user should fix, so the Redmine client reports the 3xx instead.
 */
export const tauriFetch: FetchLike = async (url, init) => {
  try {
    return await pluginFetch(url, { ...init, maxRedirections: 0, connectTimeout: CONNECT_TIMEOUT_MS });
  } catch (error) {
    throw toError(error);
  }
};

const FILE_MODE = 0o600;
const FOLDER_MODE = 0o700;

/** Joins path parts with the system's separator, without touching the disk (DataFs.join is synchronous). */
function joinPath(separator: string, parts: string[]): string {
  return parts
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, '')))
    .filter((part, index) => index === 0 || part !== '')
    .join(separator);
}

/**
 * DataFs on the file plugin. New files are 0600 and new folders 0700 where the system has such bits.
 * Only the byte-based commands are used: the plugin's text-file commands are removed in Tauri 3.
 */
export const tauriDataFs: DataFs = {
  join: (...parts) => joinPath(sep(), parts),

  exists: (path) => exists(path),

  size: async (path) => (await stat(path)).size,

  readText: async (path) => new TextDecoder().decode(await readFile(path)),

  writeText: (path, text, options) =>
    writeFile(path, new TextEncoder().encode(text), { append: options?.append === true, mode: FILE_MODE }),

  mkdirp: (path) => mkdir(path, { recursive: true, mode: FOLDER_MODE }),

  rename: (from, to) => rename(from, to),

  async remove(path) {
    try {
      await remove(path);
    } catch (error) {
      // The plugin fails on a missing path; the port treats that as already done.
      if (await exists(path)) throw error;
    }
  },

  async list(path) {
    if (!(await exists(path))) return [];
    return (await readDir(path)).map((entry) => entry.name);
  },
};

/** What the Rust side reports (src-tauri/src/lib.rs `AppEnvironment`). */
export interface AppEnvironment {
  dataDirOverride: string | null;
  tauri: string;
  webview: string;
  os: string;
  arch: string;
}

const WEBVIEWS: Record<string, string> = { linux: 'WebKitGTK', windows: 'WebView2', macos: 'WKWebView', android: 'Android System WebView' };

/** The names Node uses for the platform and CPU, which the feedback reports use. */
export function toEnvironment(app: AppEnvironment) {
  return {
    platform: app.os === 'windows' ? 'win32' : app.os,
    arch: app.arch === 'x86_64' ? 'x64' : app.arch === 'aarch64' ? 'arm64' : app.arch,
    runtime: `tauri ${app.tauri} (${WEBVIEWS[app.os] ?? 'webview'} ${app.webview})`,
  };
}

let appEnvironment: Promise<AppEnvironment> | null = null;
const readAppEnvironment = () => (appEnvironment ??= invoke<AppEnvironment>('app_environment'));

/** The channel's data folder: GEMIREDMINE_DATA_DIR when set, else below the user's local data folder. */
export async function dataDir(): Promise<string> {
  const { dataDirOverride } = await readAppEnvironment();
  if (dataDirOverride) return dataDirOverride;
  return joinPath(sep(), [await localDataDir(), buildInfo.dataDirName]);
}

/** The app's database, a file in the channel's data folder. */
export const DATABASE_FILE = 'gemiredmine.db';

/**
 * The connection string the SQL plugin takes for a file: `sqlite:` and the path. The plugin reads a `?` as the start
 * of options and decodes `%` escapes, so those two characters of a folder name are escaped.
 */
export function sqliteUrl(path: string): string {
  return `sqlite:${path.replace(/%/g, '%25').replace(/\?/g, '%3F')}`;
}

/**
 * Opens the app's database in the channel's data folder. The Rust side makes the folder first, because the SQL
 * plugin creates the file but not the folder around it. Only the main window may talk to the plugin
 * (src-tauri/capabilities/storage.json).
 */
export async function openDatabase(): Promise<SqlDatabase> {
  try {
    const folder = await invoke<string>('prepare_storage_dir', { name: buildInfo.dataDirName });
    const connection = await Database.load(sqliteUrl(joinPath(sep(), [folder, DATABASE_FILE])));
    return {
      execute: async (sql, params = []) => {
        try {
          await connection.execute(sql, [...params]);
        } catch (error) {
          throw toError(error);
        }
      },
      select: async (sql, params = []) => {
        try {
          return await connection.select<SqlRow[]>(sql, [...params]);
        } catch (error) {
          throw toError(error);
        }
      },
    };
  } catch (error) {
    throw toError(error);
  }
}

/**
 * The system's credential store, through the Rust side (src-tauri/src/credentials.rs): Windows Credential Manager, or
 * the Secret Service on Linux. The Rust side answers with a message when the store cannot be used.
 */
export const tauriCredentials: CredentialStore = {
  async get(serverId) {
    try {
      return await invoke<string | null>('credential_load', { serverId });
    } catch (error) {
      throw toError(error);
    }
  },

  async set(serverId, apiKey) {
    try {
      await invoke('credential_save', { serverId, token: apiKey });
    } catch (error) {
      throw toError(error);
    }
  },

  async remove(serverId) {
    try {
      await invoke('credential_delete', { serverId });
    } catch (error) {
      throw toError(error);
    }
  },
};

/** The backend's platform inside the Tauri webview. */
export function tauriPlatform(): BackendPlatform {
  return {
    fetch: tauriFetch,
    fs: tauriDataFs,
    dataDir,
    database: openDatabase,
    credentials: tauriCredentials,
    openUrl: (url) => openUrl(url),
    environment: async () => toEnvironment(await readAppEnvironment()),
  };
}
