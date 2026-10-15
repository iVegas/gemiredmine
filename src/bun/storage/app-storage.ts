import type { SavedServer, SavedServers } from '../../shared/backend';
import type { SqlDatabase, SqlRow, SqlValue } from './database';
import { migrate } from './migrations';

const ACTIVE_SERVER_KEY = 'activeServerId';

/**
 * What the app keeps between runs: its settings, and the Redmine servers the user has added. It sits on a
 * SQLite database so that the history of the conversations with the language model, which will be much larger
 * than this, can be added as tables (a new migration) without another store.
 */
export interface AppStorage {
  loadServers(): Promise<SavedServers>;
  saveServers(saved: SavedServers): Promise<void>;
  /** A setting saved with `setSetting`, or undefined when there is none. */
  getSetting<T = unknown>(key: string): Promise<T | undefined>;
  /** Saves a setting as JSON, replacing the value it had. */
  setSetting(key: string, value: unknown): Promise<void>;
}

const text = (value: SqlValue | undefined) => (typeof value === 'string' ? value : '');

function serverFrom(row: SqlRow): SavedServer {
  // Anything but an explicit 0 means remembered, which is the default.
  const server: SavedServer = { id: text(row.id), name: text(row.name), url: text(row.url), remember: row.remember !== 0 };
  if (typeof row.user_id === 'number' && typeof row.user_login === 'string') {
    server.user = {
      id: row.user_id,
      login: row.user_login,
      firstname: text(row.user_firstname),
      lastname: text(row.user_lastname),
    };
  }
  return server;
}

/**
 * Opens the storage in a database, creating or updating its tables first. Rejects when the database cannot be
 * used, in which case the app carries on without saving.
 */
export async function openAppStorage(db: SqlDatabase): Promise<AppStorage> {
  await migrate(db);

  // Saving takes several statements and the database cannot make them one transaction, so two saves must not
  // overlap. A save that fails does not stop the ones after it.
  let queue: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  async function setSettingNow(key: string, value: unknown) {
    await db.execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)]
    );
  }

  async function getSettingNow<T>(key: string): Promise<T | undefined> {
    const [row] = await db.select('SELECT value FROM settings WHERE key = ?', [key]);
    if (typeof row?.value !== 'string') return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      // A value that cannot be read is as good as none. It is replaced the next time it is saved.
      return undefined;
    }
  }

  return {
    loadServers: () =>
      inOrder(async () => {
        const rows = await db.select('SELECT * FROM servers ORDER BY position, id');
        const servers = rows.map(serverFrom);
        const stored = await getSettingNow<string>(ACTIVE_SERVER_KEY);
        const activeServerId = servers.some((server) => server.id === stored) ? (stored as string) : (servers[0]?.id ?? null);
        return { servers, activeServerId };
      }),

    saveServers: ({ servers, activeServerId }) =>
      inOrder(async () => {
        // Only these columns are written, whatever else the objects carry (the API key, for one).
        // Servers go in before the others come out, so an interrupted save loses nothing the user wanted kept.
        for (const [position, server] of servers.entries()) {
          await db.execute(
            `INSERT INTO servers (id, position, name, url, remember, user_id, user_login, user_firstname, user_lastname)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               position = excluded.position, name = excluded.name, url = excluded.url, remember = excluded.remember,
               user_id = excluded.user_id, user_login = excluded.user_login,
               user_firstname = excluded.user_firstname, user_lastname = excluded.user_lastname`,
            [
              server.id,
              position,
              server.name,
              server.url,
              server.remember === false ? 0 : 1,
              server.user?.id ?? null,
              server.user?.login ?? null,
              server.user?.firstname ?? null,
              server.user?.lastname ?? null,
            ]
          );
        }
        if (servers.length === 0) {
          await db.execute('DELETE FROM servers');
        } else {
          const marks = servers.map(() => '?').join(', ');
          await db.execute(`DELETE FROM servers WHERE id NOT IN (${marks})`, servers.map((server) => server.id));
        }
        await setSettingNow(ACTIVE_SERVER_KEY, activeServerId);
      }),

    getSetting: (key) => inOrder(() => getSettingNow(key)),

    setSetting: (key, value) => inOrder(() => setSettingNow(key, value)),
  };
}
