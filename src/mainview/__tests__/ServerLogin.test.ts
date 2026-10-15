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

  describe('Remember me', () => {
    const signIn = async (view: { getByLabelText: (text: string) => HTMLElement; getByRole: (role: string, options: { name: string }) => HTMLElement }) => {
      await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'cy' } });
      await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'pw' } });
      await fireEvent.click(view.getByRole('button', { name: 'Sign in' }));
    };
    const result = { apiKey: 'key-2', user: { id: 2, login: 'cy', firstname: 'Cy', lastname: 'M' } };

    it('is checked for a server where the user has not chosen yet', () => {
      const view = render(ServerLogin, { props: { server } });

      expect(view.getByLabelText(/Remember me on this computer/)).toBeChecked();
    });

    it('starts as the user chose at this server before', () => {
      const view = render(ServerLogin, { props: { server: { ...server, remember: false } } });

      expect(view.getByLabelText(/Remember me on this computer/)).not.toBeChecked();
    });

    it('is kept with the server when the user signs in', async () => {
      api.signIn.mockResolvedValueOnce(result);
      const view = render(ServerLogin, { props: { server } });
      await fireEvent.click(view.getByLabelText(/Remember me on this computer/));

      await signIn(view);

      await vi.waitFor(() => expect(get(servers)[0].apiToken).toBe('key-2'));
      expect(get(servers)[0].remember).toBe(false);
    });

    it('keeps the choice to be remembered, which is the default', async () => {
      api.signIn.mockResolvedValueOnce(result);
      const view = render(ServerLogin, { props: { server } });

      await signIn(view);

      await vi.waitFor(() => expect(get(servers)[0].apiToken).toBe('key-2'));
      expect(get(servers)[0].remember).toBe(true);
    });
  });

  describe('when the server rejected the saved sign-in', () => {
    const rejected = { ...server, signInNotice: 'Your sign-in to Dev Server is no longer valid: the server rejected the API key. Sign in again.' };

    it('says why the user is asked again', () => {
      const view = render(ServerLogin, { props: { server: rejected } });

      expect(view.getByRole('alert')).toHaveTextContent('no longer valid');
    });

    it('says nothing when there is nothing to say', () => {
      const view = render(ServerLogin, { props: { server } });

      expect(view.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('takes the notice away once the user has signed in', async () => {
      servers.set([rejected]);
      api.signIn.mockResolvedValueOnce({ apiKey: 'key-3', user: { id: 2, login: 'cy', firstname: 'Cy', lastname: 'M' } });
      const view = render(ServerLogin, { props: { server: rejected } });
      await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'cy' } });
      await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'pw' } });

      await fireEvent.click(view.getByRole('button', { name: 'Sign in' }));

      await vi.waitFor(() => expect(get(servers)[0].apiToken).toBe('key-3'));
      expect(get(servers)[0].signInNotice).toBeUndefined();
    });
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
