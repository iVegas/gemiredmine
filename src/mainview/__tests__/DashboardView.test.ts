import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import DashboardView from '../DashboardView.svelte';
import { redmineApi } from '../lib/api';
import { monthBounds, toDateKey } from '../lib/calendar';
import { openViews, activeView, resetViews } from '../lib/views';
import type { RedmineIssue, RedmineTimeEntry } from '../../bun/redmine/types';

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
    listAssignedTasks: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);
const server = { id: '1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' };
const today = new Date();
const todayKey = toDateKey(today);
const currentMonth = monthBounds(today.getFullYear(), today.getMonth());
const monthLabel = today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const entries: RedmineTimeEntry[] = [
  { id: 1, spent_on: todayKey, hours: 3, project: { id: 1, name: 'Shop' }, user: { id: 1, name: 'Ana' }, activity: { id: 9, name: 'Dev' } },
  { id: 2, spent_on: todayKey, hours: 1.5, project: { id: 1, name: 'Shop' }, user: { id: 1, name: 'Ana' }, activity: { id: 9, name: 'Dev' } },
];

const issue = (id: number, subject: string, priority: { id: number; name: string }): RedmineIssue => ({
  id,
  subject,
  priority,
  due_date: todayKey,
  project: { id: 1, name: 'Shop' },
  tracker: { id: 1, name: 'Task' },
  status: { id: 1, name: 'New' },
});

const dueThisMonth = [issue(42, 'Write report', { id: 2, name: 'Normal' })];
const assigned = [
  issue(1, 'Hotfix', { id: 4, name: 'Urgent' }),
  issue(2, 'Review PR', { id: 3, name: 'High' }),
  issue(3, 'Plan sprint', { id: 3, name: 'High' }),
  issue(4, 'Tidy wiki', { id: 2, name: 'Normal' }),
];

describe('DashboardView Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetViews();
    api.listTimeEntries.mockResolvedValue(entries);
    api.listOpenTasks.mockResolvedValue(dueThisMonth);
    api.listAssignedTasks.mockResolvedValue(assigned);
  });

  it('shows the calendar preview as the first card', async () => {
    const view = render(DashboardView, { props: { server } });

    const cards = view.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(within(cards[1]).getByRole('heading', { name: 'To-do' })).toBeInTheDocument();
  });

  it('summarises this month in the calendar preview', async () => {
    const view = render(DashboardView, { props: { server } });

    const open = view.getByRole('button', { name: 'Calendar' });
    await vi.waitFor(() =>
      expect(open).toHaveAccessibleDescription(`4.5 h logged and 1 open task due in ${monthLabel}.`)
    );
    expect(api.listTimeEntries).toHaveBeenCalledWith({ baseUrl: 'https://dev.local', apiKey: 'key' }, currentMonth);
    expect(api.listOpenTasks).toHaveBeenCalledWith(
      { baseUrl: 'https://dev.local', apiKey: 'key' },
      { dueFrom: currentMonth.from, dueTo: currentMonth.to }
    );

    const grid = view.getByTestId('calendar-preview-grid');
    expect(grid).toHaveAttribute('aria-hidden', 'true');
    const todayCell = grid.querySelector(`[data-date="${todayKey}"]`)!;
    expect(todayCell.className).toContain('bg-blue-300');
    expect(within(todayCell as HTMLElement).getByTestId('task-due-marker')).toBeInTheDocument();
  });

  it('opens the calendar view when the calendar preview is clicked', async () => {
    const view = render(DashboardView, { props: { server } });

    await fireEvent.click(view.getByRole('button', { name: 'Calendar' }));

    expect(get(openViews)).toEqual(['dashboard', 'calendar']);
    expect(get(activeView)).toBe('calendar');
  });

  it('summarises assigned tasks by priority in the to-do preview', async () => {
    const view = render(DashboardView, { props: { server } });

    const open = view.getByRole('button', { name: 'To-do' });
    await vi.waitFor(() => expect(open).toHaveAccessibleDescription('4 open tasks assigned to you.'));

    const priorities = view.getByRole('list', { name: 'Tasks by priority' });
    expect(within(priorities).getAllByRole('listitem').map(li => li.textContent?.trim())).toEqual([
      'Urgent: 1',
      'High: 2',
      'Normal: 1',
    ]);
    const top = view.getByRole('list', { name: 'Top tasks' });
    expect(within(top).getAllByRole('listitem')).toHaveLength(3);
    expect(within(top).getByText('Hotfix')).toBeInTheDocument();
    expect(within(top).queryByText('Tidy wiki')).not.toBeInTheDocument();
  });

  it('opens the to-do view when the to-do preview is clicked', async () => {
    const view = render(DashboardView, { props: { server } });

    await fireEvent.click(view.getByRole('button', { name: 'To-do' }));

    expect(get(activeView)).toBe('todo');
  });

  it('reports a failure in the preview summary', async () => {
    api.listAssignedTasks.mockRejectedValueOnce(new Error('Redmine API request failed: 500 Internal Server Error'));
    const view = render(DashboardView, { props: { server } });

    const open = view.getByRole('button', { name: 'To-do' });
    await vi.waitFor(() =>
      expect(open).toHaveAccessibleDescription('Could not load your tasks: Redmine API request failed: 500 Internal Server Error')
    );
  });
});
