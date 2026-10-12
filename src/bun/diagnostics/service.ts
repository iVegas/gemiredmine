import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LogAggregator, type LogEvent } from './aggregator';
import { buildIssueLink, buildReport, type FeedbackEnvironment, type FeedbackInput } from './feedback';
import { DiagnosticsStore } from './store';

export interface DevPreviewOptions {
  /** Per-channel data directory: settings, logs and feedback reports live here */
  dataDir: string;
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

function readEnabledSetting(settingsPath: string): boolean {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')).devPreviewEnabled === true;
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

  constructor(private readonly options: DevPreviewOptions) {
    this.aggregator = new LogAggregator(200, options.now);
    this.store = new DiagnosticsStore(join(options.dataDir, LOGS_DIR));
    this.settingsPath = join(options.dataDir, SETTINGS_FILE);
    this.flushIntervalMs = options.flushIntervalMs ?? 60_000;
    this.enabled = options.available && readEnabledSetting(this.settingsPath);
    if (this.enabled) this.startTimer();
  }

  status(): DevPreviewStatus {
    return {
      available: this.options.available,
      enabled: this.enabled,
      dataDir: this.options.dataDir,
      logBytes: this.store.totalBytes,
      pendingEntries: this.aggregator.pending,
    };
  }

  setEnabled(enabled: boolean): DevPreviewStatus {
    if (!this.options.available) {
      throw new Error('The developer preview is not available in this build.');
    }
    if (enabled === this.enabled) return this.status();

    this.enabled = enabled;
    mkdirSync(this.options.dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(this.settingsPath, JSON.stringify({ devPreviewEnabled: enabled }, null, 2), { mode: 0o600 });

    if (enabled) {
      this.startTimer();
    } else {
      this.flush();
      this.stopTimer();
    }
    return this.status();
  }

  record(event: LogEvent): void {
    if (this.enabled) this.aggregator.record(event);
  }

  /** Writes the current aggregation window to the log files. */
  flush(): void {
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
    this.store.append(lines);
  }

  createFeedback(input: FeedbackInput): FeedbackResult {
    if (!this.enabled) {
      throw new Error('Turn on the developer preview before sending feedback.');
    }
    this.flush();

    const logs = input.includeLogs ? this.store.readRecent(FEEDBACK_LOG_BYTES) : '';
    const report = (text: string) => buildReport(input, this.options.environment, text);
    const reportPath = this.saveReport(report(logs));

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

  dispose(): void {
    this.stopTimer();
    if (this.enabled) this.flush();
  }

  private saveReport(markdown: string): string {
    const directory = join(this.options.dataDir, FEEDBACK_DIR);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const path = join(directory, `feedback-${stamp}.md`);
    writeFileSync(path, markdown, { mode: 0o600 });

    const reports = readdirSync(directory).filter(name => name.startsWith('feedback-')).sort();
    for (const old of reports.slice(0, Math.max(0, reports.length - FEEDBACK_REPORTS_KEPT))) {
      rmSync(join(directory, old), { force: true });
    }
    return path;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private startTimer(): void {
    if (this.flushIntervalMs > 0 && !this.timer) {
      this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
