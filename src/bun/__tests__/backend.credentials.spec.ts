// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BuildInfo } from '../../shared/build-info';
import { createBackend, type BackendOptions, type BackendPlatform, type CredentialStore } from '../backend';
import { createMemoryDataFs } from '../diagnostics/__tests__/support/memory-data-fs';
import type { FetchLike } from '../redmine/client';

const info: BuildInfo = {
  version: '1.0.0-unstable.7',
  channel: 'unstable',
  label: 'Unstable',
  appName: 'Gemiredmine-Unstable',
  productName: 'Gemiredmine Unstable',
  identifier: 'com.gemiredmine.app.unstable',
  dataDirName: 'gemiredmine-unstable',
  platform: 'linux',
  devPreviewAvailable: true,
  repositoryUrl: 'https://github.com/iVegas/gemiredmine',
  commit: 'abc1234',
  buildDate: '2026-10-12T00:00:00.000Z',
};

const access = { baseUrl: 'https://redmine.example.com', apiKey: 'stale-key' };
const failed = (status: number, statusText: string) => ({ ok: false, status, statusText }) as Response;
const ok = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) }) as Response;

/** A credential store in memory, which records what is asked of it. */
function memoryCredentials(initial: Record<string, string> = {}) {
  const kept = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store: CredentialStore = {
    get: vi.fn(async (id) => (calls.push(`get ${id}`), kept.get(id) ?? null)),
    set: vi.fn(async (id, key) => (calls.push(`set ${id}`), void kept.set(id, key))),
    remove: vi.fn(async (id) => (calls.push(`remove ${id}`), void kept.delete(id))),
  };
  return { store, kept, calls };
}

function setup(platform: Partial<BackendPlatform> = {}, options: BackendOptions = {}) {
  const fetchMock = vi.fn<FetchLike>();
  const backend = createBackend(
    {
      fetch: fetchMock,
      fs: createMemoryDataFs(),
      dataDir: async () => '/data/gemiredmine-unstable',
      openUrl: vi.fn(async () => {}),
      environment: async () => ({ platform: 'linux', arch: 'x64', runtime: 'test 1.0' }),
      ...platform,
    },
    { buildInfo: info, devPreviewAvailable: false, ...options }
  );
  return { backend, fetchMock };
}

describe('the API keys kept in the credential store', () => {
  it('keeps a key for a server, returns it, and forgets it', async () => {
    const { store, kept } = memoryCredentials();
    const { backend } = setup({ credentials: store });

    await backend.saveCredential('s1', 'key-1');
    expect(kept.get('s1')).toBe('key-1');
    expect(await backend.loadCredentials(['s1'])).toEqual({ apiKeys: { s1: 'key-1' }, problem: null });

    await backend.deleteCredential('s1');
    expect(await backend.loadCredentials(['s1'])).toEqual({ apiKeys: {}, problem: null });
  });

  it('returns the keys of the servers that have one, and leaves the others out', async () => {
    const { store } = memoryCredentials({ s1: 'key-1', s3: 'key-3' });
    const { backend } = setup({ credentials: store });

    expect(await backend.loadCredentials(['s1', 's2', 's3'])).toEqual({ apiKeys: { s1: 'key-1', s3: 'key-3' }, problem: null });
  });

  it('asks the store for one server at a time, so that a locked keyring asks the user once', async () => {
    let running = 0;
    let overlapped = false;
    const store: CredentialStore = {
      get: async () => {
        overlapped ||= ++running > 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        return 'k';
      },
      set: async () => {},
      remove: async () => {},
    };
    const { backend } = setup({ credentials: store });

    await backend.loadCredentials(['a', 'b', 'c']);

    expect(overlapped).toBe(false);
  });

  it('keeps what it read before the store failed, and says why it stopped', async () => {
    const store: CredentialStore = {
      get: vi.fn(async (id) => {
        if (id === 's2') throw new Error('The keyring is locked.');
        return `key-${id}`;
      }),
      set: async () => {},
      remove: async () => {},
    };
    const { backend } = setup({ credentials: store });

    const loaded = await backend.loadCredentials(['s1', 's2', 's3']);

    expect(loaded).toEqual({ apiKeys: { s1: 'key-s1' }, problem: 'The keyring is locked.' });
    expect(store.get).toHaveBeenCalledTimes(2);
  });

  it('says so, without failing, when the build has no credential store', async () => {
    const { backend } = setup();

    const loaded = await backend.loadCredentials(['s1']);

    expect(loaded.apiKeys).toEqual({});
    expect(loaded.problem).toContain('no credential store');
    await expect(backend.saveCredential('s1', 'k')).rejects.toThrow('no credential store');
    await expect(backend.deleteCredential('s1')).rejects.toThrow('no credential store');
  });

  it('rejects a save that the store refuses, with the reason', async () => {
    const store: CredentialStore = {
      get: async () => null,
      set: async () => {
        throw new Error('The Secret Service could not be reached.');
      },
      remove: async () => {},
    };
    const { backend } = setup({ credentials: store });

    await expect(backend.saveCredential('s1', 'k')).rejects.toThrow('Secret Service');
  });
});

describe('a server that rejects the API key', () => {
  const calls: Array<[string, (backend: ReturnType<typeof setup>['backend']) => Promise<unknown>]> = [
    ['getCurrentUser', (backend) => backend.getCurrentUser(access)],
    ['listTimeEntries', (backend) => backend.listTimeEntries(access, { from: '2026-10-01', to: '2026-10-31' })],
    ['listOpenTasks', (backend) => backend.listOpenTasks(access, { dueFrom: '2026-10-01', dueTo: '2026-10-31' })],
    ['listAssignedTasks', (backend) => backend.listAssignedTasks(access)],
  ];

  it.each(calls)('is told about it by %s, which still fails', async (_name, call) => {
    const onUnauthorized = vi.fn();
    const { backend, fetchMock } = setup({}, { onUnauthorized });
    fetchMock.mockResolvedValue(failed(401, 'Unauthorized'));

    await expect(call(backend)).rejects.toThrow('401');

    expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith(access);
  });

  it.each([403, 404, 500])('is not told about a %s, which is not about the key', async (status) => {
    const onUnauthorized = vi.fn();
    const { backend, fetchMock } = setup({}, { onUnauthorized });
    fetchMock.mockResolvedValue(failed(status, 'No'));

    await expect(backend.listAssignedTasks(access)).rejects.toThrow(String(status));

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('is not told about a wrong password at sign-in, because no key was rejected', async () => {
    const onUnauthorized = vi.fn();
    const { backend, fetchMock } = setup({}, { onUnauthorized });
    fetchMock.mockResolvedValue(failed(401, 'Unauthorized'));

    await expect(backend.signIn({ baseUrl: access.baseUrl, username: 'alice', password: 'wrong' })).rejects.toThrow();

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('reports the failure of the request even when the callback throws', async () => {
    const { backend, fetchMock } = setup({}, {
      onUnauthorized: () => {
        throw new Error('the callback broke');
      },
    });
    fetchMock.mockResolvedValue(failed(401, 'Unauthorized'));

    await expect(backend.listAssignedTasks(access)).rejects.toThrow('401');
  });

  it('is not told when the key works', async () => {
    const onUnauthorized = vi.fn();
    const { backend, fetchMock } = setup({}, { onUnauthorized });
    fetchMock.mockResolvedValue(ok({ user: { id: 1, login: 'alice', firstname: 'A', lastname: 'E' } }));

    await backend.getCurrentUser(access);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
