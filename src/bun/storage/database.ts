/** A value that can be bound to a statement or read from a row. */
export type SqlValue = string | number | null;

export type SqlRow = Record<string, SqlValue>;

/**
 * The two SQL operations the app's storage needs, so the same code can run on the Tauri SQL plugin inside
 * the webview and on node:sqlite in the tests.
 *
 * Two things about the database behind it are easy to forget:
 * - Every number is bound as a floating point number. A column that holds whole numbers must be declared
 *   INTEGER, and then SQLite stores them as such. Do not bind booleans; use 0 and 1.
 * - The plugin works through a pool of connections, so statements of different calls may run on different
 *   connections, and there is no transaction across calls. A change that has to be all or nothing must be
 *   a single statement.
 */
export interface SqlDatabase {
  /** Runs one statement. */
  execute(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Runs a query and returns its rows, each by column name. */
  select(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
}
