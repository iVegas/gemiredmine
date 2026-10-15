// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildInfo } from '../../shared/build-info';
import { createBackend, type BackendPlatform } from '../backend';
import { createMemoryDataFs } from '../diagnostics/__tests__/support/memory-data-fs';
import type { SqlDatabase } from '../storage/database';
import { openNodeSqlDatabase, type NodeSqlDatabase } from '../storage/__tests__/support/node-sql-database';

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

const saved = {
  servers: [
    { id: 's1', name: 'Work', url: 'https://redmine.example.com', remember: true, user: { id: 1, login: 'alice', firstname: 'Alice', lastname: 'Example' } },
    { id: 's2', name: 'Home', url: 'http://localhost:3000', remember: false },
  ],
  activeServerId: 's2',
};

const opened: NodeSqlDatabase[] = [];
afterEach(() => opened.splice(0).forEach((db) => db.close()));

function setup(database?: () => Promise<SqlDatabase>) {
  const files = createMemoryDataFs();
  const platform: BackendPlatform = {
    fetch: vi.fn(),
    fs: files,
    dataDir: async () => '/data/gemiredmine-unstable',
    openUrl: vi.fn(async () => {}),
    environment: async () => ({ platform: 'linux', arch: 'x64', runtime: 'test 1.0' }),
    database,
  };
  return { backend: createBackend(platform, { buildInfo: info, devPreviewAvailable: false }), files };
}

const memoryDatabase = () => {
  const db = openNodeSqlDatabase();
  opened.push(db);
  return db;
};

describe('the servers the app keeps between runs', () => {
  it('has none to begin with, then returns what was saved', async () => {
    const { backend } = setup(async () => memoryDatabase());

    expect(await backend.loadSavedServers()).toEqual({ servers: [], activeServerId: null });
    await backend.saveServers(saved);

    expect(await backend.loadSavedServers()).toEqual(saved);
  });

  it('opens the database once, however many calls start together', async () => {
    const db = memoryDatabase();
    const database = vi.fn(async () => db);
    const { backend } = setup(database);

    await Promise.all([backend.loadSavedServers(), backend.loadSavedServers(), backend.saveServers(saved)]);

    expect(database).toHaveBeenCalledTimes(1);
  });

  it('tries to open the database again after it failed', async () => {
    const database = vi.fn<() => Promise<SqlDatabase>>().mockRejectedValueOnce(new Error('unable to open database file'));
    database.mockImplementation(async () => memoryDatabase());
    const { backend } = setup(database);

    await expect(backend.loadSavedServers()).rejects.toThrow('unable to open database file');

    expect(await backend.loadSavedServers()).toEqual({ servers: [], activeServerId: null });
  });

  it('says so when the build has no storage', async () => {
    const { backend } = setup();

    await expect(backend.loadSavedServers()).rejects.toThrow('cannot save data');
    await expect(backend.saveServers(saved)).rejects.toThrow('cannot save data');
  });

  it('uses no files of the developer preview', async () => {
    const { backend, files } = setup(async () => memoryDatabase());

    await backend.saveServers(saved);

    expect(files.files.size).toBe(0);
  });
});
