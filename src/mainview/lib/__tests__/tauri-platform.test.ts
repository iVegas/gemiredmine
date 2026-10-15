import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sep } from '@tauri-apps/api/path';
import { fetch as pluginFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { buildInfo } from '../../../shared/build-info.generated';
import { describeDataFsContract } from '../../../bun/diagnostics/__tests__/data-fs.contract';
import { resetFakePluginFs, type FakePluginFs } from './support/fake-plugin-fs';
import { dataDir, tauriDataFs, tauriFetch, tauriPlatform, toEnvironment, type AppEnvironment } from '../tauri-platform';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ localDataDir: vi.fn(), sep: vi.fn(() => '/') }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
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

  it('is made of the Tauri fetch and file system', () => {
    const platform = tauriPlatform();

    expect(platform.fetch).toBe(tauriFetch);
    expect(platform.fs).toBe(tauriDataFs);
  });
});
