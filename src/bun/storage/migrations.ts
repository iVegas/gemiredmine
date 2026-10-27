import type { SqlDatabase } from './database';

/** One statement, or a function for what a statement cannot say, such as `addColumn`. */
export type MigrationStep = string | ((db: SqlDatabase) => Promise<void>);

/**
 * One step of the schema. `version` counts up from 1 without gaps, and a released migration is never edited:
 * a change to the schema is a new migration.
 *
 * Every step has to be harmless when it runs twice (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
 * `addColumn`). The database has no transaction across calls, so an app that is closed in the middle of a migration
 * leaves it half done, and it starts again from its first step the next time.
 */
export interface Migration {
  version: number;
  steps: readonly MigrationStep[];
}

/** Adds a column unless the table has it already: SQLite has no `ADD COLUMN IF NOT EXISTS`. The names come from code. */
export function addColumn(table: string, column: string, definition: string): MigrationStep {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) throw new Error(`Not a table and column name: ${table}.${column}`);
  return async (db) => {
    const [row] = await db.select('SELECT COUNT(*) AS found FROM pragma_table_info(?) WHERE name = ?', [table, column]);
    if (Number(row?.found) === 0) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
}

export const MIGRATIONS: readonly Migration[] = [
  {
    // Application settings, and the Redmine servers the user has added. A server's API key is never kept here (see 2).
    version: 1,
    steps: [
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        user_id INTEGER,
        user_login TEXT,
        user_firstname TEXT,
        user_lastname TEXT
      )`,
    ],
  },
  {
    // Whether the user chose to be remembered at this server: its API key is kept in the system's credential store, not
    // here. A server that was saved before the choice existed is remembered, as the choice is by default.
    version: 2,
    steps: [addColumn('servers', 'remember', 'INTEGER NOT NULL DEFAULT 1')],
  },
  {
    // The changes that AI agents proposed, which wait for the user to approve them. The change is kept as JSON. No API
    // key is ever kept here: a proposal names the server, and the key stays with the server (see 2).
    version: 3,
    steps: [
      `CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY NOT NULL,
        server_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        change_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome TEXT,
        created_at TEXT NOT NULL
      )`,
    ],
  },
];

/** The data was written by a newer version of the app, which changed the schema in a way this one cannot read. */
export class StorageTooNewError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(
      `The saved data is from a newer version of Gemiredmine (storage version ${found}; this version understands ${supported}). ` +
        'Update the app to use it.'
    );
    this.name = 'StorageTooNewError';
  }
}

async function currentVersion(db: SqlDatabase): Promise<number> {
  const [row] = await db.select('PRAGMA user_version');
  const version = Number(row?.user_version ?? 0);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

/**
 * Brings the database up to the newest schema. The version it has reached is kept in SQLite's `user_version`,
 * and it is written after the steps of a migration, so a migration that stopped halfway is done again.
 * Refuses a database that is ahead of this app, and leaves it alone.
 */
export async function migrate(db: SqlDatabase, migrations: readonly Migration[] = MIGRATIONS): Promise<number> {
  const latest = migrations.at(-1)?.version ?? 0;
  const found = await currentVersion(db);
  if (found > latest) throw new StorageTooNewError(found, latest);

  for (const migration of migrations) {
    if (migration.version <= found) continue;
    for (const step of migration.steps) await (typeof step === 'string' ? db.execute(step) : step(db));
    // PRAGMA takes no parameters, and the version is a number that this file wrote.
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
  return latest;
}
