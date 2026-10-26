// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SavedServer } from '../../../shared/backend';
import { KEPT_DECIDED_PROPOSALS, openAppStorage } from '../app-storage';
import type { SqlDatabase } from '../database';
import { MIGRATIONS, StorageTooNewError } from '../migrations';
import { openNodeSqlDatabase, type NodeSqlDatabase } from './support/node-sql-database';

const opened: NodeSqlDatabase[] = [];
const folders: string[] = [];
const open = (path?: string) => {
  const db = openNodeSqlDatabase(path);
  opened.push(db);
  return db;
};
afterEach(() => {
  opened.splice(0).forEach((db) => db.close());
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});

const alice: SavedServer = {
  id: 'a1',
  name: 'Work',
  url: 'https://redmine.example.com',
  remember: true,
  user: { id: 17, login: 'alice', firstname: 'Alice', lastname: 'Example' },
};
const bob: SavedServer = { id: 'b2', name: 'Home', url: 'http://localhost:3000', remember: false };

describe('AppStorage servers', () => {
  it('starts with no servers', async () => {
    const storage = await openAppStorage(open());

    expect(await storage.loadServers()).toEqual({ servers: [], activeServerId: null });
  });

  it('returns the servers in their order, with the user who signed in and the active server', async () => {
    const storage = await openAppStorage(open());

    await storage.saveServers({ servers: [bob, alice], activeServerId: 'a1' });

    expect(await storage.loadServers()).toEqual({ servers: [bob, alice], activeServerId: 'a1' });
  });

  it('keeps whether the user chose to be remembered, for each server', async () => {
    const storage = await openAppStorage(open());

    await storage.saveServers({ servers: [alice, bob], activeServerId: 'a1' });
    expect((await storage.loadServers()).servers.map((server) => server.remember)).toEqual([true, false]);

    await storage.saveServers({ servers: [{ ...alice, remember: false }, { ...bob, remember: true }], activeServerId: 'a1' });
    expect((await storage.loadServers()).servers.map((server) => server.remember)).toEqual([false, true]);
  });

  it('gives the user id back as a number, although the database is given floating point numbers', async () => {
    const storage = await openAppStorage(open());

    await storage.saveServers({ servers: [alice], activeServerId: 'a1' });

    const [server] = (await storage.loadServers()).servers;
    expect(server.user?.id).toBe(17);
    expect(Number.isInteger(server.user?.id)).toBe(true);
  });

  it('changes a server in place, keeping one row per server', async () => {
    const db = open();
    const storage = await openAppStorage(db);
    await storage.saveServers({ servers: [alice, bob], activeServerId: 'a1' });

    await storage.saveServers({ servers: [bob, { ...alice, name: 'Office', user: undefined }], activeServerId: 'b2' });

    expect(await storage.loadServers()).toEqual({
      servers: [bob, { id: 'a1', name: 'Office', url: alice.url, remember: true }],
      activeServerId: 'b2',
    });
    expect(await db.select('SELECT id FROM servers')).toHaveLength(2);
  });

  it('forgets the servers that are not in the list any more, down to none', async () => {
    const storage = await openAppStorage(open());
    await storage.saveServers({ servers: [alice, bob], activeServerId: 'a1' });

    await storage.saveServers({ servers: [bob], activeServerId: 'b2' });
    expect((await storage.loadServers()).servers).toEqual([bob]);

    await storage.saveServers({ servers: [], activeServerId: null });
    expect(await storage.loadServers()).toEqual({ servers: [], activeServerId: null });
  });

  it('makes the first server active when the saved active server is gone', async () => {
    const storage = await openAppStorage(open());
    await storage.saveServers({ servers: [alice, bob], activeServerId: 'b2' });
    await storage.saveServers({ servers: [alice], activeServerId: 'b2' });

    expect((await storage.loadServers()).activeServerId).toBe('a1');
  });

  it('keeps names and addresses exactly, whatever characters they have', async () => {
    const storage = await openAppStorage(open());
    const odd: SavedServer = { id: "x'; DROP TABLE servers; --", name: `O'Brien "Redmine" \\ ünï 日本語`, url: 'https://r.example/?a=1&b=%20', remember: true };

    await storage.saveServers({ servers: [odd], activeServerId: odd.id });

    expect(await storage.loadServers()).toEqual({ servers: [odd], activeServerId: odd.id });
  });

  it('is still there when the database is opened again', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'gemi-storage-'));
    folders.push(folder);
    const file = join(folder, 'gemiredmine.db');
    const first = open(file);
    await (await openAppStorage(first)).saveServers({ servers: [alice, bob], activeServerId: 'b2' });
    first.close();

    const storage = await openAppStorage(open(file));

    expect(await storage.loadServers()).toEqual({ servers: [alice, bob], activeServerId: 'b2' });
  });

  it('never writes an API key, even when it is handed over with the server', async () => {
    const db = open();
    const storage = await openAppStorage(db);
    const withKey = { ...alice, apiToken: 'sekret-api-key-0123456789' } as SavedServer;

    await storage.saveServers({ servers: [withKey], activeServerId: 'a1' });
    await storage.setSetting('theme', 'dark');

    const everything = JSON.stringify(
      await Promise.all(['servers', 'settings'].map((table) => db.select(`SELECT * FROM ${table}`)))
    );
    expect(everything).not.toContain('sekret');
    expect(everything).not.toContain('apiToken');
    expect(await storage.loadServers()).toEqual({ servers: [alice], activeServerId: 'a1' });
  });

  it('keeps the last of several saves that are started without waiting for each other', async () => {
    const storage = await openAppStorage(open());

    const saves = [
      storage.saveServers({ servers: [alice], activeServerId: 'a1' }),
      storage.saveServers({ servers: [alice, bob], activeServerId: 'b2' }),
      storage.saveServers({ servers: [bob], activeServerId: 'b2' }),
    ];
    await Promise.all(saves);

    expect(await storage.loadServers()).toEqual({ servers: [bob], activeServerId: 'b2' });
  });

  it('saves again after a save failed', async () => {
    const db = open();
    let failNext = false;
    const flaky: SqlDatabase = {
      select: db.select,
      execute: (sql, params) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('database is locked'));
        }
        return db.execute(sql, params);
      },
    };
    const storage = await openAppStorage(flaky);
    failNext = true;

    await expect(storage.saveServers({ servers: [alice], activeServerId: 'a1' })).rejects.toThrow('locked');
    await storage.saveServers({ servers: [bob], activeServerId: 'b2' });

    expect(await storage.loadServers()).toEqual({ servers: [bob], activeServerId: 'b2' });
  });
});

