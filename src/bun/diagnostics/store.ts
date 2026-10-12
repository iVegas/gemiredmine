import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RotationPolicy {
  /** Size at which the current file is archived */
  maxBytesPerFile: number;
  /** Total files kept, including the current one */
  files: number;
}

export const DEFAULT_ROTATION: RotationPolicy = { maxBytesPerFile: 512 * 1024, files: 3 };

/**
 * Append-only JSON Lines files with size-based rotation. The newest data is always in
 * `diagnostics.jsonl`; older windows move to `diagnostics.1.jsonl`, `diagnostics.2.jsonl`
 * and the oldest file is deleted. Total disk use is bounded by maxBytesPerFile * files.
 */
export class DiagnosticsStore {
  constructor(
    private readonly logsDir: string,
    private readonly policy: RotationPolicy = DEFAULT_ROTATION
  ) {}

  private filePath(index: number): string {
    return join(this.logsDir, index === 0 ? 'diagnostics.jsonl' : `diagnostics.${index}.jsonl`);
  }

  private fileSize(index: number): number {
    return existsSync(this.filePath(index)) ? statSync(this.filePath(index)).size : 0;
  }

  get totalBytes(): number {
    let total = 0;
    for (let i = 0; i < this.policy.files; i++) total += this.fileSize(i);
    return total;
  }

  append(lines: string[]): void {
    if (lines.length === 0) return;
    mkdirSync(this.logsDir, { recursive: true, mode: 0o700 });

    const chunk = `${lines.join('\n')}\n`;
    if (this.fileSize(0) > 0 && this.fileSize(0) + Buffer.byteLength(chunk) > this.policy.maxBytesPerFile) {
      this.rotate();
    }
    appendFileSync(this.filePath(0), chunk, { mode: 0o600 });
  }

  private rotate(): void {
    const oldest = this.policy.files - 1;
    rmSync(this.filePath(oldest), { force: true });
    for (let i = oldest - 1; i >= 0; i--) {
      if (existsSync(this.filePath(i))) renameSync(this.filePath(i), this.filePath(i + 1));
    }
  }

  /** The newest `maxBytes` of log lines, oldest first. Cut at a line boundary. */
  readRecent(maxBytes: number): string {
    let text = '';
    for (let i = this.policy.files - 1; i >= 0; i--) {
      if (existsSync(this.filePath(i))) text += readFileSync(this.filePath(i), 'utf8');
    }
    if (Buffer.byteLength(text) <= maxBytes) return text;

    const tail = Buffer.from(text).subarray(-maxBytes).toString('utf8');
    return tail.slice(tail.indexOf('\n') + 1);
  }

  clear(): void {
    for (let i = 0; i < this.policy.files; i++) rmSync(this.filePath(i), { force: true });
  }
}
