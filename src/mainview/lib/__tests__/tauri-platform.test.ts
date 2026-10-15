import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { sep } from '@tauri-apps/api/path';
import { fetch as pluginFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import Database from '@tauri-apps/plugin-sql';
import { buildInfo } from '../../../shared/build-info.generated';
import { describeDataFsContract } from '../../../bun/diagnostics/__tests__/data-fs.contract';
import { resetFakePluginFs, type FakePluginFs } from './support/fake-plugin-fs';
import {
  DATABASE_FILE,
  dataDir,
  openDatabase,
  sqliteUrl,
  tauriDataFs,
  tauriFetch,
  tauriPlatform,
  toEnvironment,
  type AppEnvironment,
} from '../tauri-platform';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ localDataDir: vi.fn(), sep: vi.fn(() => '/') }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: vi.fn() } }));
// Only the byte-based commands exist, so the adapter cannot reach for a text-file command.
vi.mock('@tauri-apps/plugin-fs', async () => (await import('./support/fake-plugin-fs')).pluginFsModule);

const linuxEnvironment: AppEnvironment = {
  dataDirOverride: null,
  tauri: '2.12.4',
  webview: '2.44.1',
  os: 'linux',
  arch: 'x86_64',
};

describe('tauriFetch', () => {
  beforeEach(() => {
    vi.mocked(pluginFetch).mockReset().mockResolvedValue(new Response('{}'));
  });

  it('sends the request through the Rust client, without following redirects', async () => {
    const signal = new AbortController().signal;
    const headers = new Headers({ 'X-Redmine-API-Key': 'secret' });
    const init: RequestInit = { method: 'GET', headers, signal };

    await tauriFetch('http://redmine.local:8080/issues.json', init);

    expect(pluginFetch).toHaveBeenCalledWith('http://redmine.local:8080/issues.json', {
      method: 'GET',
      headers,
      signal,
      // reqwest would send the API key to whatever host a redirect names.
      maxRedirections: 0,
      connectTimeout: 10_000,
    });
  });

  it('leaves the init it was given alone', async () => {
    const init: RequestInit = { method: 'GET' };

    await tauriFetch('https://r.example/a', init);

    expect(init).toEqual({ method: 'GET' });
  });

  it('rejects with an Error, as fetch does, when the plugin rejects with a string', async () => {
    vi.mocked(pluginFetch).mockRejectedValue('error sending request for url (https://r.example/a)');

    const failure = await tauriFetch('https://r.example/a', {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('error sending request for url (https://r.example/a)');
  });

  it('keeps an Error that the plugin rejects with', async () => {
    const cancelled = new Error('Request cancelled');
    vi.mocked(pluginFetch).mockRejectedValue(cancelled);

    await expect(tauriFetch('https://r.example/a', {})).rejects.toBe(cancelled);
  });

  it('returns the response, including a redirect, for the Redmine client to report', async () => {
    const moved = new Response(null, { status: 301, headers: { Location: 'https://elsewhere.example/a' } });
    vi.mocked(pluginFetch).mockResolvedValue(moved);

    expect(await tauriFetch('https://r.example/a', {})).toBe(moved);
  });
});

describe('tauriDataFs', () => {
  let plugin: FakePluginFs;

  describeDataFsContract('tauri file plugin', async () => {
    plugin = resetFakePluginFs();
    await plugin.mkdir('/data', { recursive: true });
    return { fs: tauriDataFs, root: '/data', modeOf: async (path) => plugin.modeOf(path)! };
  });

  describe('against the plugin', () => {
    beforeEach(async () => {
      plugin = resetFakePluginFs();
      await plugin.mkdir('/data', { recursive: true });
      vi.mocked(sep).mockReturnValue('/');
    });

    it('writes bytes and decodes them as UTF-8, so no text-file command is needed', async () => {
      await tauriDataFs.writeText('/data/note.txt', 'é€');

      expect([...plugin.entries.get('/data/note.txt')!.data]).toEqual([...new TextEncoder().encode('é€')]);
      expect(await tauriDataFs.readText('/data/note.txt')).toBe('é€');
    });

    it('does not hide a failure to remove a file that exists', async () => {
      await tauriDataFs.writeText('/data/stuck.log', 'x');
      const failure = 'failed to remove: Permission denied (os error 13)';
      const spy = vi.spyOn(plugin, 'remove').mockRejectedValue(failure);

      await expect(tauriDataFs.remove('/data/stuck.log')).rejects.toBe(failure);
      spy.mockRestore();
    });

    it('lists nothing for a folder that is not there, but reports other failures', async () => {
      expect(await tauriDataFs.list('/data/nowhere')).toEqual([]);

      await tauriDataFs.writeText('/data/file.txt', 'x');
      await expect(tauriDataFs.list('/data/file.txt')).rejects.toMatch('Not a directory');
    });

    it('fails to read a file that is not there', async () => {
      await expect(tauriDataFs.readText('/data/missing')).rejects.toMatch('No such file');
    });
  });

  describe('join', () => {
    it('uses the separator of the system', () => {
      vi.mocked(sep).mockReturnValue('\\');
      expect(tauriDataFs.join('C:\\Users\\a\\AppData\\Local\\', 'gemiredmine', 'logs', 'd.jsonl')).toBe(
        'C:\\Users\\a\\AppData\\Local\\gemiredmine\\logs\\d.jsonl'
      );

      vi.mocked(sep).mockReturnValue('/');
      expect(tauriDataFs.join('/home/a/.local/share/', '/gemiredmine/', 'logs')).toBe('/home/a/.local/share/gemiredmine/logs');
    });

    it('keeps a root and skips empty parts', () => {
      vi.mocked(sep).mockReturnValue('/');
      expect(tauriDataFs.join('/', 'data')).toBe('/data');
      expect(tauriDataFs.join('/data', '', 'x')).toBe('/data/x');
    });
  });
});

describe('sqliteUrl', () => {
  it('is sqlite: and the path', () => {
    expect(sqliteUrl('/home/a/.local/share/gemiredmine/gemiredmine.db')).toBe('sqlite:/home/a/.local/share/gemiredmine/gemiredmine.db');
    expect(sqliteUrl('C:\\Users\\a b\\AppData\\Local\\gemiredmine\\gemiredmine.db')).toBe(
      'sqlite:C:\\Users\\a b\\AppData\\Local\\gemiredmine\\gemiredmine.db'
    );
  });

  it('escapes the two characters that the plugin reads as syntax: the start of options and escapes', () => {
    expect(sqliteUrl('/home/50%/what?/a#b.db')).toBe('sqlite:/home/50%25/what%3F/a#b.db');
  });
});

describe('openDatabase', () => {
  const connection = { execute: vi.fn(), select: vi.fn() };

  beforeEach(() => {
    vi.mocked(sep).mockReturnValue('/');
    vi.mocked(invoke).mockReset().mockResolvedValue('/home/a/.local/share/gemiredmine-test');
    vi.mocked(Database.load).mockReset().mockResolvedValue(connection as unknown as Database);
    connection.execute.mockReset().mockResolvedValue({ rowsAffected: 1 });
    connection.select.mockReset().mockResolvedValue([]);
  });

  it('has the Rust side make the channel folder, then opens the database file in it', async () => {
    await openDatabase();

    expect(invoke).toHaveBeenCalledExactlyOnceWith('prepare_storage_dir', { name: buildInfo.dataDirName });
    expect(Database.load).toHaveBeenCalledExactlyOnceWith(`sqlite:/home/a/.local/share/gemiredmine-test/${DATABASE_FILE}`);
  });

  it('puts the file in the folder the Rust side answers with, using the separator of the system', async () => {
    vi.mocked(sep).mockReturnValue('\\');
    vi.mocked(invoke).mockResolvedValue('C:\\Users\\a\\AppData\\Local\\gemiredmine');

    await openDatabase();

    expect(Database.load).toHaveBeenCalledWith(`sqlite:C:\\Users\\a\\AppData\\Local\\gemiredmine\\${DATABASE_FILE}`);
  });

  it('runs statements and queries with their parameters, as plain arrays', async () => {
    connection.select.mockResolvedValue([{ value: 'x' }]);
    const db = await openDatabase();
    const params = ['a', 1, null] as const;

    await db.execute('INSERT INTO settings (key, value) VALUES (?, ?)', params);
    await db.execute('PRAGMA user_version = 1');
    const rows = await db.select('SELECT value FROM settings WHERE key = ?', ['a']);

    expect(connection.execute).toHaveBeenNthCalledWith(1, 'INSERT INTO settings (key, value) VALUES (?, ?)', ['a', 1, null]);
    expect(connection.execute).toHaveBeenNthCalledWith(2, 'PRAGMA user_version = 1', []);
    expect(connection.select).toHaveBeenCalledWith('SELECT value FROM settings WHERE key = ?', ['a']);
    expect(rows).toEqual([{ value: 'x' }]);
  });

  it('rejects with an Error when the Rust side or the plugin rejects with a string', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('Could not create /data: Permission denied (os error 13)');
    const first = await openDatabase().catch((error: unknown) => error);
    expect(first).toBeInstanceOf(Error);
    expect((first as Error).message).toBe('Could not create /data: Permission denied (os error 13)');

    vi.mocked(Database.load).mockRejectedValueOnce('error returned from database: (code: 14) unable to open database file');
    const second = await openDatabase().catch((error: unknown) => error);
    expect(second).toBeInstanceOf(Error);
    expect((second as Error).message).toContain('unable to open database file');
  });

  it('rejects with an Error when a statement or a query fails', async () => {
    const db = await openDatabase();
    connection.execute.mockRejectedValue('error returned from database: (code: 5) database is locked');
    connection.select.mockRejectedValue('error returned from database: (code: 1) no such table: servers');

    await expect(db.execute('DELETE FROM servers')).rejects.toThrow('database is locked');
    await expect(db.select('SELECT * FROM servers')).rejects.toThrow('no such table');
  });
});

describe('toEnvironment', () => {
  it('names the platform and CPU the way Node does and describes the webview', () => {
    expect(toEnvironment(linuxEnvironment)).toEqual({
      platform: 'linux',
      arch: 'x64',
      runtime: 'tauri 2.12.4 (WebKitGTK 2.44.1)',
    });
    expect(toEnvironment({ ...linuxEnvironment, os: 'windows', webview: '141.0.3537.57' })).toEqual({
      platform: 'win32',
      arch: 'x64',
      runtime: 'tauri 2.12.4 (WebView2 141.0.3537.57)',
    });
    expect(toEnvironment({ ...linuxEnvironment, arch: 'aarch64' }).arch).toBe('arm64');
  });

  it('passes through a system it does not know', () => {
    expect(toEnvironment({ ...linuxEnvironment, os: 'freebsd', arch: 'riscv64' })).toEqual({
      platform: 'freebsd',
      arch: 'riscv64',
      runtime: 'tauri 2.12.4 (webview 2.44.1)',
    });
  });
});

// The environment is read once per page load, so each of these starts from a fresh copy of the module.
describe('the platform', () => {
  async function load(environment: AppEnvironment, localData = '/home/a/.local/share') {
    vi.resetModules();
    const core = await import('@tauri-apps/api/core');
    const path = await import('@tauri-apps/api/path');
    vi.mocked(core.invoke).mockResolvedValue(environment);
    vi.mocked(path.localDataDir).mockResolvedValue(localData);
    vi.mocked(path.sep).mockReturnValue(environment.os === 'windows' ? '\\' : '/');
    return { invoke: vi.mocked(core.invoke), platform: await import('../tauri-platform') };
  }

  it('keeps the channel data in the local data folder', async () => {
    const { platform } = await load(linuxEnvironment);

    expect(await platform.dataDir()).toBe(`/home/a/.local/share/${buildInfo.dataDirName}`);
  });

  it('uses the Windows separator for the data folder there', async () => {
    const { platform } = await load({ ...linuxEnvironment, os: 'windows' }, 'C:\\Users\\a\\AppData\\Local');

    expect(await platform.dataDir()).toBe(`C:\\Users\\a\\AppData\\Local\\${buildInfo.dataDirName}`);
  });

  it('keeps the data where GEMIREDMINE_DATA_DIR says, without adding the channel folder', async () => {
    const { platform } = await load({ ...linuxEnvironment, dataDirOverride: '/tmp/portable' });

    expect(await platform.dataDir()).toBe('/tmp/portable');
  });

  it('asks the Rust side for its environment once', async () => {
    const { invoke: invokeMock, platform } = await load(linuxEnvironment);
    const backendPlatform = platform.tauriPlatform();

    await platform.dataDir();
    await backendPlatform.dataDir();
    expect(await backendPlatform.environment()).toEqual(platform.toEnvironment(linuxEnvironment));

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('app_environment');
  });
});

describe('tauriPlatform', () => {
  it('opens links through the opener plugin', async () => {
    vi.mocked(openUrl).mockResolvedValue(undefined);

    await tauriPlatform().openUrl('https://github.com/iVegas/gemiredmine/issues/new');

    expect(openUrl).toHaveBeenCalledWith('https://github.com/iVegas/gemiredmine/issues/new');
  });

  it('is made of the Tauri fetch, file system and database', () => {
    const platform = tauriPlatform();

    expect(platform.fetch).toBe(tauriFetch);
    expect(platform.fs).toBe(tauriDataFs);
    expect(platform.database).toBe(openDatabase);
  });
});
