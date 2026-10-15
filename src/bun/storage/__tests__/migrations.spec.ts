// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlDatabase } from '../database';
import { MIGRATIONS, StorageTooNewError, migrate, type Migration } from '../migrations';
import { openNodeSqlDatabase, type NodeSqlDatabase } from './support/node-sql-database';

const opened: NodeSqlDatabase[] = [];
const open = () => {
  const db = openNodeSqlDatabase();
  opened.push(db);
  return db;
};
afterEach(() => opened.splice(0).forEach((db) => db.close()));

const version = async (db: SqlDatabase) => Number((await db.select('PRAGMA user_version'))[0].user_version);
const tables = async (db: SqlDatabase) =>
  (await db.select("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((row) => row.name);

describe('the migrations', () => {
  it('count up from 1 without gaps, each with at least one step', () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(MIGRATIONS.map((_, index) => index + 1));
    for (const migration of MIGRATIONS) expect(migration.steps.length, `migration ${migration.version}`).toBeGreaterThan(0);
  });

  it('can run twice, because a migration that was interrupted starts again', async () => {
    const db = open();
    for (const migration of MIGRATIONS) for (const step of migration.steps) await db.execute(step);

    for (const migration of MIGRATIONS) for (const step of migration.steps) await db.execute(step);
  });
});

describe('migrate', () => {
  it('creates the tables of a new database and records the version', async () => {
    const db = open();

    const reached = await migrate(db);

    expect(reached).toBe(MIGRATIONS.at(-1)!.version);
    expect(await version(db)).toBe(reached);
    expect(await tables(db)).toEqual(expect.arrayContaining(['servers', 'settings']));
  });

  it('does nothing to a database that is up to date', async () => {
    const db = open();
    await migrate(db);
    await db.execute("INSERT INTO settings (key, value) VALUES ('kept', '1')");
    const statements: string[] = [];
    const spy: SqlDatabase = { select: db.select, execute: (sql, params) => (statements.push(sql), db.execute(sql, params)) };

    await migrate(spy);

    expect(statements).toEqual([]);
    expect(await db.select('SELECT value FROM settings')).toEqual([{ value: '1' }]);
  });

  it('runs only the migrations after the recorded version', async () => {
    const db = open();
    const two: Migration[] = [
      { version: 1, steps: ['CREATE TABLE IF NOT EXISTS one (id INTEGER)'] },
      { version: 2, steps: ['CREATE TABLE IF NOT EXISTS two (id INTEGER)'] },
    ];
    await migrate(db, two.slice(0, 1));

    await migrate(db, two);

    expect(await version(db)).toBe(2);
    expect(await tables(db)).toEqual(['one', 'two']);
  });

  it('finishes a migration that stopped halfway', async () => {
    const db = open();
    const steps = MIGRATIONS[0].steps;
    // The app was closed after the first step of the first migration.
    await db.execute(steps[0]);
    expect(await version(db)).toBe(0);

    await migrate(db);

    expect(await version(db)).toBe(MIGRATIONS.at(-1)!.version);
    expect(await tables(db)).toEqual(expect.arrayContaining(['servers', 'settings']));
  });

  it('does not record a version when a step fails, so the next start tries again', async () => {
    const db = open();
    const failing: SqlDatabase = {
      select: db.select,
      execute: (sql, params) => (sql.includes('servers') ? Promise.reject(new Error('disk full')) : db.execute(sql, params)),
    };

    await expect(migrate(failing)).rejects.toThrow('disk full');

    expect(await version(db)).toBe(0);
    await migrate(db);
    expect(await version(db)).toBe(MIGRATIONS.at(-1)!.version);
  });

  it('refuses a database from a newer version of the app, and leaves it alone', async () => {
    const db = open();
    await migrate(db);
    const newer = MIGRATIONS.at(-1)!.version + 1;
    await db.execute(`PRAGMA user_version = ${newer}`);
    const statements: string[] = [];
    const spy: SqlDatabase = { select: db.select, execute: (sql, params) => (statements.push(sql), db.execute(sql, params)) };

    const failure = await migrate(spy).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StorageTooNewError);
    expect((failure as Error).message).toContain('newer version');
    expect(statements).toEqual([]);
    expect(await version(db)).toBe(newer);
  });
});
