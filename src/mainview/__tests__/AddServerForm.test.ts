import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import AddServerForm from '../AddServerForm.svelte';
import { servers } from '../lib/store';
import { get } from 'svelte/store';
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

describe('AddServerForm Component', () => {
  beforeEach(() => {
    servers.set([]);
  });

  it('submits form and adds server to store', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    const { getByLabelText, getByText } = render(AddServerForm, {
      props: { onSuccess, onCancel }
    });

    const nameInput = getByLabelText('Server Name');
    const urlInput = getByLabelText('URL');

    await fireEvent.input(nameInput, { target: { value: 'My Redmine' } });
    await fireEvent.input(urlInput, { target: { value: 'https://my.redmine.com' } });

    const submitBtn = getByText('Add Server');
    await fireEvent.click(submitBtn);

    expect(onSuccess).toHaveBeenCalled();

    const currentServers = get(servers);
    expect(currentServers).toHaveLength(1);
    expect(currentServers[0].name).toBe('My Redmine');
    expect(currentServers[0].url).toBe('https://my.redmine.com');
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    const { getByText } = render(AddServerForm, {
      props: { onSuccess, onCancel }
    });

    const cancelBtn = getByText('Cancel');
    await fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalled();
  });

  describe('authentication', () => {
    const fillBasics = async (getByLabelText: (label: string) => HTMLElement) => {
      await fireEvent.input(getByLabelText('Server Name'), { target: { value: 'My Redmine' } });
      await fireEvent.input(getByLabelText('URL'), { target: { value: 'https://my.redmine.com' } });
    };

    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('signs in with username and password and stores the API key, not the password', async () => {
      api.signIn.mockResolvedValueOnce({
        apiKey: 'key-1',
        user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K' }
      });
      const onSuccess = vi.fn();
      const view = render(AddServerForm, { props: { onSuccess, onCancel: vi.fn() } });

      await fillBasics(view.getByLabelText);
      await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'ana' } });
      await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'secret' } });
      await fireEvent.click(view.getByText('Add Server'));

      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(api.signIn).toHaveBeenCalledWith({
        baseUrl: 'https://my.redmine.com',
        username: 'ana',
        password: 'secret'
      });
      const [stored] = get(servers);
      expect(stored).toMatchObject({ apiToken: 'key-1', user: { login: 'ana' } });
      expect(stored).not.toHaveProperty('password');
    });

    it('shows the error and keeps the form open when sign-in fails', async () => {
      api.signIn.mockRejectedValueOnce(new Error('Invalid username or password.'));
      const onSuccess = vi.fn();
      const view = render(AddServerForm, { props: { onSuccess, onCancel: vi.fn() } });

      await fillBasics(view.getByLabelText);
      await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'ana' } });
      await fireEvent.input(view.getByLabelText('Password'), { target: { value: 'wrong' } });
      await fireEvent.click(view.getByText('Add Server'));

      expect(await view.findByRole('alert')).toHaveTextContent('Invalid username or password.');
      expect(onSuccess).not.toHaveBeenCalled();
      expect(get(servers)).toHaveLength(0);
    });

    it('asks for both username and password when only one is entered', async () => {
      const onSuccess = vi.fn();
      const view = render(AddServerForm, { props: { onSuccess, onCancel: vi.fn() } });

      await fillBasics(view.getByLabelText);
      await fireEvent.input(view.getByLabelText('Username'), { target: { value: 'ana' } });
      await fireEvent.click(view.getByText('Add Server'));

      expect(await view.findByRole('alert')).toHaveTextContent('Enter both a username and a password');
      expect(api.signIn).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('validates an API token and stores the user it belongs to', async () => {
      api.getCurrentUser.mockResolvedValueOnce({ id: 3, login: 'bo', firstname: 'Bo', lastname: 'L' });
      const onSuccess = vi.fn();
      const view = render(AddServerForm, { props: { onSuccess, onCancel: vi.fn() } });

      await fillBasics(view.getByLabelText);
      await fireEvent.input(view.getByLabelText('API Token'), { target: { value: 'token-9' } });
      await fireEvent.click(view.getByText('Add Server'));

      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(api.getCurrentUser).toHaveBeenCalledWith({ baseUrl: 'https://my.redmine.com', apiKey: 'token-9' });
      expect(get(servers)[0]).toMatchObject({ apiToken: 'token-9', user: { login: 'bo' } });
    });
  });
});

