import { LogAggregator, type LogEvent } from './aggregator';
import { buildIssueLink, buildReport, type FeedbackEnvironment, type FeedbackInput } from './feedback';
import type { DataFs } from './fs';
import { createSerialQueue } from './serial';
import { DiagnosticsStore } from './store';

export interface DevPreviewOptions {
  /** Per-channel data directory: settings, logs and feedback reports live here */
  dataDir: string;
  /** How the files in the data directory are read and written */
  fs: DataFs;
  /** Whether this build offers the developer preview at all */
  available: boolean;
  repositoryUrl: string;
  environment: FeedbackEnvironment;
  /** How often aggregated windows are written to disk. 0 disables the timer. */
  flushIntervalMs?: number;
  now?: () => number;
}

export interface DevPreviewStatus {
  available: boolean;
  enabled: boolean;
  dataDir: string;
  logBytes: number;
  pendingEntries: number;
}

export interface FeedbackResult {
  issueUrl: string;
  reportPath: string;
  logsIncluded: 'all' | 'partial' | 'none';
}

const SETTINGS_FILE = 'settings.json';
const LOGS_DIR = 'logs';
const FEEDBACK_DIR = 'feedback';
const FEEDBACK_REPORTS_KEPT = 10;
/** How much recent history a feedback report includes */
const FEEDBACK_LOG_BYTES = 200 * 1024;

async function readEnabledSetting(fs: DataFs, settingsPath: string): Promise<boolean> {
  try {
    return JSON.parse(await fs.readText(settingsPath)).devPreviewEnabled === true;
  } catch {
    return false;
  }
}

/**
 * The developer preview: opt-in, off by default, and only constructed in builds that
 * offer it. When enabled it aggregates recent events, keeps them in rotated files, and
 * turns user feedback into a prefilled GitHub issue.
 */
export class DevPreview {
  private readonly aggregator: LogAggregator;
  private readonly store: DiagnosticsStore;
  private readonly settingsPath: string;
  private readonly flushIntervalMs: number;
  private enabled: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private readonly serial = createSerialQueue();

  /** Reads the saved opt-in. The preview starts collecting at once when it was left on. */
  static async open(options: DevPreviewOptions): Promise<DevPreview> {
    const settingsPath = options.fs.join(options.dataDir, SETTINGS_FILE);
    const enabled = options.available && (await readEnabledSetting(options.fs, settingsPath));
    return new DevPreview(options, enabled);
  }

  private constructor(
    private readonly options: DevPreviewOptions,
    enabled: boolean
  ) {
    this.aggregator = new LogAggregator(200, options.now);
    this.store = new DiagnosticsStore(options.fs, options.fs.join(options.dataDir, LOGS_DIR));
    this.settingsPath = options.fs.join(options.dataDir, SETTINGS_FILE);
    this.flushIntervalMs = options.flushIntervalMs ?? 60_000;
    this.enabled = enabled;
    if (this.enabled) this.startTimer();
  }

  async status(): Promise<DevPreviewStatus> {
    const logBytes = await this.store.totalBytes();
    return {
      available: this.options.available,
      enabled: this.enabled,
      dataDir: this.options.dataDir,
      logBytes,
      pendingEntries: this.aggregator.pending,
    };
  }

  async setEnabled(enabled: boolean): Promise<DevPreviewStatus> {
    if (!this.options.available) {
      throw new Error('The developer preview is not available in this build.');
    }

    // One change at a time, so the saved setting always matches the last request.
    return this.serial(async () => {
      if (enabled === this.enabled) return this.status();

      this.enabled = enabled;
      await this.options.fs.mkdirp(this.options.dataDir);
      await this.options.fs.writeText(this.settingsPath, JSON.stringify({ devPreviewEnabled: enabled }, null, 2));

      if (enabled) {
        this.startTimer();
      } else {
        await this.flush();
        this.stopTimer();
      }
      return this.status();
    });
  }

  record(event: LogEvent): void {
    if (this.enabled) this.aggregator.record(event);
  }

  /** Writes the current aggregation window to the log files. */
  async flush(): Promise<void> {
    const { entries, dropped } = this.aggregator.drain();
    const lines = entries.map(entry =>
      JSON.stringify({
        level: entry.level,
        scope: entry.scope,
        message: entry.message,
        count: entry.count,
        first: new Date(entry.firstSeen).toISOString(),
        last: new Date(entry.lastSeen).toISOString(),
      })
    );
    if (dropped > 0) {
      lines.push(JSON.stringify({ level: 'warn', scope: 'diagnostics', message: 'Window limit reached', count: dropped }));
    }
    await this.store.append(lines);
  }

  async createFeedback(input: FeedbackInput): Promise<FeedbackResult> {
    if (!this.enabled) {
      throw new Error('Turn on the developer preview before sending feedback.');
    }
    await this.flush();

    const logs = input.includeLogs ? await this.store.readRecent(FEEDBACK_LOG_BYTES) : '';
    const report = (text: string) => buildReport(input, this.options.environment, text);
    const reportPath = await this.saveReport(report(logs));

    const link = buildIssueLink({
      repositoryUrl: this.options.repositoryUrl,
      channel: this.options.environment.channel,
      title: input.title,
      report,
      logs,
    });
    return {
      issueUrl: link.url,
      reportPath,
      logsIncluded: input.includeLogs ? link.logsIncluded : 'none',
    };
  }

  async dispose(): Promise<void> {
    this.stopTimer();
    if (this.enabled) await this.flush();
  }

  private async saveReport(markdown: string): Promise<string> {
    const { fs } = this.options;
    const directory = fs.join(this.options.dataDir, FEEDBACK_DIR);
    await fs.mkdirp(directory);
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const path = fs.join(directory, `feedback-${stamp}.md`);
    await fs.writeText(path, markdown);

    const reports = (await fs.list(directory)).filter(name => name.startsWith('feedback-')).sort();
    for (const old of reports.slice(0, Math.max(0, reports.length - FEEDBACK_REPORTS_KEPT))) {
      await fs.remove(fs.join(directory, old));
    }
    return path;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private startTimer(): void {
    if (this.flushIntervalMs > 0 && !this.timer) {
      // A failed write is not worth stopping the app for, and there is nobody to tell.
      this.timer = setInterval(() => void this.flush().catch(() => {}), this.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
