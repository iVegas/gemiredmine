import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/svelte';
import TodoView from '../TodoView.svelte';
import { redmineApi } from '../lib/api';
import { toDateKey } from '../lib/calendar';
import { get } from 'svelte/store';
import { activeView, openViews, resetViews } from '../lib/views';
import type { RedmineIssue } from '../../bun/redmine/types';

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
const yesterday = toDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

const issue = (id: number, subject: string, priority: { id: number; name: string }, extra: Partial<RedmineIssue> = {}): RedmineIssue => ({
  id,
  subject,
  priority,
  project: { id: 1, name: 'Shop' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 1, name: 'New' },
  ...extra,
});

// The server returns tasks sorted by priority, highest first.
const tasks: RedmineIssue[] = [
  issue(10, 'Payment fails', { id: 4, name: 'Urgent' }, { due_date: yesterday }),
  issue(11, 'Slow search', { id: 3, name: 'High' }, { done_ratio: 40 }),
  issue(12, 'Fix typo', { id: 2, name: 'Normal' }, { project: { id: 2, name: 'Docs' } }),
  issue(13, 'Update footer', { id: 2, name: 'Normal' }),
];

describe('TodoView Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listAssignedTasks.mockResolvedValue(tasks);
    resetViews();
  });

  it('loads every task assigned to the user on the server', async () => {
    const view = render(TodoView, { props: { server } });

    expect(await view.findByText('4 open tasks assigned to you across all projects, by priority.')).toBeInTheDocument();
    expect(api.listAssignedTasks).toHaveBeenCalledWith({ baseUrl: 'https://dev.local', apiKey: 'key' }, { projectId: undefined });
  });

  it('lists only the tasks of the project it is given', async () => {
    api.listAssignedTasks.mockResolvedValueOnce([tasks[2]]);
    const view = render(TodoView, { props: { server, project: { id: 2, name: 'Docs' } } });

    expect(await view.findByText('1 open task assigned to you in Docs, by priority.')).toBeInTheDocument();
    expect(api.listAssignedTasks).toHaveBeenCalledWith({ baseUrl: 'https://dev.local', apiKey: 'key' }, { projectId: 2 });
  });

  it('groups the tasks by priority, highest first', async () => {
    const view = render(TodoView, { props: { server } });
    await view.findByText('Payment fails');

    const headings = view.getAllByRole('heading', { level: 3 });
    expect(headings.map(h => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Urgent 1 task',
      'High 1 task',
      'Normal 2 tasks',
    ]);

    const normal = view.getByRole('region', { name: /Normal/ });
    expect(within(normal).getByText('Fix typo')).toBeInTheDocument();
    expect(within(normal).getByText('Update footer')).toBeInTheDocument();
    expect(within(normal).getByText('Docs · Bug · New')).toBeInTheDocument();
  });

  it('shows due dates, overdue tasks and progress', async () => {
    const view = render(TodoView, { props: { server } });
    await view.findByText('Payment fails');

    const urgent = view.getByRole('region', { name: /Urgent/ });
    expect(urgent.querySelector('time')).toHaveAttribute('datetime', yesterday);
    expect(within(urgent).getByText('(overdue)')).toBeInTheDocument();
    expect(view.getByText('40% done')).toBeInTheDocument();
    expect(view.getAllByText('No due date')).toHaveLength(3);
  });

  it('says when nothing is assigned', async () => {
    api.listAssignedTasks.mockResolvedValue([]);
    const view = render(TodoView, { props: { server } });

    expect(await view.findByText('No open tasks are assigned to you.')).toBeInTheDocument();
  });

  it('shows the failure with a retry action', async () => {
    api.listAssignedTasks.mockRejectedValueOnce(new Error('Redmine API request failed: 503 Service Unavailable'));
    const view = render(TodoView, { props: { server } });

    expect(await view.findByRole('alert')).toHaveTextContent('Could not load tasks from Dev');
    await fireEvent.click(view.getByText('Try again'));

    expect(await view.findByText('Payment fails')).toBeInTheDocument();
    expect(view.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reloads on Refresh', async () => {
    const view = render(TodoView, { props: { server } });
    await view.findByText('Payment fails');

    await fireEvent.click(view.getByRole('button', { name: 'Refresh' }));

    await vi.waitFor(() => expect(api.listAssignedTasks).toHaveBeenCalledTimes(2));
  });

  describe('narrowing the list to a project', () => {
    const projectSelect = () => screen.getByRole('combobox', { name: 'Narrow to' });

    it('offers every project that has tasks, by name', async () => {
      const view = render(TodoView, { props: { server } });
      await view.findByText('Payment fails');

      const options = within(projectSelect()).getAllByRole('option');
      expect(options.map(option => option.textContent)).toEqual(['All projects', 'Docs', 'Shop']);
    });

    it('narrows the list to the chosen project, and back to all of them', async () => {
      const view = render(TodoView, { props: { server } });
      await view.findByText('Payment fails');

      await fireEvent.change(projectSelect(), { target: { value: '2' } });

      expect(view.getByText('1 open task assigned to you in Docs, by priority.')).toBeInTheDocument();
      expect(view.getByText('Fix typo')).toBeInTheDocument();
      expect(view.queryByText('Payment fails')).not.toBeInTheDocument();
      expect(view.getAllByRole('heading', { level: 3 }).map(h => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Normal 1 task']);

      await fireEvent.change(projectSelect(), { target: { value: '' } });

      expect(view.getByText('4 open tasks assigned to you across all projects, by priority.')).toBeInTheDocument();
      expect(view.getByText('Payment fails')).toBeInTheDocument();
    });

    it('filters the tasks already loaded, without asking the server again', async () => {
      const view = render(TodoView, { props: { server } });
      await view.findByText('Payment fails');

      await fireEvent.change(projectSelect(), { target: { value: '2' } });

      expect(api.listAssignedTasks).toHaveBeenCalledTimes(1);
    });

    it('keeps the chosen project when the list is refreshed', async () => {
      const view = render(TodoView, { props: { server } });
      await view.findByText('Payment fails');
      await fireEvent.change(projectSelect(), { target: { value: '2' } });

      await fireEvent.click(view.getByRole('button', { name: 'Refresh' }));
      await vi.waitFor(() => expect(api.listAssignedTasks).toHaveBeenCalledTimes(2));

      expect(await view.findByText('1 open task assigned to you in Docs, by priority.')).toBeInTheDocument();
    });

    it('goes back to all projects when a refresh leaves the chosen project without tasks', async () => {
      const view = render(TodoView, { props: { server } });
      await view.findByText('Payment fails');
      await fireEvent.change(projectSelect(), { target: { value: '2' } });

      api.listAssignedTasks.mockResolvedValue(tasks.filter(t => t.project.name !== 'Docs'));
      await fireEvent.click(view.getByRole('button', { name: 'Refresh' }));

      expect(await view.findByText('3 open tasks assigned to you across all projects, by priority.')).toBeInTheDocument();
      expect(view.getByText('Payment fails')).toBeInTheDocument();
    });

    it('starts from all projects on another server', async () => {
      const view = render(TodoView, { props: { server } });
      await view.findByText('Payment fails');
      await fireEvent.change(projectSelect(), { target: { value: '2' } });

      await view.rerender({ server: { ...server, id: '2', url: 'https://other.local' } });

      expect(await view.findByText('4 open tasks assigned to you across all projects, by priority.')).toBeInTheDocument();
    });

    it('has no filter when every task is in one project', async () => {
      api.listAssignedTasks.mockResolvedValue(tasks.filter(t => t.project.name === 'Shop'));
      const view = render(TodoView, { props: { server } });
      await view.findByText('Payment fails');

      expect(view.queryByRole('combobox', { name: 'Narrow to' })).not.toBeInTheDocument();
    });

    describe('within the project chosen in the header', () => {
      // Redmine includes a project's subprojects when it is asked for the project's issues.
      const shop = { id: 1, name: 'Shop' };
      const inShop = [
        tasks[0],
        issue(14, 'Cache the API', { id: 2, name: 'Normal' }, { project: { id: 3, name: 'Shop API' } }),
      ];

      beforeEach(() => api.listAssignedTasks.mockResolvedValue(inShop));

      it('offers the project and its subprojects, and starts with all of the project', async () => {
        const view = render(TodoView, { props: { server, project: shop } });

        expect(await view.findByText('2 open tasks assigned to you in Shop, by priority.')).toBeInTheDocument();
        expect(within(projectSelect()).getAllByRole('option').map(option => option.textContent)).toEqual(['All of Shop', 'Shop', 'Shop API']);
      });

      it('narrows to a subproject without asking the server again', async () => {
        const view = render(TodoView, { props: { server, project: shop } });
        await view.findByText('Payment fails');

        await fireEvent.change(projectSelect(), { target: { value: '3' } });

        expect(view.getByText('1 open task assigned to you in Shop API, by priority.')).toBeInTheDocument();
        expect(view.queryByText('Payment fails')).not.toBeInTheDocument();
        expect(api.listAssignedTasks).toHaveBeenCalledTimes(1);
      });

      it('goes back to all of the new project when the header project changes', async () => {
        const view = render(TodoView, { props: { server, project: shop } });
        await view.findByText('Payment fails');
        await fireEvent.change(projectSelect(), { target: { value: '3' } });

        api.listAssignedTasks.mockResolvedValue([tasks[2]]);
        await view.rerender({ server, project: { id: 2, name: 'Docs' } });

        expect(await view.findByText('1 open task assigned to you in Docs, by priority.')).toBeInTheDocument();
        expect(view.queryByRole('combobox', { name: 'Narrow to' })).not.toBeInTheDocument();
      });
    });
  });

  it('opens a task in a tab of its own, on this server, when its subject is selected', async () => {
    const view = render(TodoView, { props: { server } });

    await fireEvent.click(await view.findByRole('button', { name: 'Slow search' }));

    expect(get(openViews)).toEqual(['dashboard', 'task:1:11']);
    expect(get(activeView)).toBe('task:1:11');
  });

  it('switches to the tab of a task that is open already, instead of opening it twice', async () => {
    const view = render(TodoView, { props: { server } });

    await fireEvent.click(await view.findByRole('button', { name: 'Slow search' }));
    await fireEvent.click(view.getByRole('button', { name: 'Fix typo' }));
    await fireEvent.click(view.getByRole('button', { name: 'Slow search' }));

    expect(get(openViews)).toEqual(['dashboard', 'task:1:11', 'task:1:12']);
    expect(get(activeView)).toBe('task:1:11');
  });
});
