import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import LogEntryView from '../LogEntryView.svelte';
import { redmineApi } from '../lib/api';
import { activeView, openViews, resetViews, viewLabels } from '../lib/views';
import type { RedmineTimeEntry } from '../../bun/redmine/types';

vi.mock('../lib/api', () => ({ redmineApi: { getLogEntry: vi.fn() } }));

const api = vi.mocked(redmineApi);
const server = { id: 'srv-1', name: 'Work', url: 'https://redmine.example.com', apiToken: 'key-1' };

const entry = (extra: Partial<RedmineTimeEntry> = {}): RedmineTimeEntry => ({
  id: 7,
  project: { id: 1, name: 'Website' },
  issue: { id: 42 },
  user: { id: 1, name: 'Alice Example' },
  activity: { id: 8, name: 'Development' },
  hours: 2.5,
  comments: 'Paired on the <b>login</b> form',
  spent_on: '2026-10-01',
  created_on: '2026-10-01T17:00:00Z',
  updated_on: '2026-10-01T17:00:00Z',
  ...extra,
});

describe('LogEntryView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getLogEntry.mockResolvedValue(entry());
    resetViews();
    viewLabels.set({});
  });

  afterEach(() => resetViews());

  it('loads the entry from its server with the key of that server', async () => {
    const view = render(LogEntryView, { props: { server, entryId: 7 } });

    expect(await view.findByRole('heading', { name: 'Log entry #7' })).toBeInTheDocument();
    expect(api.getLogEntry).toHaveBeenCalledExactlyOnceWith({ baseUrl: 'https://redmine.example.com', apiKey: 'key-1' }, 7);
  });

  it('shows what was logged, by whom, when, and on what', async () => {
    const view = render(LogEntryView, { props: { server, entryId: 7 } });
    await view.findByRole('heading', { name: 'Log entry #7' });

    const facts = view.getByRole('region', { name: 'Details' });
    for (const text of ['2.5 h', 'Alice Example', 'Development', 'Website']) expect(facts).toHaveTextContent(text);
    expect(view.getByText(/2.5 h on/)).toBeInTheDocument();
  });

  it('shows the comment as text, and renders nothing in it', async () => {
    const view = render(LogEntryView, { props: { server, entryId: 7 } });
    await view.findByRole('heading', { name: 'Log entry #7' });

    expect(view.getByText('Paired on the <b>login</b> form')).toBeInTheDocument();
    expect(view.container.querySelector('b')).toBeNull();
  });

  it('opens the task it was logged on, in a tab of this server', async () => {
    const view = render(LogEntryView, { props: { server, entryId: 7 } });
    await view.findByRole('heading', { name: 'Log entry #7' });

    await fireEvent.click(view.getByRole('button', { name: '#42' }));

    expect(get(openViews)).toContain('task:srv-1:42');
    expect(get(activeView)).toBe('task:srv-1:42');
  });

  it('says that an entry on the project has no task, and that one without a comment has none', async () => {
    api.getLogEntry.mockResolvedValue(entry({ issue: undefined, comments: '' }));
    const view = render(LogEntryView, { props: { server, entryId: 7 } });

    expect(await view.findByText('Logged on the project, not on a task')).toBeInTheDocument();
    expect(view.getByText('There is no comment.')).toBeInTheDocument();
    expect(view.queryByRole('button', { name: /^#/ })).not.toBeInTheDocument();
  });

  it('shows when the entry was changed only when it was', async () => {
    const view = render(LogEntryView, { props: { server, entryId: 7 } });
    await view.findByRole('heading', { name: 'Log entry #7' });
    expect(view.getByRole('region', { name: 'Details' })).not.toHaveTextContent('Changed');
    view.unmount();

    api.getLogEntry.mockResolvedValue(entry({ updated_on: '2026-10-05T08:00:00Z' }));
    const changed = render(LogEntryView, { props: { server, entryId: 7 } });
    await changed.findByRole('heading', { name: 'Log entry #7' });
    expect(changed.getByRole('region', { name: 'Details' })).toHaveTextContent('Changed');
  });

  it('shows the custom fields of the entry that have a value', async () => {
    api.getLogEntry.mockResolvedValue(entry({ custom_fields: [{ id: 1, name: 'Billable', value: 'yes' }, { id: 2, name: 'Ticket', value: null }] }));
    const view = render(LogEntryView, { props: { server, entryId: 7 } });
    await view.findByRole('heading', { name: 'Log entry #7' });

    const facts = view.getByRole('region', { name: 'Details' });
    expect(facts).toHaveTextContent('Billable');
    expect(facts).toHaveTextContent('yes');
    expect(facts).not.toHaveTextContent('Ticket');
  });

  it('gives the tab a title, and a link to Redmine', async () => {
    const view = render(LogEntryView, { props: { server, entryId: 7 } });
    await view.findByRole('heading', { name: 'Log entry #7' });

    expect(get(viewLabels)['log:srv-1:7']).toBe('Log #7 · 2.5 h');
    const link = view.getByRole('link', { name: 'Open in Redmine' });
    expect(link).toHaveAttribute('href', 'https://redmine.example.com/time_entries/7/edit');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('says why it cannot be loaded, and tries again on request', async () => {
    api.getLogEntry.mockRejectedValueOnce(new Error('Redmine API request failed: 404 Not Found'));
    const view = render(LogEntryView, { props: { server, entryId: 7 } });

    expect(await view.findByRole('alert')).toHaveTextContent('Could not load log entry #7 from Work: Redmine API request failed: 404 Not Found');

    await fireEvent.click(view.getByRole('button', { name: 'Try again' }));

    expect(await view.findByRole('heading', { name: 'Log entry #7' })).toBeInTheDocument();
  });

  it('asks for nothing while the server is signed out', () => {
    render(LogEntryView, { props: { server: { ...server, apiToken: undefined }, entryId: 7 } });

    expect(api.getLogEntry).not.toHaveBeenCalled();
  });
});
