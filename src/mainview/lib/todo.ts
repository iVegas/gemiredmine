import type { RedmineIssue, RedmineReference } from '../../bun/redmine/types';
import { toDateKey } from './calendar';

export interface PriorityGroup {
  priority: RedmineReference;
  tasks: RedmineIssue[];
}

/** Tasks due soonest first; tasks without a due date last. */
export function compareDueDates(a: RedmineIssue, b: RedmineIssue): number {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return 0;
}

/**
 * Groups tasks by priority. Groups keep the order in which their first task appears, so a list
 * the server sorted by priority (highest first) gives the groups in that order. Within a group,
 * tasks due soonest come first.
 */
export function groupTasksByPriority(tasks: RedmineIssue[]): PriorityGroup[] {
  const groups = new Map<number, PriorityGroup>();
  for (const task of tasks) {
    let group = groups.get(task.priority.id);
    if (!group) {
      group = { priority: task.priority, tasks: [] };
      groups.set(task.priority.id, group);
    }
    group.tasks.push(task);
  }

  const ordered = [...groups.values()];
  for (const group of ordered) group.tasks.sort(compareDueDates);
  return ordered;
}

export function isOverdue(task: RedmineIssue, today: Date = new Date()): boolean {
  return Boolean(task.due_date) && task.due_date! < toDateKey(today);
}

/** Formats a YYYY-MM-DD date for display, reading it as a local date like the calendar does. */
export function formatDueDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
