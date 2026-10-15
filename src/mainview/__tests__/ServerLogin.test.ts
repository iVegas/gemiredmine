import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ServerLogin from '../ServerLogin.svelte';
import { servers } from '../lib/store';
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
const server = { id: '1', name: 'Dev Server', url: 'https://dev.local' };

describe('ServerLogin Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    servers.set([server]);
  });

  it('signs in and stores the API key on the server', async () => {
    api.signIn.mockResolvedValueOnce({
      apiKey: 'key-2',
      user: { id: 2, login: 'cy', firstname: 'Cy', lastname: 'M' }
    });
    const view = render(ServerLogin, { props: { server } });

    await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'cy' } });
    await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'pw' } });
    await fireEvent.click(view.getByText('Sign in'));

    await vi.waitFor(() => expect(get(servers)[0].apiToken).toBe('key-2'));
    expect(api.signIn).toHaveBeenCalledWith({ baseUrl: 'https://dev.local', username: 'cy', password: 'pw' });
    expect(get(servers)[0].user?.login).toBe('cy');
  });

  it('starts with the user name that was used last time, never with a password', () => {
    const remembered = { ...server, user: { id: 2, login: 'cy', firstname: 'Cy', lastname: 'M' } };

    const view = render(ServerLogin, { props: { server: remembered } });

    expect(view.getByLabelText('Username')).toHaveValue('cy');
    expect(view.getByLabelText('Password')).toHaveValue('');
  });

  it('starts with an empty user name for a server nobody has signed in to', () => {
    const view = render(ServerLogin, { props: { server } });

    expect(view.getByLabelText('Username')).toHaveValue('');
  });

  it('shows the error and leaves the server signed out when sign-in fails', async () => {
    api.signIn.mockRejectedValueOnce(new Error('Invalid username or password.'));
    const view = render(ServerLogin, { props: { server } });

    await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'cy' } });
    await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'nope' } });
    await fireEvent.click(view.getByText('Sign in'));

    expect(await view.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(get(servers)[0].apiToken).toBeUndefined();
  });
});
