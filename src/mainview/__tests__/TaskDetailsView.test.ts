import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import TaskDetailsView from '../TaskDetailsView.svelte';
import { redmineApi } from '../lib/api';
import { toDateKey } from '../lib/calendar';
import { activeView, openViews, resetViews, viewLabels } from '../lib/views';
import type { RedmineIssueDetails, RedmineTimeEntry } from '../../bun/redmine/types';
import type { TaskDetails } from '../../shared/backend';

vi.mock('../lib/api', () => ({
  redmineApi: { getTask: vi.fn(), listTaskLogEntries: vi.fn(), listTimeActivities: vi.fn(), createLogEntry: vi.fn() },
}));

const api = vi.mocked(redmineApi);
const server = { id: 'srv-1', name: 'Work', url: 'https://redmine.example.com', apiToken: 'key-1' };
const access = { baseUrl: 'https://redmine.example.com', apiKey: 'key-1' };

const issue = (extra: Partial<RedmineIssueDetails> = {}): RedmineIssueDetails => ({
  id: 42,
  project: { id: 1, name: 'Website' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 2, name: 'In progress' },
  priority: { id: 4, name: 'Urgent' },
  subject: 'Fix the login',
  description: 'Steps:\n1. Open the page\n<script>alert(1)</script> and <b>not bold</b>',
  author: { id: 2, name: 'Bob Builder' },
  assigned_to: { id: 1, name: 'Alice Example' },
  start_date: '2026-10-01',
  due_date: '2099-12-31',
  done_ratio: 40,
  estimated_hours: 8,
  spent_hours: 5,
  created_on: '2026-10-01T09:00:00Z',
  updated_on: '2026-10-02T09:00:00Z',
  closed_on: null,
  custom_fields: [{ id: 1, name: 'Customer', value: 'ACME' }],
  journals: [],
  attachments: [],
  children: [],
  relations: [],
  ...extra,
});

const task = (extra: Partial<RedmineIssueDetails> = {}, names: TaskDetails['names'] = {}): TaskDetails => ({ issue: issue(extra), names });

