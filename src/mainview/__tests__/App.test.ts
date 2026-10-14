import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import App from '../App.svelte';
import { servers, activeServerId } from '../lib/store';
import { openView, resetViews } from '../lib/views';
import { redmineApi } from '../lib/api';

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
    listAssignedTasks: vi.fn(),
    getDevPreviewStatus: vi.fn(),
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
    resetViews();
  });

  it('welcomes a new user and asks for the first server', () => {
    const view = render(App);

    expect(view.getByRole('heading', { name: 'Welcome to Gemiredmine' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Add your first server' })).toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(view.queryByRole('tablist')).not.toBeInTheDocument();
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
    expect(view.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
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
    expect(view.queryByRole('button', { name: 'Calendar' })).not.toBeInTheDocument();
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

    await fireEvent.click(view.getByRole('button', { name: 'Calendar' }));

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
    await fireEvent.click(view.getByRole('button', { name: 'Calendar' }));
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

    await fireEvent.click(view.getByRole('button', { name: 'To-do' }));

    expect(view.getByRole('tab', { name: 'To-do' })).toHaveAttribute('aria-selected', 'true');
    expect(await view.findByText('No open tasks are assigned to you.')).toBeVisible();
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
});
