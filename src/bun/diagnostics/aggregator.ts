import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  scope: string;
  message: string;
}

export interface AggregatedEntry {
  level: LogLevel;
  scope: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_SCOPE_LENGTH = 80;

/**
 * Collapses repeated events into one entry with a count. Messages that differ only
 * in numbers (ids, durations, ports) share an entry, so a loop cannot flood the log.
 */
export class LogAggregator {
  private readonly entries = new Map<string, AggregatedEntry>();
  private dropped = 0;

  constructor(
    private readonly maxDistinctEntries = 200,
    private readonly now: () => number = Date.now
  ) {}

  record(event: LogEvent): void {
    const scope = redact(event.scope).slice(0, MAX_SCOPE_LENGTH);
    const message = redact(event.message).slice(0, MAX_MESSAGE_LENGTH);
    const key = `${event.level}|${scope}|${message.replace(/\d+/g, '#')}`;
    const timestamp = this.now();

    const existing = this.entries.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = timestamp;
      return;
    }
    if (this.entries.size >= this.maxDistinctEntries) {
      this.dropped += 1;
      return;
    }
    this.entries.set(key, { level: event.level, scope, message, count: 1, firstSeen: timestamp, lastSeen: timestamp });
  }

  /** Returns the aggregated window and starts a new one. */
  drain(): { entries: AggregatedEntry[]; dropped: number } {
    const result = { entries: [...this.entries.values()], dropped: this.dropped };
    this.entries.clear();
    this.dropped = 0;
    return result;
  }

  get pending(): number {
    return this.entries.size;
  }
}
