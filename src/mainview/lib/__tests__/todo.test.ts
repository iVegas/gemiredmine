import { describe, it, expect } from 'vitest';
import { groupTasksByPriority, isOverdue, formatDueDate } from '../todo';
import type { RedmineIssue } from '../../../bun/redmine/types';

const urgent = { id: 4, name: 'Urgent' };
const high = { id: 3, name: 'High' };
const normal = { id: 2, name: 'Normal' };

function task(id: number, priority: { id: number; name: string }, due_date?: string | null): RedmineIssue {
  return {
    id,
    subject: `Task ${id}`,
    due_date,
    priority,
    project: { id: 1, name: 'Shop' },
    tracker: { id: 1, name: 'Task' },
    status: { id: 1, name: 'New' },
  };
}

describe('groupTasksByPriority', () => {
  it('groups tasks by priority in the order the server sorted them', () => {
    const groups = groupTasksByPriority([task(1, urgent), task(2, high), task(3, urgent), task(4, normal)]);

    expect(groups.map(group => group.priority.name)).toEqual(['Urgent', 'High', 'Normal']);
    expect(groups[0].tasks.map(t => t.id)).toEqual([1, 3]);
  });

  it('orders tasks in a group by due date, with undated tasks last', () => {
    const [group] = groupTasksByPriority([
      task(1, high, null),
      task(2, high, '2026-11-02'),
      task(3, high, '2026-10-20'),
      task(4, high),
    ]);

    expect(group.tasks.map(t => t.id)).toEqual([3, 2, 1, 4]);
  });

  it('returns no groups for no tasks', () => {
    expect(groupTasksByPriority([])).toEqual([]);
  });
});

describe('isOverdue', () => {
  const today = new Date(2026, 9, 14);

  it('is true only for due dates before today', () => {
    expect(isOverdue(task(1, high, '2026-10-13'), today)).toBe(true);
    expect(isOverdue(task(1, high, '2026-10-14'), today)).toBe(false);
    expect(isOverdue(task(1, high, '2026-10-15'), today)).toBe(false);
    expect(isOverdue(task(1, high, null), today)).toBe(false);
  });
});

describe('formatDueDate', () => {
  it('reads the date as a local date', () => {
    const expected = new Date(2026, 0, 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

    expect(formatDueDate('2026-01-01')).toBe(expected);
  });
});
