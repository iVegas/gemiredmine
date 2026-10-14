/**
 * The few file operations the developer preview needs, so the same code can run on Node or Bun
 * (node:fs) and inside a webview (a file plugin). Paths are absolute. Where the system has permission
 * bits, new files are private to the user (0600) and new folders too (0700).
 */
export interface DataFs {
  join(...parts: string[]): string;
  exists(path: string): Promise<boolean>;
  /** Size in bytes. Fails when the file does not exist. */
  size(path: string): Promise<number>;
  readText(path: string): Promise<string>;
  /** Replaces the file, or adds to the end of it. Creates the file when it is missing; the folder must exist. */
  writeText(path: string, text: string, options?: { append?: boolean }): Promise<void>;
  /** Creates the folder and any missing parents. Creating one that exists is fine. */
  mkdirp(path: string): Promise<void>;
  /** Moves a file, replacing the target. */
  rename(from: string, to: string): Promise<void>;
  /** Deletes a file. A missing file is not an error. */
  remove(path: string): Promise<void>;
  /** Names of the entries in a folder. A missing folder has none. */
  list(path: string): Promise<string[]>;
}
