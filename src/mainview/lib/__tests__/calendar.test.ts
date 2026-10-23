import { describe, it, expect } from 'vitest';
import {
  buildMonthGrid,
  groupLogsByDay,
  groupTasksByDay,
  monthBounds,
  sumHours,
  formatHours,
  parseHours,
  toDateKey,
} from '../calendar';
import type { RedmineIssue, RedmineTimeEntry } from '../../../bun/redmine/types';

const entry = (id: number, spent_on: string, hours: number): RedmineTimeEntry => ({
  id,
  spent_on,
  hours,
  project: { id: 1, name: 'P' },
  user: { id: 1, name: 'U' },
  activity: { id: 1, name: 'Dev' },
});

const issue = (id: number, due_date: string | null): RedmineIssue => ({
  id,
  subject: `Issue ${id}`,
  due_date,
  project: { id: 1, name: 'P' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 1, name: 'New' },
  priority: { id: 2, name: 'Normal' },
});

describe('toDateKey', () => {
  it('formats local calendar dates as YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('monthBounds', () => {
  it('returns the first and last day of the month', () => {
    expect(monthBounds(2026, 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds(2028, 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('buildMonthGrid', () => {
  // October 2026 starts on a Thursday, so the first row starts on Monday 28 September.
  it('pads the first and last weeks to full Monday-to-Sunday rows', () => {
    const weeks = buildMonthGrid(2026, 9, new Date(2026, 0, 1));

    expect(weeks.every(week => week.length === 7)).toBe(true);
    expect(weeks[0][0].key).toBe('2026-09-28');
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][3]).toMatchObject({ key: '2026-10-01', day: 1, inMonth: true });
    expect(weeks[weeks.length - 1][6].key).toBe('2026-11-01');
  });

  it('marks today', () => {
    const weeks = buildMonthGrid(2026, 9, new Date(2026, 9, 12));
    const today = weeks.flat().filter(day => day.isToday);

    expect(today.map(day => day.key)).toEqual(['2026-10-12']);
  });

  it('uses five rows for a month that spans five weeks', () => {
    // October 2026 needs 3 leading days + 31 days = 34 cells, so 5 rows.
    expect(buildMonthGrid(2026, 9)).toHaveLength(5);
  });
});

describe('groupLogsByDay', () => {
  it('sums hours and keeps entries per day', () => {
    const grouped = groupLogsByDay([
      entry(1, '2026-10-01', 1.5),
      entry(2, '2026-10-01', 2),
      entry(3, '2026-10-02', 4),
    ]);

    expect(grouped['2026-10-01'].hours).toBe(3.5);
    expect(grouped['2026-10-01'].entries.map(e => e.id)).toEqual([1, 2]);
    expect(grouped['2026-10-02'].hours).toBe(4);
  });
});

describe('groupTasksByDay', () => {
  it('places tasks on their due date and skips tasks without one', () => {
    const grouped = groupTasksByDay([issue(1, '2026-10-05'), issue(2, null), issue(3, '2026-10-05')]);

    expect(Object.keys(grouped)).toEqual(['2026-10-05']);
    expect(grouped['2026-10-05'].map(i => i.id)).toEqual([1, 3]);
  });
});

describe('hours formatting', () => {
  it('trims floating point noise when summing', () => {
    expect(sumHours([entry(1, '2026-10-01', 0.1), entry(2, '2026-10-01', 0.2)])).toBe(0.3);
  });

  it('formats hours with a unit', () => {
    expect(formatHours(1.5)).toBe('1.5 h');
    expect(formatHours(2)).toBe('2 h');
    expect(formatHours(1.01)).toBe('1.01 h');
    expect(formatHours(1 + 1 / 60)).toBe('1.0167 h');
  });
});

describe('parseHours', () => {
  it.each([
    ['1', 1],
    ['1.00', 1],
    ['1.01', 1.01],
    ['1,01', 1.01],
    ['0,25', 0.25],
    ['1:30', 1.5],
    ['1:01', 1.0167],
    [' 2 ', 2],
  ])('reads %s as %s hours', (text, hours) => {
    expect(parseHours(text)).toBe(hours);
  });

  it.each(['', '0', '0.00', '0:00', '-1', '1h', '1h30', '1.5.2', 'abc', '1:60', '1:5', '1000.5'])('refuses %s', text => {
    expect(parseHours(text)).toBeNull();
  });
});
