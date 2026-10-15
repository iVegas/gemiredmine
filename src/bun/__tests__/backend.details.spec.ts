// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BuildInfo } from '../../shared/build-info';
import { createBackend, type BackendOptions } from '../backend';
import { createMemoryDataFs } from '../diagnostics/__tests__/support/memory-data-fs';
import type { FetchLike } from '../redmine/client';
import type { RedmineIssueDetails, RedmineJournalDetail } from '../redmine/types';

const info: BuildInfo = {
  version: '1.0.0-unstable.7',
  channel: 'unstable',
  label: 'Unstable',
  appName: 'Gemiredmine-Unstable',
  productName: 'Gemiredmine Unstable',
  identifier: 'com.gemiredmine.app.unstable',
  dataDirName: 'gemiredmine-unstable',
  platform: 'linux',
  devPreviewAvailable: true,
  repositoryUrl: 'https://github.com/iVegas/gemiredmine',
  commit: 'abc1234',
  buildDate: '2026-10-12T00:00:00.000Z',
};

const access = { baseUrl: 'https://redmine.example.com', apiKey: 'key-1' };
const ok = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) }) as Response;
const failed = (status: number, statusText: string) => ({ ok: false, status, statusText }) as Response;

const issue = (details: RedmineJournalDetail[] = []): RedmineIssueDetails => ({
  id: 42,
  project: { id: 1, name: 'Website' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 2, name: 'In progress' },
  priority: { id: 4, name: 'Urgent' },
  subject: 'Fix the login',
  journals: details.length ? [{ id: 1, user: { id: 2, name: 'Bob' }, created_on: '2026-10-01T10:00:00Z', details }] : [],
});

/** A server that answers by path. Anything not listed is a 404. */
function setup(routes: Record<string, () => Response>, options: BackendOptions = {}) {
  const requested: string[] = [];
  const fetchMock = vi.fn<FetchLike>(async (url) => {
    const { pathname, search } = new URL(url);
    requested.push(pathname + search);
    return routes[pathname]?.() ?? failed(404, 'Not Found');
  });
  const backend = createBackend(
    {
      fetch: fetchMock,
      fs: createMemoryDataFs(),
      dataDir: async () => '/data',
      openUrl: vi.fn(async () => {}),
      environment: async () => ({ platform: 'linux', arch: 'x64', runtime: 'test 1.0' }),
    },
    { buildInfo: info, devPreviewAvailable: false, ...options }
  );
  return { backend, requested, fetchMock };
}

const names = {
  '/issue_statuses.json': () => ok({ issue_statuses: [{ id: 1, name: 'New', is_closed: false }, { id: 2, name: 'In progress', is_closed: false }] }),
  '/enumerations/issue_priorities.json': () => ok({ issue_priorities: [{ id: 2, name: 'Normal', is_default: true, active: true }, { id: 4, name: 'Urgent', is_default: false, active: true }] }),
  '/trackers.json': () => ok({ trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }] }),
};

