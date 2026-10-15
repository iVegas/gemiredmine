import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { SavedServers } from '../../../shared/backend';

vi.mock('../api', () => ({ redmineApi: { loadSavedServers: vi.fn(), saveServers: vi.fn() } }));
vi.mock('../bridge', () => ({ hasDesktopBackend: vi.fn() }));

import { redmineApi } from '../api';
import { hasDesktopBackend } from '../bridge';
import { serversRestored, startPersistence, storageProblem, toSavedServers } from '../persistence';
import { activeServerId, addServer, removeServer, servers, updateServer, type ServerConnection } from '../store';

const api = vi.mocked(redmineApi);
const user = { id: 17, login: 'alice', firstname: 'Alice', lastname: 'Example' };
const saved: SavedServers = {
  servers: [
    { id: 'a1', name: 'Work', url: 'https://redmine.example.com', user },
    { id: 'b2', name: 'Home', url: 'http://localhost:3000' },
  ],
  activeServerId: 'b2',
};

/** Lets the promise callbacks and the microtask that gathers changes run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

let stop: () => void = () => {};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hasDesktopBackend).mockReturnValue(true);
  api.loadSavedServers.mockResolvedValue({ servers: [], activeServerId: null });
  api.saveServers.mockResolvedValue(undefined);
  servers.set([]);
  activeServerId.set(null);
  serversRestored.set(true);
  storageProblem.set(null);
});

afterEach(() => stop());

describe('toSavedServers', () => {
  it('keeps the name, the address and the user, and never the API key', () => {
    const list: ServerConnection[] = [{ id: 'a1', name: 'Work', url: 'https://r', apiToken: 'sekret', user }];

    const result = toSavedServers(list, 'a1');

    expect(result).toEqual({ servers: [{ id: 'a1', name: 'Work', url: 'https://r', user }], activeServerId: 'a1' });
    expect(JSON.stringify(result)).not.toContain('sekret');
  });

  it('leaves out the user of a server nobody signed in to', () => {
    expect(toSavedServers([{ id: 'a1', name: 'Work', url: 'https://r' }], null).servers[0]).toEqual({ id: 'a1', name: 'Work', url: 'https://r' });
  });
});

describe('outside the desktop app', () => {
  it('neither loads nor saves anything, and does not hold the app back', async () => {
    vi.mocked(hasDesktopBackend).mockReturnValue(false);

    stop = startPersistence();
    addServer({ name: 'Dev', url: 'https://dev.local' });
    await settle();

    expect(get(serversRestored)).toBe(true);
    expect(api.loadSavedServers).not.toHaveBeenCalled();
    expect(api.saveServers).not.toHaveBeenCalled();
  });
});

describe('restoring the saved servers', () => {
  it('holds the app back until the servers are loaded, then shows them with the active one', async () => {
    const loading = deferred<SavedServers>();
    api.loadSavedServers.mockReturnValue(loading.promise);

    stop = startPersistence();
    expect(get(serversRestored)).toBe(false);
    expect(get(servers)).toEqual([]);

    loading.resolve(saved);
    await settle();

    expect(get(serversRestored)).toBe(true);
    expect(get(servers)).toEqual(saved.servers);
    expect(get(activeServerId)).toBe('b2');
  });

  it('brings back servers that are signed out, with the user who last signed in', async () => {
    api.loadSavedServers.mockResolvedValue(saved);

    stop = startPersistence();
    await settle();

    expect(get(servers).every((server) => server.apiToken === undefined)).toBe(true);
    expect(get(servers)[0].user).toEqual(user);
  });

  it('does not save what it has just loaded', async () => {
    api.loadSavedServers.mockResolvedValue(saved);

    stop = startPersistence();
    await settle();

    expect(api.saveServers).not.toHaveBeenCalled();
  });

  it('does not touch the stores once it has been stopped', async () => {
    const loading = deferred<SavedServers>();
    api.loadSavedServers.mockReturnValue(loading.promise);
    stop = startPersistence();

    stop();
    loading.resolve(saved);
    await settle();

    expect(get(servers)).toEqual([]);
    expect(get(serversRestored)).toBe(false);
  });

  it('carries on without saving when the saved servers cannot be loaded, so that they are not erased', async () => {
    api.loadSavedServers.mockRejectedValue(new Error('The saved data is from a newer version of Gemiredmine.'));

    stop = startPersistence();
    await settle();
    addServer({ name: 'Dev', url: 'https://dev.local' });
    await settle();

    expect(get(serversRestored)).toBe(true);
    expect(get(storageProblem)).toContain('could not be loaded');
    expect(get(storageProblem)).toContain('newer version');
    expect(api.saveServers).not.toHaveBeenCalled();
  });
});

describe('saving the changes', () => {
  beforeEach(async () => {
    api.loadSavedServers.mockResolvedValue(saved);
    stop = startPersistence();
    await settle();
  });

  it('saves a server that is added, without its API key', async () => {
    const id = addServer({ name: 'Dev', url: 'https://dev.local', apiToken: 'sekret-key', user });
    await settle();

    expect(api.saveServers).toHaveBeenCalledExactlyOnceWith({
      servers: [...saved.servers, { id, name: 'Dev', url: 'https://dev.local', user }],
      activeServerId: 'b2',
    });
    expect(JSON.stringify(api.saveServers.mock.calls)).not.toContain('sekret-key');
  });

  it('saves a server that is removed, and the active server that takes its place', async () => {
    removeServer('b2');
    await settle();

    expect(api.saveServers).toHaveBeenCalledExactlyOnceWith({ servers: [saved.servers[0]], activeServerId: 'a1' });
  });

  it('saves the active server when it is switched', async () => {
    activeServerId.set('a1');
    await settle();

    expect(api.saveServers).toHaveBeenCalledExactlyOnceWith({ servers: saved.servers, activeServerId: 'a1' });
  });

  it('does not save when signing in only gives a server its API key', async () => {
    updateServer('b2', { apiToken: 'sekret-key' });
    await settle();

    expect(api.saveServers).not.toHaveBeenCalled();
  });

  it('saves who signed in, and forgets them when the user signs out', async () => {
    updateServer('b2', { apiToken: 'k', user });
    await settle();
    updateServer('b2', { apiToken: undefined, user: undefined });
    await settle();

    expect(api.saveServers).toHaveBeenCalledTimes(2);
    expect(api.saveServers.mock.calls[0][0].servers[1].user).toEqual(user);
    expect(api.saveServers.mock.calls[1][0].servers[1]).toEqual({ id: 'b2', name: 'Home', url: 'http://localhost:3000' });
  });

  it('saves once for changes that happen together', async () => {
    servers.update((list) => [...list, { id: 'c3', name: 'Third', url: 'https://third.example' }]);
    activeServerId.set('c3');
    await settle();

    expect(api.saveServers).toHaveBeenCalledTimes(1);
    expect(api.saveServers.mock.calls[0][0].activeServerId).toBe('c3');
  });

  it('saves one at a time, and the newest state last', async () => {
    const first = deferred();
    api.saveServers.mockReturnValueOnce(first.promise);

    activeServerId.set('a1');
    await settle();
    activeServerId.set('b2');
    activeServerId.set('a1');
    removeServer('b2');
    await settle();
    expect(api.saveServers).toHaveBeenCalledTimes(1);

    first.resolve();
    await settle();

    expect(api.saveServers).toHaveBeenCalledTimes(2);
    expect(api.saveServers.mock.calls[1][0]).toEqual({ servers: [saved.servers[0]], activeServerId: 'a1' });
  });

  it('saves a state that comes back to the saved one while an older save is still running', async () => {
    const first = deferred();
    api.saveServers.mockReturnValueOnce(first.promise);

    activeServerId.set('a1');
    await settle();
    activeServerId.set('b2');
    await settle();
    first.resolve();
    await settle();

    expect(api.saveServers).toHaveBeenCalledTimes(2);
    expect(api.saveServers.mock.calls[1][0].activeServerId).toBe('b2');
  });

  it('says so when a save fails, and says nothing more once a later save works', async () => {
    api.saveServers.mockRejectedValueOnce(new Error('database is locked'));

    activeServerId.set('a1');
    await settle();
    expect(get(storageProblem)).toContain('could not be saved');
    expect(get(storageProblem)).toContain('database is locked');

    activeServerId.set('b2');
    await settle();

    expect(get(storageProblem)).toBeNull();
    expect(api.saveServers).toHaveBeenCalledTimes(2);
  });

  it('tries again with the next change, even one that leaves what is saved the same', async () => {
    api.saveServers.mockRejectedValueOnce(new Error('disk full'));
    const id = addServer({ name: 'Dev', url: 'https://dev.local' });
    await settle();
    expect(api.saveServers).toHaveBeenCalledTimes(1);

    // Signing in changes the API key only, which is not saved. The server was never saved, so it is tried again.
    updateServer(id, { apiToken: 'key' });
    await settle();

    expect(api.saveServers).toHaveBeenCalledTimes(2);
    expect(api.saveServers.mock.calls[1][0]).toEqual(api.saveServers.mock.calls[0][0]);
    expect(get(storageProblem)).toBeNull();
  });

  it('stops saving when it is stopped', async () => {
    stop();

    activeServerId.set('a1');
    await settle();

    expect(api.saveServers).not.toHaveBeenCalled();
  });
});
