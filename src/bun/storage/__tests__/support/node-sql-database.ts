import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlRow, SqlValue } from '../../database';

/** SQLite in memory, or in a file, through node:sqlite. Like the Tauri SQL plugin, it binds every number as a float. */
export interface NodeSqlDatabase extends SqlDatabase {
  close(): void;
}

export function openNodeSqlDatabase(path = ':memory:'): NodeSqlDatabase {
  const database = new DatabaseSync(path);
  let closed = false;
  return {
    async execute(sql: string, params: readonly SqlValue[] = []) {
      database.prepare(sql).run(...params);
    },
    async select(sql: string, params: readonly SqlValue[] = []) {
      // The rows have no prototype, which would make equality checks in the tests needlessly strict.
      return database.prepare(sql).all(...params).map((row) => ({ ...row }) as SqlRow);
    },
    close() {
      if (!closed) database.close();
      closed = true;
    },
  };
}
