import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import App from '../App.svelte';
import { servers, activeServerId } from '../lib/store';
import { redmineApi } from '../lib/api';

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);

describe('App', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listTimeEntries.mockResolvedValue([]);
    api.listOpenTasks.mockResolvedValue([]);
    servers.set([]);
    activeServerId.set(null);
  });

  it('prompts to add a server when none are configured', () => {
    const { getByText } = render(App);

    expect(getByText('No Server Selected')).toBeInTheDocument();
  });

  it('asks a server without an API key to sign in', () => {
    servers.set([{ id: '1', name: 'Dev', url: 'https://dev.local' }]);
    activeServerId.set('1');

    const { getByRole, queryByRole } = render(App);

    expect(getByRole('heading', { name: 'Sign in to Dev' })).toBeInTheDocument();
    expect(queryByRole('group', { name: 'Show on calendar' })).not.toBeInTheDocument();
  });

  it('shows the calendar overview for a signed-in server', async () => {
    servers.set([{ id: '1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' }]);
    activeServerId.set('1');

    const { getByRole, getByLabelText } = render(App);

    expect(getByRole('group', { name: 'Show on calendar' })).toBeInTheDocument();
    expect(getByLabelText('Server context')).toBeInTheDocument();
    expect(api.listTimeEntries).toHaveBeenCalled();
  });
});
