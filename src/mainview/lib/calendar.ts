import type { RedmineIssue, RedmineTimeEntry } from '../../bun/redmine/types';

/** Weeks start on Monday. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface CalendarDay {
  /** YYYY-MM-DD in local time, matching the dates Redmine returns */
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export interface DayLogSummary {
  hours: number;
  entries: RedmineTimeEntry[];
}

/** Formats a date as YYYY-MM-DD using local time, so the key matches the calendar cell. */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** First and last day of a month, both inclusive. `month` is 0-based. */
export function monthBounds(year: number, month: number): { from: string; to: string } {
  return {
    from: toDateKey(new Date(year, month, 1)),
    to: toDateKey(new Date(year, month + 1, 0)),
  };
}

/** Returns whole weeks (Monday to Sunday) covering the month, padded with days from the neighbouring months. */
export function buildMonthGrid(year: number, month: number, today: Date = new Date()): CalendarDay[][] {
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((leadingDays + daysInMonth) / 7);
  const todayKey = toDateKey(today);

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < weekCount; week++) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const date = new Date(year, month, 1 - leadingDays + week * 7 + weekday);
      const key = toDateKey(date);
      days.push({
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === month,
        isToday: key === todayKey,
      });
    }
    weeks.push(days);
  }
  return weeks;
}

export function groupLogsByDay(entries: RedmineTimeEntry[]): Record<string, DayLogSummary> {
  const byDay: Record<string, DayLogSummary> = {};
  for (const entry of entries) {
    const day = (byDay[entry.spent_on] ??= { hours: 0, entries: [] });
    day.hours += entry.hours;
    day.entries.push(entry);
  }
  return byDay;
}

export function groupTasksByDay(tasks: RedmineIssue[]): Record<string, RedmineIssue[]> {
  const byDay: Record<string, RedmineIssue[]> = {};
  for (const task of tasks) {
    if (!task.due_date) continue;
    (byDay[task.due_date] ??= []).push(task);
  }
  return byDay;
}

/** Sums hours and trims floating point noise such as 0.1 + 0.2. */
export function sumHours(entries: RedmineTimeEntry[]): number {
  const total = entries.reduce((sum, entry) => sum + entry.hours, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Hours as a person writes them: 4 decimals at most, so a value shows what was stored. Two decimals hid the difference
 * between 1.01 and 1.02, and 1:05 is 1.0833 hours.
 */
export function formatHours(hours: number): string {
  return `${Math.round(hours * 10000) / 10000} h`;
}

/**
 * Hours from what the user types: a decimal with a point or a comma ("1", "1.01", "1,01"), or hours and minutes
 * ("1:05"). Returns null when it is not a time above zero. The result keeps up to 4 decimals, the precision that
 * is stored, so that what is typed is what is logged.
 */
export function parseHours(text: string): number | null {
  const value = text.trim();
  let hours: number;
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(value);
  if (clock) {
    hours = Number(clock[1]) + Number(clock[2]) / 60;
  } else if (/^\d{1,3}(?:[.,]\d{1,4})?$/.test(value)) {
    hours = Number(value.replace(',', '.'));
  } else {
    return null;
  }
  if (!(hours > 0)) return null;
  return Math.round(hours * 10000) / 10000;
}
