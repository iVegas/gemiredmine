import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import App from '../App.svelte';
import { servers, activeServerId } from '../lib/store';
import { get } from 'svelte/store';
import { openTask, openView, resetViews } from '../lib/views';
import { redmineApi } from '../lib/api';
import { credentialProblem, credentialsRestoring } from '../lib/credentials';
import { serversRestored, storageProblem } from '../lib/persistence';

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
    listAssignedTasks: vi.fn(),
    getTask: vi.fn(),
    listTaskLogEntries: vi.fn(),
    getDevPreviewStatus: vi.fn(),
    getAssistantSettings: vi.fn(async () => ({ provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: '', voice: null })),
    findLocalModelServers: vi.fn(async () => []),
    findSystemAiSetup: vi.fn(async () => []),
    openAssistantKeyPage: vi.fn(async () => {}),
    loadAssistantKey: vi.fn(async () => null),
  },
}));

const api = vi.mocked(redmineApi);
const signedIn = { id: '1', name: 'Dev', url: 'https://dev.local', apiToken: 'key', user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'K' } };

describe('App', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listTimeEntries.mockResolvedValue([]);
    api.listOpenTasks.mockResolvedValue([]);
    api.listAssignedTasks.mockResolvedValue([]);
    api.getDevPreviewStatus.mockResolvedValue({ available: true, enabled: false, dataDir: '', logBytes: 0, pendingEntries: 0 });
    servers.set([]);
    activeServerId.set(null);
    serversRestored.set(true);
    storageProblem.set(null);
    credentialProblem.set(null);
    credentialsRestoring.set(false);
    resetViews();
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('welcomes a new user and asks for the first server', () => {
    const view = render(App);

    expect(view.getByRole('heading', { name: 'Welcome to Gemiredmine' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Add your first server' })).toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(view.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('waits for the saved servers instead of welcoming a user who has some', async () => {
    serversRestored.set(false);
    const view = render(App);

    expect(view.getByText('Loading…')).toBeInTheDocument();
    expect(view.queryByRole('heading', { name: 'Welcome to Gemiredmine' })).not.toBeInTheDocument();

    servers.set([signedIn]);
    activeServerId.set('1');
    serversRestored.set(true);

    expect(await view.findByRole('tab', { name: 'Dashboard' })).toBeInTheDocument();
    expect(view.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('asks a restored server to sign in, with the user who signed in last time', async () => {
    servers.set([{ id: '1', name: 'Dev', url: 'https://dev.local', user: signedIn.user }]);
    activeServerId.set('1');
    const view = render(App);

    expect(await view.findByRole('heading', { name: 'Sign in to Dev' })).toBeInTheDocument();
    expect(view.getByLabelText('Username')).toHaveValue('ana');
    expect(view.getByLabelText('Password')).toHaveValue('');
  });

  it('does not show the sign-in form while the saved sign-ins are being read', async () => {
    servers.set([{ id: '1', name: 'Dev', url: 'https://dev.local', user: signedIn.user }]);
    activeServerId.set('1');
    credentialsRestoring.set(true);
    const view = render(App);

    expect(await view.findByText('Reading your saved sign-ins…')).toBeInTheDocument();
    expect(view.queryByLabelText('Password')).not.toBeInTheDocument();

    servers.set([{ id: '1', name: 'Dev', url: 'https://dev.local', user: signedIn.user, apiToken: 'saved-key' }]);
    credentialsRestoring.set(false);

    expect(await view.findByRole('tab', { name: 'Dashboard' })).toBeInTheDocument();
    expect(view.queryByText('Reading your saved sign-ins…')).not.toBeInTheDocument();
    expect(view.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('shows the sign-in form again, with the reason, once the saved sign-ins could not be read', async () => {
    servers.set([{ id: '1', name: 'Dev', url: 'https://dev.local', user: signedIn.user }]);
    activeServerId.set('1');
    credentialsRestoring.set(true);
    const view = render(App);
    await view.findByText('Reading your saved sign-ins…');

    credentialProblem.set('The saved sign-ins could not be read, so you have to sign in. The keyring is locked.');
    credentialsRestoring.set(false);

    expect(await view.findByLabelText('Password')).toBeInTheDocument();
    expect(view.getByText(/keyring is locked/)).toBeInTheDocument();
  });

  describe('a task in a tab', () => {
    const work = { id: 'w', name: 'Work', url: 'https://work.local', apiToken: 'key-work', user: signedIn.user };
    const home = { id: 'h', name: 'Home', url: 'https://home.local', apiToken: 'key-home', user: signedIn.user };
    const task = (id: number, subject: string) => ({
      issue: { id, subject, project: { id: 1, name: 'P' }, tracker: { id: 1, name: 'Bug' }, status: { id: 1, name: 'New' }, priority: { id: 2, name: 'Normal' } },
      names: {},
    });

    beforeEach(() => {
      api.getTask.mockResolvedValue(task(5, 'Fix the login') as never);
      api.listTaskLogEntries.mockResolvedValue([]);
      servers.set([work, home]);
      activeServerId.set('w');
    });

    it('shows the task from the server it was opened on, even after the user moves to another server', async () => {
      const view = render(App);
      openTask('h', 5);

      expect(await view.findByRole('heading', { name: '#5 Fix the login' })).toBeInTheDocument();
      expect(api.getTask).toHaveBeenCalledWith({ baseUrl: 'https://home.local', apiKey: 'key-home' }, 5);
      expect(await view.findByRole('tab', { name: '#5 Fix the login' })).toHaveAttribute('aria-selected', 'true');

      activeServerId.set('w');
      activeServerId.set('h');
      expect(api.getTask).toHaveBeenCalledTimes(1);
    });

    it('keeps the tab of a task of a server that is signed out, and asks for the sign-in of that server', async () => {
      servers.set([work, { ...home, apiToken: undefined }]);
      const view = render(App);
      openTask('h', 5);

      expect(await view.findByRole('heading', { name: 'Sign in to Home' })).toBeInTheDocument();
      expect(api.getTask).not.toHaveBeenCalled();
    });

    it('closes the tab of a task when its server is removed', async () => {
      const view = render(App);
      openTask('h', 5);
      await view.findByRole('tab', { name: '#5 Fix the login' });

      servers.update((list) => list.filter((server) => server.id !== 'h'));
      const { removeServer } = await import('../lib/store');
      removeServer('h');

      await vi.waitFor(() => expect(view.queryByRole('tab', { name: '#5 Fix the login' })).not.toBeInTheDocument());
    });
  });

  it('offers the other server an empty form, not the user name of the one before', async () => {
    servers.set([
      { id: '1', name: 'Dev', url: 'https://dev.local', user: signedIn.user },
      { id: '2', name: 'Prod', url: 'https://prod.local' },
    ]);
    activeServerId.set('1');
    const view = render(App);
    expect(await view.findByLabelText('Username')).toHaveValue('ana');

    activeServerId.set('2');

    expect(await view.findByRole('heading', { name: 'Sign in to Prod' })).toBeInTheDocument();
    expect(view.getByLabelText('Username')).toHaveValue('');
  });

  describe('when keeping the servers or the sign-ins fails', () => {
    beforeEach(() => {
      servers.set([signedIn]);
      activeServerId.set('1');
    });

    it('says nothing while all is well', async () => {
      const view = render(App);
      await view.findByRole('tab', { name: 'Dashboard' });

      expect(view.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('tells it above whichever tab the user is on, so a sign-in that could not be remembered is not found out at the next start', async () => {
      const view = render(App);
      await view.findByRole('tab', { name: 'Dashboard' });

      credentialProblem.set('Your sign-in could not be remembered, so you stay signed in only until the app is closed. The Secret Service could not be reached.');

      expect(await view.findByRole('alert')).toHaveTextContent('could not be remembered');
      openView('settings');
      expect(await view.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
      expect(view.getAllByRole('alert')).toHaveLength(1);
    });

    it('tells of both problems when there are two', async () => {
      storageProblem.set('Your servers could not be saved.');
      credentialProblem.set('A saved sign-in could not be removed.');
      const view = render(App);

      expect(await view.findAllByRole('alert')).toHaveLength(2);
    });

    it('lets the user put a problem away, and only that one', async () => {
      storageProblem.set('Your servers could not be saved.');
      credentialProblem.set('A saved sign-in could not be removed.');
      const view = render(App);
      const [first] = await view.findAllByRole('button', { name: 'Dismiss' });

      await fireEvent.click(first);

      expect(get(storageProblem)).toBeNull();
      expect(get(credentialProblem)).toBe('A saved sign-in could not be removed.');
      expect(view.getAllByRole('alert')).toHaveLength(1);
    });

    it('is not told in a window with a view of its own, which keeps nothing', async () => {
      window.location.hash = '#view=calendar';
      credentialProblem.set('Your sign-in could not be remembered.');
      const view = render(App);
      await vi.waitFor(() => expect(view.queryByText('Loading…')).not.toBeInTheDocument());

      expect(view.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('tells a new user when the servers cannot be kept', () => {
    storageProblem.set('The servers saved by an earlier run could not be loaded, so nothing is saved in this run. unable to open database file');
    const view = render(App);

    expect(view.getByRole('alert')).toHaveTextContent('unable to open database file');
  });

  it('shows the dashboard once the first server is added', async () => {
    api.getCurrentUser.mockResolvedValueOnce({ id: 3, login: 'bo', firstname: 'Bo', lastname: 'L' });
    const view = render(App);

    await fireEvent.input(view.getByLabelText('Server Name'), { target: { value: 'Dev' } });
    await fireEvent.input(view.getByLabelText('URL'), { target: { value: 'https://dev.local' } });
    await fireEvent.input(view.getByLabelText('API Token'), { target: { value: 'key' } });
    await fireEvent.click(view.getByRole('button', { name: 'Add Server' }));

    expect(await view.findByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    expect(view.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    expect(within(view.getByRole('tabpanel', { name: 'Dashboard' })).getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(view.queryByRole('heading', { name: 'Welcome to Gemiredmine' })).not.toBeInTheDocument();
  });

  it('opens on the dashboard after a fresh start, even if tabs were left open', async () => {
    openView('settings');
    api.getCurrentUser.mockResolvedValueOnce({ id: 3, login: 'bo', firstname: 'Bo', lastname: 'L' });
    const view = render(App);

    await fireEvent.input(view.getByLabelText('Server Name'), { target: { value: 'Dev' } });
    await fireEvent.input(view.getByLabelText('URL'), { target: { value: 'https://dev.local' } });
    await fireEvent.input(view.getByLabelText('API Token'), { target: { value: 'key' } });
    await fireEvent.click(view.getByRole('button', { name: 'Add Server' }));

    await view.findByRole('tab', { name: 'Dashboard' });
    expect(view.getAllByRole('tab')).toHaveLength(1);
  });

  it('asks a server without an API key to sign in', () => {
    servers.set([{ id: '1', name: 'Dev', url: 'https://dev.local' }]);
    activeServerId.set('1');

    const view = render(App);

    expect(view.getByRole('heading', { name: 'Sign in to Dev' })).toBeInTheDocument();
    expect(within(view.getByRole('tabpanel', { name: 'Dashboard' })).queryByRole('button', { name: 'Calendar' })).not.toBeInTheDocument();
  });

  it('puts server info and context in the user menu rather than the page', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);

    expect(view.queryByLabelText('Server context')).not.toBeInTheDocument();
    await fireEvent.click(view.getByRole('button', { name: 'Ana K on Dev' }));

    expect(view.getByLabelText('Server context')).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'https://dev.local' })).toBeInTheDocument();
  });

  it('opens the calendar in a closable tab from its dashboard preview', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);

    await fireEvent.click(within(view.getByRole('tabpanel', { name: 'Dashboard' })).getByRole('button', { name: 'Calendar' }));

    expect(view.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
    expect(view.getByRole('group', { name: 'Show on calendar' })).toBeVisible();
    expect(view.container.querySelector('#view-panel-dashboard')).not.toBeVisible();

    await fireEvent.click(view.getByTestId('close-calendar'));

    expect(view.queryByRole('tab', { name: 'Calendar' })).not.toBeInTheDocument();
    expect(view.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a view mounted while another tab is showing', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);
    await fireEvent.click(within(view.getByRole('tabpanel', { name: 'Dashboard' })).getByRole('button', { name: 'Calendar' }));
    await fireEvent.click(view.getByRole('button', { name: 'Next month' }));
    const shownMonth = view.getByRole('heading', { level: 2, name: /\d{4}/ }).textContent;

    await fireEvent.click(view.getByRole('tab', { name: 'Dashboard' }));
    await fireEvent.click(view.getByRole('tab', { name: 'Calendar' }));

    expect(view.getByRole('heading', { level: 2, name: /\d{4}/ })).toHaveTextContent(shownMonth!);
  });

  it('opens the to-do list from its dashboard preview', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);

    await fireEvent.click(within(view.getByRole('tabpanel', { name: 'Dashboard' })).getByRole('button', { name: 'To-do' }));

    expect(view.getByRole('tab', { name: 'To-do' })).toHaveAttribute('aria-selected', 'true');
    expect(await view.findByText('No open tasks are assigned to you.')).toBeVisible();
  });

  it('opens the views the app is for from the navigation bar, with no menu to find first', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);
    const nav = within(view.getByRole('navigation', { name: 'Views of the app' }));

    await fireEvent.click(nav.getByRole('button', { name: 'To-do' }));
    expect(view.getByRole('tab', { name: 'To-do' })).toHaveAttribute('aria-selected', 'true');

    await fireEvent.click(nav.getByRole('button', { name: 'Settings' }));
    expect(view.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(view.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  it('keeps the assistant in reach of every view as a floating button, and out of its own settings', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);
    const nav = within(view.getByRole('navigation', { name: 'Views of the app' }));

    // On the dashboard the button is there, and it opens the chat over the view rather than in a tab of its own.
    await fireEvent.click(view.getByRole('button', { name: /^Open the assistant/ }));
    expect(view.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument();
    expect(view.queryByRole('tab', { name: 'Assistant' })).not.toBeInTheDocument();

    // Settings is where the assistant is set up, so it does not float over the form there.
    await fireEvent.click(nav.getByRole('button', { name: 'Settings' }));
    expect(view.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: /^Open the assistant/ })).not.toBeInTheDocument();

    // Back on a view of its own data, the panel is where it was left.
    await fireEvent.click(nav.getByRole('button', { name: 'Dashboard' }));
    expect(view.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument();
  });

  it('manages servers in the Settings tab', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);

    await fireEvent.click(view.getByRole('button', { name: 'Ana K on Dev' }));
    await fireEvent.click(view.getByRole('button', { name: 'Manage servers…' }));

    expect(view.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(view.getByRole('heading', { name: 'Servers' })).toBeVisible();

    await fireEvent.click(view.getByRole('button', { name: 'Remove Dev' }));

    expect(view.getByRole('heading', { name: 'Welcome to Gemiredmine' })).toBeInTheDocument();
  });

  it('closes the About tab with its Back button', async () => {
    servers.set([signedIn]);
    activeServerId.set('1');
    const view = render(App);
    await fireEvent.click(view.getByRole('button', { name: 'Ana K on Dev' }));
    await fireEvent.click(view.getByRole('button', { name: 'About' }));
    expect(view.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');

    await fireEvent.click(view.getByRole('button', { name: 'Back' }));

    expect(view.queryByRole('tab', { name: 'About' })).not.toBeInTheDocument();
  });

  it('shows only one view, without the user menu, in a view window', () => {
    window.location.hash = '#view=calendar';
    servers.set([signedIn]);
    activeServerId.set('1');

    const view = render(App);

    expect(view.getAllByRole('tab').map(tab => tab.textContent?.replace('✕', '').trim())).toEqual(['Calendar']);
    expect(view.getByRole('tabpanel', { name: 'Calendar' })).toBeVisible();
    expect(view.getByRole('button', { name: 'Move to main window' })).toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Ana K on Dev' })).not.toBeInTheDocument();
  });

  it('does not welcome a new user in a view window', () => {
    window.location.hash = '#view=settings';

    const view = render(App);

    expect(view.queryByRole('heading', { name: 'Welcome to Gemiredmine' })).not.toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
});
