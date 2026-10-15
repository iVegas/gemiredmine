import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import SettingsView from '../SettingsView.svelte';
import { servers, activeServerId } from '../lib/store';
import { credentialProblem } from '../lib/credentials';
import { storageProblem } from '../lib/persistence';
import { activeView, openView, resetViews } from '../lib/views';

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
    listAssignedTasks: vi.fn(),
  },
}));

const dev = { id: '1', name: 'Dev Server', url: 'https://dev.local', apiToken: 'k', user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'K' } };
const prod = { id: '2', name: 'Prod Server', url: 'https://prod.local' };

describe('SettingsView Component', () => {
  beforeEach(() => {
    servers.set([dev, prod]);
    activeServerId.set('1');
    storageProblem.set(null);
    credentialProblem.set(null);
    resetViews();
  });

  it('lets the user choose, for each server, whether to be remembered', async () => {
    servers.set([{ ...dev, remember: true }, { ...prod, remember: false }]);
    const view = render(SettingsView);
    const devBox = view.getByRole('checkbox', { name: 'Remember me on this computer for Dev Server' });
    const prodBox = view.getByRole('checkbox', { name: 'Remember me on this computer for Prod Server' });

    expect(devBox).toBeChecked();
    expect(prodBox).not.toBeChecked();

    await fireEvent.click(devBox);
    await fireEvent.click(prodBox);

    expect(get(servers).map((server) => server.remember)).toEqual([false, true]);
  });

  it('treats a server without a choice as remembered', () => {
    servers.set([{ ...prod }]);
    const view = render(SettingsView);

    expect(view.getByRole('checkbox', { name: 'Remember me on this computer for Prod Server' })).toBeChecked();
  });

  it('warns when the credential store cannot be used', () => {
    credentialProblem.set('Your sign-in could not be remembered, so you stay signed in only until the app is closed. The Secret Service could not be reached.');

    const view = render(SettingsView);

    expect(view.getByRole('alert')).toHaveTextContent('could not be remembered');
  });

  it('shows both problems when there are two', () => {
    storageProblem.set('The servers could not be saved.');
    credentialProblem.set('A saved sign-in could not be removed.');

    const view = render(SettingsView);

    expect(view.getAllByRole('alert')).toHaveLength(2);
  });

  it('says nothing about storage while the servers are kept', () => {
    const view = render(SettingsView);

    expect(view.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns when the servers cannot be kept for the next start', () => {
    storageProblem.set('Your servers could not be saved, so they will be missing the next time you start the app. disk full');

    const view = render(SettingsView);

    expect(view.getByRole('alert')).toHaveTextContent('could not be saved');
    expect(view.getByRole('alert')).toHaveTextContent('disk full');
  });

  it('lists every server with its URL, sign-in state and which one is active', () => {
    const view = render(SettingsView);

    expect(view.getByRole('heading', { name: 'Servers' })).toBeInTheDocument();
    expect(view.getByText('https://dev.local')).toBeInTheDocument();
    expect(view.getByText('https://prod.local')).toBeInTheDocument();
    expect(view.getByText('Signed in as ana')).toBeInTheDocument();
    expect(view.getByText('Not signed in')).toBeInTheDocument();
    expect(view.getByText('Active')).toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Switch to Dev Server' })).not.toBeInTheDocument();
  });

  it('switches the active server', async () => {
    const view = render(SettingsView);

    await fireEvent.click(view.getByRole('button', { name: 'Switch to Prod Server' }));

    expect(get(activeServerId)).toBe('2');
  });

  it('drops the notice of a rejected sign-in when the user signs out', async () => {
    servers.set([{ ...dev, signInNotice: 'Sign in again.' }, prod]);
    const view = render(SettingsView);

    await fireEvent.click(view.getByRole('button', { name: 'Sign out of Dev Server' }));

    expect(get(servers)[0].signInNotice).toBeUndefined();
  });

  it('signs out of a server and clears its API key', async () => {
    const view = render(SettingsView);

    await fireEvent.click(view.getByRole('button', { name: 'Sign out of Dev Server' }));

    expect(get(servers)[0]).toMatchObject({ id: '1', apiToken: undefined, user: undefined });
    expect(view.getByRole('button', { name: 'Sign in to Dev Server' })).toBeInTheDocument();
  });

  it('sends sign-in to the dashboard of that server', async () => {
    openView('settings');
    const view = render(SettingsView);

    await fireEvent.click(view.getByRole('button', { name: 'Sign in to Prod Server' }));

    expect(get(activeServerId)).toBe('2');
    expect(get(activeView)).toBe('dashboard');
  });

  it('removes a server and moves the selection to a remaining one', async () => {
    const view = render(SettingsView);

    await fireEvent.click(view.getByRole('button', { name: 'Remove Dev Server' }));

    expect(view.queryByText('Dev Server')).not.toBeInTheDocument();
    expect(get(servers).map(s => s.id)).toEqual(['2']);
    expect(get(activeServerId)).toBe('2');
  });

  it('adds a server with the inline form', async () => {
    const view = render(SettingsView);

    await fireEvent.click(view.getByRole('button', { name: '+ Add Server' }));
    await fireEvent.input(view.getByLabelText('Server Name'), { target: { value: 'Stage' } });
    await fireEvent.input(view.getByLabelText('URL'), { target: { value: 'https://stage.local' } });
    await fireEvent.click(view.getByRole('button', { name: 'Add Server' }));

    await vi.waitFor(() => expect(get(servers).map(s => s.name)).toEqual(['Dev Server', 'Prod Server', 'Stage']));
    expect(view.queryByLabelText('Server Name')).not.toBeInTheDocument();
    expect(get(activeServerId)).toBe('1');
  });

  it('hides the form again on Cancel', async () => {
    const view = render(SettingsView);

    await fireEvent.click(view.getByRole('button', { name: '+ Add Server' }));
    await fireEvent.click(view.getByRole('button', { name: 'Cancel' }));

    expect(view.queryByLabelText('Server Name')).not.toBeInTheDocument();
  });
});