describe('a task', () => {
  it('is fetched with its history, attachments, subtasks and relations, with the API key of the server', async () => {
    const { backend, requested, fetchMock } = setup({ '/issues/42.json': () => ok({ issue: issue() }) });

    const task = await backend.getTask(access, 42);

    expect(task.issue.subject).toBe('Fix the login');
    expect(requested).toEqual(['/issues/42.json?include=journals,attachments,children,relations']);
    expect((fetchMock.mock.calls[0][1].headers as Headers).get('X-Redmine-API-Key')).toBe('key-1');
  });

  it('needs no other request when the history names nothing by id', async () => {
    const details: RedmineJournalDetail[] = [
      { property: 'attr', name: 'subject', old_value: 'Old', new_value: 'New' },
      { property: 'cf', name: '1', old_value: 'a', new_value: 'b' },
      { property: 'attachment', name: '7', old_value: null, new_value: 'screenshot.png' },
    ];
    const { backend, requested } = setup({ '/issues/42.json': () => ok({ issue: issue(details) }), ...names });

    const task = await backend.getTask(access, 42);

    expect(requested).toHaveLength(1);
    expect(task.names).toEqual({});
  });

  it('gets the names of the ids in the history, and only the lists that the history needs', async () => {
    const details: RedmineJournalDetail[] = [
      { property: 'attr', name: 'status_id', old_value: '1', new_value: '2' },
      { property: 'attr', name: 'priority_id', old_value: '2', new_value: '4' },
    ];
    const { backend, requested } = setup({ '/issues/42.json': () => ok({ issue: issue(details) }), ...names });

    const task = await backend.getTask(access, 42);

    expect(task.names).toEqual({
      status_id: { '1': 'New', '2': 'In progress' },
      priority_id: { '2': 'Normal', '4': 'Urgent' },
    });
    expect([...requested].sort()).toEqual(
      ['/enumerations/issue_priorities.json', '/issue_statuses.json', '/issues/42.json?include=journals,attachments,children,relations'].sort()
    );
  });

  it('is still returned when a list of names cannot be fetched, which leaves those names out', async () => {
    const details: RedmineJournalDetail[] = [
      { property: 'attr', name: 'status_id', old_value: '1', new_value: '2' },
      { property: 'attr', name: 'tracker_id', old_value: '1', new_value: '2' },
    ];
    const { backend } = setup({
      '/issues/42.json': () => ok({ issue: issue(details) }),
      '/issue_statuses.json': () => failed(403, 'Forbidden'),
      '/trackers.json': names['/trackers.json'],
    });

    const task = await backend.getTask(access, 42);

    expect(task.issue.id).toBe(42);
    expect(task.names).toEqual({ tracker_id: { '1': 'Bug', '2': 'Feature' } });
  });

  it('is rejected with the status of the server when it cannot be seen', async () => {
    const { backend } = setup({});

    await expect(backend.getTask(access, 42)).rejects.toThrow('404');
  });

  it('tells the app when the server rejects the key', async () => {
    const onUnauthorized = vi.fn();
    const { backend } = setup({ '/issues/42.json': () => failed(401, 'Unauthorized') }, { onUnauthorized });

    await expect(backend.getTask(access, 42)).rejects.toThrow('401');

    expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith(access);
  });

  it('refuses an id that is not a whole number, without asking the server', async () => {
    const { backend, requested } = setup({});

    await expect(backend.getTask(access, 1.5)).rejects.toThrow('is not a Redmine id');
    await expect(backend.getTask(access, 0)).rejects.toThrow('is not a Redmine id');

    expect(requested).toEqual([]);
  });
});

describe('the time logged on a task', () => {
  it('is listed for that task, the latest day first', async () => {
    const entry = { id: 7, project: { id: 1, name: 'Website' }, issue: { id: 42 }, user: { id: 1, name: 'Alice' }, activity: { id: 8, name: 'Development' }, hours: 2, spent_on: '2026-10-01' };
    const { backend, requested } = setup({ '/time_entries.json': () => ok({ time_entries: [entry], total_count: 1, offset: 0, limit: 100 }) });

    expect(await backend.listTaskLogEntries(access, 42)).toEqual([entry]);

    const query = new URLSearchParams(requested[0].split('?')[1]);
    expect(query.get('issue_id')).toBe('42');
    expect(query.get('sort')).toBe('spent_on:desc');
  });
});

describe('a log entry', () => {
  it('is fetched by its id', async () => {
    const entry = { id: 7, project: { id: 1, name: 'Website' }, user: { id: 1, name: 'Alice' }, activity: { id: 8, name: 'Development' }, hours: 2, spent_on: '2026-10-01' };
    const { backend, requested } = setup({ '/time_entries/7.json': () => ok({ time_entry: entry }) });

    expect(await backend.getLogEntry(access, 7)).toEqual(entry);
    expect(requested).toEqual(['/time_entries/7.json']);
  });

  it('is rejected when it cannot be seen, and tells the app when the key is rejected', async () => {
    const onUnauthorized = vi.fn();
    const { backend } = setup({ '/time_entries/8.json': () => failed(401, 'Unauthorized') }, { onUnauthorized });

    await expect(backend.getLogEntry(access, 7)).rejects.toThrow('404');
    await expect(backend.getLogEntry(access, 8)).rejects.toThrow('401');

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
