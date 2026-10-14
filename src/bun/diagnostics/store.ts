import type { DataFs } from './fs';
import { createSerialQueue } from './serial';

export interface RotationPolicy {
  /** Size at which the current file is archived */
  maxBytesPerFile: number;
  /** Total files kept, including the current one */
  files: number;
}

export const DEFAULT_ROTATION: RotationPolicy = { maxBytesPerFile: 512 * 1024, files: 3 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Append-only JSON Lines files with size-based rotation. The newest data is always in
 * `diagnostics.jsonl`; older windows move to `diagnostics.1.jsonl`, `diagnostics.2.jsonl`
 * and the oldest file is deleted. Total disk use is bounded by maxBytesPerFile * files.
 *
 * Calls run one at a time, in the order they were made, so a rotation never overlaps an append.
 */
export class DiagnosticsStore {
  private readonly serial = createSerialQueue();

  constructor(
    private readonly fs: DataFs,
    private readonly logsDir: string,
    private readonly policy: RotationPolicy = DEFAULT_ROTATION
  ) {}

  private filePath(index: number): string {
    return this.fs.join(this.logsDir, index === 0 ? 'diagnostics.jsonl' : `diagnostics.${index}.jsonl`);
  }

  private async fileSize(index: number): Promise<number> {
    const path = this.filePath(index);
    return (await this.fs.exists(path)) ? this.fs.size(path) : 0;
  }

  totalBytes(): Promise<number> {
    return this.serial(async () => {
      let total = 0;
      for (let i = 0; i < this.policy.files; i++) total += await this.fileSize(i);
      return total;
    });
  }

  append(lines: string[]): Promise<void> {
    if (lines.length === 0) return Promise.resolve();

    return this.serial(async () => {
      await this.fs.mkdirp(this.logsDir);

      const chunk = `${lines.join('\n')}\n`;
      const current = await this.fileSize(0);
      if (current > 0 && current + encoder.encode(chunk).length > this.policy.maxBytesPerFile) {
        await this.rotate();
      }
      await this.fs.writeText(this.filePath(0), chunk, { append: true });
    });
  }

  private async rotate(): Promise<void> {
    const oldest = this.policy.files - 1;
    await this.fs.remove(this.filePath(oldest));
    for (let i = oldest - 1; i >= 0; i--) {
      if (await this.fs.exists(this.filePath(i))) await this.fs.rename(this.filePath(i), this.filePath(i + 1));
    }
  }

  /** The newest `maxBytes` of log lines, oldest first. Cut at a line boundary. */
  readRecent(maxBytes: number): Promise<string> {
    return this.serial(async () => {
      let text = '';
      for (let i = this.policy.files - 1; i >= 0; i--) {
        if (await this.fs.exists(this.filePath(i))) text += await this.fs.readText(this.filePath(i));
      }

      const bytes = encoder.encode(text);
      if (bytes.length <= maxBytes) return text;

      const tail = decoder.decode(bytes.subarray(-maxBytes));
      return tail.slice(tail.indexOf('\n') + 1);
    });
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      for (let i = 0; i < this.policy.files; i++) await this.fs.remove(this.filePath(i));
    });
  }
}