describe('AppStorage settings', () => {
  it('has no value for a setting that was never saved', async () => {
    const storage = await openAppStorage(open());

    expect(await storage.getSetting('missing')).toBeUndefined();
  });

  it.each([['text', 'dark'], ['a number', 3], ['false', false], ['null', null], ['an object', { model: 'gemini', temperature: 0.2, tags: ['a', 'b'] }]])(
    'keeps %s as it was saved',
    async (_what, value) => {
      const storage = await openAppStorage(open());

      await storage.setSetting('key', value);

      expect(await storage.getSetting('key')).toEqual(value);
    }
  );

  it('replaces the value of a setting', async () => {
    const db = open();
    const storage = await openAppStorage(db);
    await storage.setSetting('theme', 'dark');

    await storage.setSetting('theme', 'light');

    expect(await storage.getSetting('theme')).toBe('light');
    expect(await db.select("SELECT key FROM settings WHERE key = 'theme'")).toHaveLength(1);
  });

  it('treats a value that cannot be read as no value', async () => {
    const db = open();
    const storage = await openAppStorage(db);
    await db.execute("INSERT INTO settings (key, value) VALUES ('broken', '{not json')");

    expect(await storage.getSetting('broken')).toBeUndefined();
  });
});

describe('openAppStorage', () => {
  it('refuses data from a newer version of the app', async () => {
    const db = open();
    await openAppStorage(db);
    await db.execute(`PRAGMA user_version = ${MIGRATIONS.at(-1)!.version + 1}`);

    await expect(openAppStorage(db)).rejects.toBeInstanceOf(StorageTooNewError);
  });
});