const entry = (id: number, spentOn: string, hours: number, comments?: string): RedmineTimeEntry => ({
  id,
  project: { id: 1, name: 'Website' },
  issue: { id: 42 },
  user: { id: 1, name: 'Alice Example' },
  activity: { id: 8, name: 'Development' },
  hours,
  comments,
  spent_on: spentOn,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
};

describe('TaskDetailsView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getTask.mockResolvedValue(task());
    api.listTaskLogEntries.mockResolvedValue([]);
    resetViews();
    viewLabels.set({});
  });

  afterEach(() => resetViews());

  it('loads the task from its server with the key of that server', async () => {
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

    expect(await view.findByRole('heading', { name: '#42 Fix the login' })).toBeInTheDocument();
    expect(api.getTask).toHaveBeenCalledExactlyOnceWith(access, 42);
    expect(api.listTaskLogEntries).toHaveBeenCalledExactlyOnceWith(access, 42);
  });

  it('says that it is loading, and then shows what the task is', async () => {
    const loading = deferred<TaskDetails>();
    api.getTask.mockReturnValue(loading.promise);
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

    expect(view.getByRole('status')).toHaveTextContent('Loading task #42');

    loading.resolve(task());
    expect(await view.findByText('In progress', { selector: 'span' })).toBeInTheDocument();
    expect(view.queryByText('Loading task #42…')).not.toBeInTheDocument();
  });

  it('shows the facts of the task, and leaves out those it has no value for', async () => {
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
    await view.findByRole('heading', { name: '#42 Fix the login' });

    const facts = view.getByRole('region', { name: 'Details' });
    for (const text of ['Website', 'Bug', 'Bob Builder', 'Alice Example', 'ACME', '8 h', '5 h']) expect(facts).toHaveTextContent(text);
    expect(facts).not.toHaveTextContent('Category');
    expect(facts).not.toHaveTextContent('Target version');
    expect(facts).not.toHaveTextContent('Closed');
    expect(view.getByRole('progressbar', { name: 'Done' })).toHaveAttribute('aria-valuenow', '40');
  });

  it('marks a task that is past its due date, and not one that is closed', async () => {
    api.getTask.mockResolvedValue(task({ due_date: '2020-01-01' }));
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
    expect(await view.findByText(/\(overdue\)/)).toBeInTheDocument();
    view.unmount();

    api.getTask.mockResolvedValue(task({ due_date: '2020-01-01', closed_on: '2020-01-02T00:00:00Z' }));
    const closed = render(TaskDetailsView, { props: { server, taskId: 42 } });
    await closed.findByRole('heading', { name: '#42 Fix the login' });
    expect(closed.queryByText(/\(overdue\)/)).not.toBeInTheDocument();
  });

  it('shows the description as text, and runs and renders nothing in it', async () => {
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
    await view.findByRole('heading', { name: '#42 Fix the login' });

    expect(view.getByText(/<script>alert\(1\)<\/script> and <b>not bold<\/b>/)).toBeInTheDocument();
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('b')).toBeNull();
  });

  it('says so when there is no description', async () => {
    api.getTask.mockResolvedValue(task({ description: '' }));
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

    expect(await view.findByText('There is no description.')).toBeInTheDocument();
  });

  it('gives the tab the number and the subject of the task', async () => {
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
    await view.findByRole('heading', { name: '#42 Fix the login' });

    expect(get(viewLabels)['task:srv-1:42']).toBe('#42 Fix the login');
  });

  it('links to the task in Redmine, in the browser', async () => {
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
    await view.findByRole('heading', { name: '#42 Fix the login' });

    const link = view.getByRole('link', { name: 'Open in Redmine' });
    expect(link).toHaveAttribute('href', 'https://redmine.example.com/issues/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('has no link when the address of the server is not a web address', async () => {
    const view = render(TaskDetailsView, { props: { server: { ...server, url: 'javascript:alert(1)' }, taskId: 42 } });
    await view.findByRole('heading', { name: '#42 Fix the login' });

    expect(view.queryByRole('link', { name: 'Open in Redmine' })).not.toBeInTheDocument();
  });

  describe('related tasks', () => {
    it('opens a subtask, a relation and the parent in tabs of their own, on the server of this task', async () => {
      api.getTask.mockResolvedValue(
        task({
          parent: { id: 40 },
          children: [{ id: 43, tracker: { id: 2, name: 'Feature' }, subject: 'Write the form' }],
          relations: [{ id: 1, issue_id: 42, issue_to_id: 50, relation_type: 'blocks', delay: null }],
        })
      );
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
      await view.findByRole('heading', { name: '#42 Fix the login' });

      await fireEvent.click(view.getByRole('button', { name: /Write the form/ }));
      await fireEvent.click(view.getByRole('button', { name: '#50' }));
      await fireEvent.click(view.getByRole('button', { name: '#40' }));

      expect(get(openViews)).toEqual(['dashboard', 'task:srv-1:43', 'task:srv-1:50', 'task:srv-1:40']);
      expect(view.getByText('Blocks')).toBeInTheDocument();
      expect(view.getByText('Subtask')).toBeInTheDocument();
    });

    it('reads a relation from this task, whichever end it was made at', async () => {
      api.getTask.mockResolvedValue(task({ relations: [{ id: 1, issue_id: 50, issue_to_id: 42, relation_type: 'blocks', delay: null }] }));
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
      await view.findByRole('heading', { name: '#42 Fix the login' });

      expect(view.getByText('Blocked by')).toBeInTheDocument();
      expect(view.getByRole('button', { name: '#50' })).toBeInTheDocument();
    });

    it('has no such section for a task with none', async () => {
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
      await view.findByRole('heading', { name: '#42 Fix the login' });

      expect(view.queryByRole('heading', { name: 'Related tasks' })).not.toBeInTheDocument();
    });
  });

  describe('files', () => {
    it('lists them with links, and has no link for an address that is not a web address', async () => {
      const file = { id: 1, filename: 'screenshot.png', filesize: 48_213, content_url: '/attachments/download/1/screenshot.png', description: 'The page', author: { id: 2, name: 'Bob Builder' }, created_on: '2026-10-01T10:00:00Z' };
      api.getTask.mockResolvedValue(task({ attachments: [file, { ...file, id: 2, filename: 'bad.txt', content_url: 'javascript:alert(1)' }] }));
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
      await view.findByRole('heading', { name: '#42 Fix the login' });

      expect(view.getByRole('link', { name: 'screenshot.png' })).toHaveAttribute('href', 'https://redmine.example.com/attachments/download/1/screenshot.png');
      expect(view.getAllByText('The page')).toHaveLength(2);
      expect(view.getByText('bad.txt')).toBeInTheDocument();
      expect(view.queryByRole('link', { name: 'bad.txt' })).not.toBeInTheDocument();
    });
  });

  describe('time logged', () => {
    it('lists the entries with their total, and opens one in a tab', async () => {
      api.listTaskLogEntries.mockResolvedValue([entry(9, '2026-10-02', 2.5, 'Pairing'), entry(7, '2026-10-01', 1)]);
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

      expect(await view.findByText(/in 2 entries/)).toHaveTextContent('3.5 h in 2 entries');
      expect(view.getByText('Pairing')).toBeInTheDocument();

      await fireEvent.click(view.getByRole('button', { name: /Pairing/ }));

      expect(get(openViews)).toContain('log:srv-1:9');
      expect(get(activeView)).toBe('log:srv-1:9');
    });

    it('says so when nothing was logged', async () => {
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

      expect(await view.findByText('No time has been logged on this task.')).toBeInTheDocument();
    });

    it('says why it cannot be shown, and shows the task all the same', async () => {
      api.listTaskLogEntries.mockRejectedValue(new Error('Redmine API request failed: 403 Forbidden'));
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

      expect(await view.findByText(/cannot be shown: Redmine API request failed: 403 Forbidden/)).toBeInTheDocument();
      expect(view.getByRole('heading', { name: '#42 Fix the login' })).toBeInTheDocument();
      expect(view.queryByRole('alert')).not.toBeInTheDocument();
    });

    describe('logging time', () => {
      const activities = [
        { id: 8, name: 'Development' },
        { id: 9, name: 'Design' },
      ];

      beforeEach(() => api.listTimeActivities.mockResolvedValue(activities));

      it('opens a form above the entries already logged on the task', async () => {
        api.listTaskLogEntries.mockResolvedValue([entry(9, '2026-10-02', 2.5, 'Pairing')]);
        const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
        await view.findByText('Pairing');

        await fireEvent.click(view.getByRole('button', { name: 'Log time' }));

        expect(await view.findByRole('form', { name: 'Log time on #42' })).toBeInTheDocument();
        expect(await view.findByRole('option', { name: 'Development' })).toBeInTheDocument();
        expect(view.getByLabelText('Activity')).toHaveValue('8');
        expect(view.getByText('Pairing')).toBeInTheDocument();
        expect(api.listTimeActivities).toHaveBeenCalledExactlyOnceWith(access);
      });

      it('logs the time on the task, and shows the new entry among the others', async () => {
        const today = toDateKey(new Date());
        api.createLogEntry.mockResolvedValue(undefined);
        api.listTaskLogEntries
          .mockResolvedValueOnce([])
          .mockResolvedValue([entry(10, today, 1.5, 'Review')]);
        const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
        await view.findByText('No time has been logged on this task.');
        await fireEvent.click(view.getByRole('button', { name: 'Log time' }));
        await view.findByRole('option', { name: 'Development' });

        await fireEvent.input(view.getByLabelText('Hours'), { target: { value: '1.5' } });
        await fireEvent.input(view.getByLabelText('Comment'), { target: { value: ' Review ' } });
        await fireEvent.submit(view.getByRole('form', { name: 'Log time on #42' }));

        expect(api.createLogEntry).toHaveBeenCalledExactlyOnceWith(access, {
          taskId: 42,
          spentOn: today,
          hours: 1.5,
          activityId: 8,
          comments: 'Review',
        });
        expect(await view.findByText('Review')).toBeInTheDocument();
        expect(view.getByRole('status')).toHaveTextContent('Logged 1.5 h');
        expect(view.getByLabelText('Hours')).toHaveValue(null);
      });

      it('does not send a log entry without hours, and says what is missing', async () => {
        const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
        await view.findByText('No time has been logged on this task.');
        await fireEvent.click(view.getByRole('button', { name: 'Log time' }));
        await view.findByRole('option', { name: 'Development' });

        await fireEvent.submit(view.getByRole('form', { name: 'Log time on #42' }));

        expect(api.createLogEntry).not.toHaveBeenCalled();
        expect(view.getByRole('alert')).toHaveTextContent('Enter the hours, the date and an activity.');
      });

      it('says why the time could not be logged, and keeps what was typed', async () => {
        api.createLogEntry.mockRejectedValue(new Error('Redmine API request failed: 403 Forbidden'));
        const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
        await view.findByText('No time has been logged on this task.');
        await fireEvent.click(view.getByRole('button', { name: 'Log time' }));
        await view.findByRole('option', { name: 'Development' });
        await fireEvent.input(view.getByLabelText('Hours'), { target: { value: '2' } });

        await fireEvent.submit(view.getByRole('form', { name: 'Log time on #42' }));

        expect(await view.findByText(/could not be logged: Redmine API request failed: 403 Forbidden/)).toBeInTheDocument();
        expect(view.getByLabelText('Hours')).toHaveValue(2);
      });
    });
  });

  describe('history', () => {
    const journals = [
      { id: 1, user: { id: 2, name: 'Bob Builder' }, notes: 'Can you look at this?\n\nThanks <i>a lot</i>', created_on: '2026-10-01T10:00:00Z', private_notes: false, details: [] },
      { id: 2, user: { id: 1, name: 'Alice Example' }, notes: '', created_on: '2026-10-02T10:00:00Z', private_notes: false, details: [{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' }] },
      { id: 3, user: { id: 1, name: 'Alice Example' }, notes: 'Only for us', created_on: '2026-10-03T10:00:00Z', private_notes: true, details: [] },
      { id: 4, user: { id: 1, name: 'Alice Example' }, notes: '', created_on: '2026-10-04T10:00:00Z', details: [] },
    ];

    it('shows the comments and the changes in order, with the names of what changed', async () => {
      api.getTask.mockResolvedValue(task({ journals }, { status_id: { '1': 'New', '2': 'In progress' } }));
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
      await view.findByRole('heading', { name: '#42 Fix the login' });

      const items = view.getByRole('heading', { name: 'History' }).closest('section')!.querySelectorAll('ol > li');
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent('Bob Builder');
      expect(items[0]).toHaveTextContent('Can you look at this?');
      expect(items[1]).toHaveTextContent('Status: New → In progress');
      expect(items[2]).toHaveTextContent('Private');
      expect(items[2]).toHaveTextContent('Only for us');
    });

    it('shows comments as text, and renders nothing in them', async () => {
      api.getTask.mockResolvedValue(task({ journals }));
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
      await view.findByRole('heading', { name: '#42 Fix the login' });

      expect(view.getByText(/Thanks <i>a lot<\/i>/)).toBeInTheDocument();
      expect(view.container.querySelector('i')).toBeNull();
    });

    it('says so when there is none', async () => {
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

      expect(await view.findByText('Nothing has been said or changed on this task.')).toBeInTheDocument();
    });
  });

  describe('when the task cannot be loaded', () => {
    it('says why, and tries again on request', async () => {
      api.getTask.mockRejectedValueOnce(new Error('Redmine API request failed: 404 Not Found'));
      const view = render(TaskDetailsView, { props: { server, taskId: 42 } });

      expect(await view.findByRole('alert')).toHaveTextContent('Could not load task #42 from Work: Redmine API request failed: 404 Not Found');
      expect(view.queryByRole('heading', { name: /Fix the login/ })).not.toBeInTheDocument();

      await fireEvent.click(view.getByRole('button', { name: 'Try again' }));

      expect(await view.findByRole('heading', { name: '#42 Fix the login' })).toBeInTheDocument();
      expect(view.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('asks for nothing while the server is signed out', () => {
      render(TaskDetailsView, { props: { server: { ...server, apiToken: undefined }, taskId: 42 } });

      expect(api.getTask).not.toHaveBeenCalled();
    });
  });

  it('refreshes on request', async () => {
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
    await view.findByRole('heading', { name: '#42 Fix the login' });
    api.getTask.mockResolvedValue(task({ subject: 'Fix the login, again' }));

    await fireEvent.click(view.getByRole('button', { name: 'Refresh' }));

    expect(await view.findByRole('heading', { name: '#42 Fix the login, again' })).toBeInTheDocument();
  });

  it('ignores the answer for a task that the view has moved on from', async () => {
    const slow = deferred<TaskDetails>();
    api.getTask.mockReturnValueOnce(slow.promise);
    const view = render(TaskDetailsView, { props: { server, taskId: 42 } });
    api.getTask.mockResolvedValue(task({ id: 43, subject: 'The other task' }));

    await view.rerender({ server, taskId: 43 });
    expect(await view.findByRole('heading', { name: '#43 The other task' })).toBeInTheDocument();
    slow.resolve(task({ subject: 'The first task, late' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.queryByText(/The first task, late/)).not.toBeInTheDocument();
    expect(view.getByRole('heading', { name: '#43 The other task' })).toBeInTheDocument();
  });
});
