import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import CalendarView from '../CalendarView.svelte';
import { redmineApi } from '../lib/api';
import { monthBounds, toDateKey } from '../lib/calendar';
import type { RedmineIssue, RedmineTimeEntry } from '../../bun/redmine/types';

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);
const server = { id: '1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' };
const today = new Date();
const todayKey = toDateKey(today);
const currentMonth = monthBounds(today.getFullYear(), today.getMonth());

const entries: RedmineTimeEntry[] = [
  { id: 1, spent_on: todayKey, hours: 1.5, issue: { id: 12 }, project: { id: 1, name: 'Shop' }, user: { id: 1, name: 'Ana' }, activity: { id: 9, name: 'Dev' } },
  { id: 2, spent_on: todayKey, hours: 0.5, project: { id: 2, name: 'Internal' }, user: { id: 1, name: 'Ana' }, activity: { id: 9, name: 'Dev' } },
];

const tasks: RedmineIssue[] = [
  { id: 42, subject: 'Write report', due_date: todayKey, project: { id: 1, name: 'Shop' }, tracker: { id: 1, name: 'Task' }, status: { id: 1, name: 'New' }, priority: { id: 2, name: 'Normal' } },
];

describe('CalendarView Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listTimeEntries.mockResolvedValue(entries);
    api.listOpenTasks.mockResolvedValue(tasks);
  });

  it('loads the visible month for the server and summarises logged time', async () => {
    const view = render(CalendarView, { props: { server } });

    expect(await view.findByText('2 h logged across 2 entries this month.')).toBeInTheDocument();
    expect(api.listTimeEntries).toHaveBeenCalledWith(
      { baseUrl: 'https://dev.local', apiKey: 'key' },
      currentMonth
    );
    expect(api.listOpenTasks).toHaveBeenCalledWith(
      { baseUrl: 'https://dev.local', apiKey: 'key' },
      { dueFrom: currentMonth.from, dueTo: currentMonth.to }
    );
  });

  it('shows each time entry on its day in the Logs view', async () => {
    const view = render(CalendarView, { props: { server } });

    expect(await view.findByText('#12 · 1.5 h')).toBeInTheDocument();
    expect(view.getByText('Internal · 0.5 h')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Logs' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to tasks due on each day', async () => {
    const view = render(CalendarView, { props: { server } });
    await view.findByText('#12 · 1.5 h');

    await fireEvent.click(view.getByRole('button', { name: 'Tasks' }));

    expect(view.getByText('Write report')).toBeInTheDocument();
    expect(view.getByText('1 open task due this month.')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reloads the data when moving to the next month', async () => {
    const view = render(CalendarView, { props: { server } });
    await view.findByText('#12 · 1.5 h');

    await fireEvent.click(view.getByRole('button', { name: 'Next month' }));

    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextMonth = monthBounds(next.getFullYear(), next.getMonth());
    await vi.waitFor(() =>
      expect(api.listTimeEntries).toHaveBeenLastCalledWith(
        { baseUrl: 'https://dev.local', apiKey: 'key' },
        nextMonth
      )
    );
  });

  it('shows the failure with a retry action that reloads the data', async () => {
    api.listTimeEntries.mockRejectedValueOnce(new Error('Redmine API request failed: 503 Service Unavailable'));
    const view = render(CalendarView, { props: { server } });

    expect(await view.findByRole('alert')).toHaveTextContent('Could not load data from Dev');
    await fireEvent.click(view.getByText('Try again'));

    expect(await view.findByText('#12 · 1.5 h')).toBeInTheDocument();
    expect(view.queryByRole('alert')).not.toBeInTheDocument();
  });
});
