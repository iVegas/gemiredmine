import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DataFs } from '../fs';

export interface DataFsHarness {
  fs: DataFs;
  /** An existing, empty folder to work in */
  root: string;
  /** Permission bits of a file or folder, when the system has them */
  modeOf?: (path: string) => Promise<number>;
  cleanup?: () => Promise<void> | void;
}

/**
 * What every DataFs has to do, whether it is backed by node:fs, memory, or a webview file plugin.
 * Run it from a spec file: `describeDataFsContract('my fs', async () => ({ fs, root }))`.
 */
export function describeDataFsContract(name: string, make: () => Promise<DataFsHarness> | DataFsHarness) {
  describe(`DataFs contract: ${name}`, () => {
    let harness: DataFsHarness;
    let fs: DataFs;
    let root: string;

    beforeEach(async () => {
      harness = await make();
      ({ fs, root } = harness);
    });

    afterEach(async () => {
      await harness.cleanup?.();
    });

    it('joins path parts under the root', () => {
      const path = fs.join(root, 'logs', 'diagnostics.jsonl');

      expect(path.startsWith(root)).toBe(true);
      expect(path.endsWith('diagnostics.jsonl')).toBe(true);
      expect(path).toContain('logs');
    });

    it('treats a missing file and folder as nothing, not as an error', async () => {
      const file = fs.join(root, 'missing.txt');

      expect(await fs.exists(file)).toBe(false);
      await expect(fs.remove(file)).resolves.toBeUndefined();
      expect(await fs.list(fs.join(root, 'no-such-folder'))).toEqual([]);
    });

    it('fails to read or measure a file that does not exist', async () => {
      const file = fs.join(root, 'missing.txt');

      await expect(fs.readText(file)).rejects.toThrow();
      await expect(fs.size(file)).rejects.toThrow();
    });

    it('creates folders with their parents, and creating one again is fine', async () => {
      const folder = fs.join(root, 'a', 'b', 'c');

      await fs.mkdirp(folder);
      await fs.mkdirp(folder);

      expect(await fs.exists(folder)).toBe(true);
      expect(await fs.list(fs.join(root, 'a'))).toEqual(['b']);
    });

    it('writes a file, replaces it on the next write, and appends to the end', async () => {
      const file = fs.join(root, 'settings.json');

      await fs.writeText(file, 'first');
      await fs.writeText(file, 'second');
      expect(await fs.readText(file)).toBe('second');

      await fs.writeText(file, ' and more', { append: true });
      expect(await fs.readText(file)).toBe('second and more');
    });

    it('creates a missing file when appending to it', async () => {
      const file = fs.join(root, 'new.log');

      await fs.writeText(file, 'line\n', { append: true });

      expect(await fs.readText(file)).toBe('line\n');
    });

    it('measures size in bytes, not characters', async () => {
      const file = fs.join(root, 'utf8.txt');

      await fs.writeText(file, 'é€'); // 2 + 3 bytes

      expect(await fs.size(file)).toBe(5);
      expect(await fs.readText(file)).toBe('é€');
    });

    it('moves a file and replaces the target', async () => {
      const from = fs.join(root, 'from.txt');
      const to = fs.join(root, 'to.txt');
      await fs.writeText(from, 'new');
      await fs.writeText(to, 'old');

      await fs.rename(from, to);

      expect(await fs.exists(from)).toBe(false);
      expect(await fs.readText(to)).toBe('new');
    });

    it('lists the files and folders of a folder, by name', async () => {
      await fs.mkdirp(fs.join(root, 'logs'));
      await fs.writeText(fs.join(root, 'settings.json'), '{}');
      await fs.writeText(fs.join(root, 'logs', 'diagnostics.jsonl'), 'x');

      expect((await fs.list(root)).sort()).toEqual(['logs', 'settings.json']);
      expect(await fs.list(fs.join(root, 'logs'))).toEqual(['diagnostics.jsonl']);
    });

    it('deletes a file', async () => {
      const file = fs.join(root, 'old.log');
      await fs.writeText(file, 'x');

      await fs.remove(file);

      expect(await fs.exists(file)).toBe(false);
    });

    it('keeps new folders private (0700) and new files owner-only (0600)', async (ctx) => {
      if (!harness.modeOf) return ctx.skip();
      const folder = fs.join(root, 'private');
      const file = fs.join(folder, 'secret.txt');

      await fs.mkdirp(folder);
      await fs.writeText(file, 'x');

      expect((await harness.modeOf(folder)).toString(8)).toBe('700');
      expect((await harness.modeOf(file)).toString(8)).toBe('600');
    });
  });
}
