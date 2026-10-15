import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import RecordPanel from '../RecordPanel.svelte';
import { redmineApi } from '../lib/api';
import { credentialsRestoring } from '../lib/credentials';
import { servers } from '../lib/store';
import { logView, taskView } from '../lib/views';

vi.mock('../lib/api', () => ({
  redmineApi: { getTask: vi.fn(), listTaskLogEntries: vi.fn(), getLogEntry: vi.fn(), signIn: vi.fn() },
}));

const api = vi.mocked(redmineApi);
const work = { id: 'srv-1', name: 'Work', url: 'https://work.example', apiToken: 'key-work' };
const home = { id: 'srv-2', name: 'Home', url: 'https://home.example', apiToken: 'key-home' };

describe('RecordPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getTask.mockImplementation(() => new Promise(() => {}));
    api.listTaskLogEntries.mockResolvedValue([]);
    api.getLogEntry.mockImplementation(() => new Promise(() => {}));
    servers.set([work, home]);
    credentialsRestoring.set(false);
  });

  it('shows a task from the server named in its id, whichever server is in use', async () => {
    render(RecordPanel, { props: { view: taskView('srv-2', 42), active: true } });

    expect(api.getTask).toHaveBeenCalledExactlyOnceWith({ baseUrl: 'https://home.example', apiKey: 'key-home' }, 42);
  });

  it('shows a log entry from the server named in its id', () => {
    render(RecordPanel, { props: { view: logView('srv-1', 7), active: true } });

    expect(api.getLogEntry).toHaveBeenCalledExactlyOnceWith({ baseUrl: 'https://work.example', apiKey: 'key-work' }, 7);
  });

  it('says that the server is gone, and asks for nothing, when the server is not in the list', () => {
    const view = render(RecordPanel, { props: { view: taskView('srv-9', 42), active: true } });

    expect(view.getByText(/not in the list any more/)).toBeInTheDocument();
    expect(api.getTask).not.toHaveBeenCalled();
  });

  it('asks the user to sign in to the server of the tab, when the tab is on show', () => {
    servers.set([{ ...work, apiToken: undefined }, home]);
    const view = render(RecordPanel, { props: { view: taskView('srv-1', 42), active: true } });

    expect(view.getByRole('heading', { name: 'Sign in to Work' })).toBeInTheDocument();
    expect(api.getTask).not.toHaveBeenCalled();
  });

  it('shows no sign-in form in a tab that is not on show, so that the fields of two forms do not share ids', () => {
    servers.set([{ ...work, apiToken: undefined }, home]);
    const view = render(RecordPanel, { props: { view: taskView('srv-1', 42), active: false } });

    expect(view.queryByRole('heading', { name: 'Sign in to Work' })).not.toBeInTheDocument();
  });

  it('waits for the saved sign-ins instead of showing the form for a moment', () => {
    servers.set([{ ...work, apiToken: undefined }, home]);
    credentialsRestoring.set(true);
    const view = render(RecordPanel, { props: { view: logView('srv-1', 7), active: true } });

    expect(view.getByText('Reading your saved sign-ins…')).toBeInTheDocument();
    expect(view.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
