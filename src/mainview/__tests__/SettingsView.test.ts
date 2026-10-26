import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import SettingsView from '../SettingsView.svelte';
import { servers, activeServerId } from '../lib/store';
import { activeView, openView, resetViews } from '../lib/views';
import { redmineApi } from '../lib/api';

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
    listAssignedTasks: vi.fn(),
    getCredentialOptions: vi.fn(async () => ({ biometric: null })),
    setBiometricUnlock: vi.fn(async () => {}),
  },
}));

const dev = { id: '1', name: 'Dev Server', url: 'https://dev.local', apiToken: 'k', user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'K' } };
const prod = { id: '2', name: 'Prod Server', url: 'https://prod.local' };

describe('SettingsView Component', () => {
  beforeEach(() => {
    servers.set([dev, prod]);
    activeServerId.set('1');
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

describe('SettingsView: the fingerprint or face unlock', () => {
  const unlock = /Unlock saved sign-ins with a fingerprint or face/;

  beforeEach(() => {
    servers.set([dev, prod]);
    activeServerId.set('1');
    resetViews();
    vi.mocked(redmineApi.getCredentialOptions).mockResolvedValue({ biometric: null });
    vi.mocked(redmineApi.setBiometricUnlock).mockReset().mockResolvedValue(undefined);
  });

  it('is not shown where the device has no unlock option', async () => {
    const view = render(SettingsView);
    await vi.waitFor(() => expect(redmineApi.getCredentialOptions).toHaveBeenCalled());

    expect(view.queryByRole('heading', { name: 'Security' })).toBeNull();
  });

  it('turns the unlock on when the user asks for it', async () => {
    vi.mocked(redmineApi.getCredentialOptions).mockResolvedValue({ biometric: { available: true, enabled: false } });
    const view = render(SettingsView);
    const box = await view.findByRole('checkbox', { name: unlock });

    expect(box).not.toBeChecked();
    await fireEvent.click(box);

    expect(redmineApi.setBiometricUnlock).toHaveBeenCalledExactlyOnceWith(true);
    expect(box).toBeChecked();
  });

  it('says why it cannot be used when the device has no fingerprint or face set up', async () => {
    vi.mocked(redmineApi.getCredentialOptions).mockResolvedValue({ biometric: { available: false, enabled: false } });
    const view = render(SettingsView);

    expect(await view.findByRole('checkbox', { name: unlock })).toBeDisabled();
    expect(view.getByText('Set up a fingerprint or face in the system settings to use this.')).toBeInTheDocument();
  });

  it('goes back to the old setting, and says why, when the change is refused', async () => {
    vi.mocked(redmineApi.getCredentialOptions).mockResolvedValue({ biometric: { available: true, enabled: true } });
    vi.mocked(redmineApi.setBiometricUnlock).mockRejectedValue(new Error('The unlock did not finish: Cancel'));
    const view = render(SettingsView);
    const box = await view.findByRole('checkbox', { name: unlock });

    await fireEvent.click(box);

    expect(box).toBeChecked();
    expect(await view.findByRole('alert')).toHaveTextContent('The change was not saved: The unlock did not finish: Cancel');
  });
});