describe('AppStorage proposed changes', () => {
  const change = { kind: 'log_time' as const, taskId: 7, spentOn: '2026-10-20', hours: 1.5, activityId: 9, comments: 'Reproduced' };
  const proposal = (id: string, createdAt: string, status: 'waiting' | 'done' = 'waiting') => ({
    id,
    serverId: 'a1',
    serverName: 'Work',
    change,
    summary: `Log 1.5 h on task #7 (${id})`,
    status,
    outcome: status === 'done' ? 'Logged 1.5 h on task #7.' : null,
    createdAt,
  });

  it('starts with none, and returns what was kept, the newest first', async () => {
    const storage = await openAppStorage(open());
    expect(await storage.listProposals()).toEqual([]);

    await storage.saveProposal(proposal('old', '2026-10-20T08:00:00Z'));
    await storage.saveProposal(proposal('new', '2026-10-21T08:00:00Z'));

    expect((await storage.listProposals()).map((item) => item.id)).toEqual(['new', 'old']);
    expect((await storage.listProposals())[0]).toEqual(proposal('new', '2026-10-21T08:00:00Z'));
  });

  it('replaces a change with its new status, and keeps its outcome', async () => {
    const storage = await openAppStorage(open());
    await storage.saveProposal(proposal('one', '2026-10-20T08:00:00Z'));

    await storage.saveProposal(proposal('one', '2026-10-20T08:00:00Z', 'done'));

    const [kept] = await storage.listProposals();
    expect(kept).toMatchObject({ id: 'one', status: 'done', outcome: 'Logged 1.5 h on task #7.' });
    expect(await storage.listProposals()).toHaveLength(1);
  });

  it('keeps the changes that still wait, and forgets the oldest decided ones beyond the limit', async () => {
    const storage = await openAppStorage(open());
    await storage.saveProposal(proposal('still-waiting', '2026-01-01T00:00:00Z'));
    for (let index = 0; index < KEPT_DECIDED_PROPOSALS + 5; index += 1) {
      const at = new Date(Date.UTC(2026, 0, 2) + index * 60_000).toISOString();
      await storage.saveProposal(proposal(`decided-${index}`, at, 'done'));
    }

    const ids = (await storage.listProposals()).map((item) => item.id);

    expect(ids).toContain('still-waiting');
    expect(ids.filter((id) => id.startsWith('decided-'))).toHaveLength(KEPT_DECIDED_PROPOSALS);
    expect(ids).not.toContain('decided-0');
    expect(ids).toContain(`decided-${KEPT_DECIDED_PROPOSALS + 4}`);
  });

  it('refuses a change without an id, or with a status that does not exist', async () => {
    const storage = await openAppStorage(open());

    await expect(storage.saveProposal({ ...proposal('', '2026-10-20T08:00:00Z') })).rejects.toThrow('an id of 1 to 64 characters');
    await expect(storage.saveProposal({ ...proposal('x', '2026-10-20T08:00:00Z'), status: 'gone' as never })).rejects.toThrow(
      'There is no status gone.'
    );
  });

  it('skips a stored change that the app cannot read, rather than showing it wrongly', async () => {
    const db = open();
    const storage = await openAppStorage(db);
    await storage.saveProposal(proposal('good', '2026-10-20T08:00:00Z'));
    await db.execute(
      `INSERT INTO proposals (id, server_id, server_name, change_json, summary, status, outcome, created_at)
       VALUES ('broken', 'a1', 'Work', '{"kind":"delete_everything"}', 'x', 'waiting', NULL, '2026-10-21T08:00:00Z')`
    );

    expect((await storage.listProposals()).map((item) => item.id)).toEqual(['good']);
  });
});
