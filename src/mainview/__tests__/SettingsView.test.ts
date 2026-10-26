import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import SettingsView from '../SettingsView.svelte';
import { servers, activeServerId } from '../lib/store';
import { activeView, openView, resetViews } from '../lib/views';
import { redmineApi } from '../lib/api';
import { agentsAvailable, startAgentEndpoint, stopAgentEndpoint } from '../lib/mcp-host';

vi.mock('../lib/mcp-host', () => ({
  agentsAvailable: vi.fn(() => false),
  startAgentEndpoint: vi.fn(async () => {}),
  stopAgentEndpoint: vi.fn(async () => {}),
  agentToken: vi.fn(async () => 'token-123'),
}));

vi.mock('../lib/api', () => ({
  redmineApi: {
    signIn: vi.fn(),
    getCurrentUser: vi.fn(),
    listTimeEntries: vi.fn(),
    listOpenTasks: vi.fn(),
    listAssignedTasks: vi.fn(),
    getCredentialOptions: vi.fn(async () => ({ biometric: null })),
    setBiometricUnlock: vi.fn(async () => {}),
    getAgentSettings: vi.fn(async () => ({ enabled: false, port: 47831 })),
    saveAgentSettings: vi.fn(async () => {}),
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

describe('SettingsView: AI agents', () => {
  beforeEach(() => {
    servers.set([dev, prod]);
    activeServerId.set('1');
    resetViews();
    vi.mocked(agentsAvailable).mockReturnValue(true);
    vi.mocked(redmineApi.getAgentSettings).mockResolvedValue({ enabled: false, port: 47831 });
    vi.mocked(redmineApi.saveAgentSettings).mockReset().mockResolvedValue(undefined);
    vi.mocked(startAgentEndpoint).mockReset().mockResolvedValue(undefined);
    vi.mocked(stopAgentEndpoint).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.mocked(agentsAvailable).mockReturnValue(false);
  });

  it('is not shown where the app cannot run an endpoint', async () => {
    vi.mocked(agentsAvailable).mockReturnValue(false);
    const view = render(SettingsView);
    await vi.waitFor(() => expect(view.queryByRole('heading', { name: 'AI agents' })).toBeNull());

    expect(redmineApi.getAgentSettings).not.toHaveBeenCalled();
  });

  it('shows the switch and the port, off, with the default port', async () => {
    const view = render(SettingsView);

    expect(await view.findByRole('checkbox', { name: 'Let AI agents connect on this computer' })).not.toBeChecked();
    expect(view.getByLabelText('Port on 127.0.0.1')).toHaveValue(47831);
    expect(view.queryByText(/mcp$/)).toBeNull();
  });

  it('starts the endpoint and shows where to connect and the token, once turned on', async () => {
    const view = render(SettingsView);
    const box = await view.findByRole('checkbox', { name: 'Let AI agents connect on this computer' });

    await fireEvent.click(box);

    expect(startAgentEndpoint).toHaveBeenCalledWith(47831);
    expect(redmineApi.saveAgentSettings).toHaveBeenCalledWith({ enabled: true, port: 47831 });
    expect(await view.findByText('http://127.0.0.1:47831/mcp')).toBeInTheDocument();
    // The token stays hidden until the user asks to see it.
    expect(view.queryByText('token-123', { exact: false })).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'Show' }));
    // Shown in the token field and in the example command.
    expect(view.getAllByText('token-123', { exact: false })).toHaveLength(2);
    expect(box).toBeChecked();
  });

  it('keeps the endpoint off, and says why, when it cannot start', async () => {
    vi.mocked(startAgentEndpoint).mockRejectedValue(new Error('Port 47831 is not free for the MCP endpoint.'));
    const view = render(SettingsView);
    const box = await view.findByRole('checkbox', { name: 'Let AI agents connect on this computer' });

    await fireEvent.click(box);

    expect(box).not.toBeChecked();
    expect(redmineApi.saveAgentSettings).not.toHaveBeenCalled();
    expect(await view.findByRole('alert')).toHaveTextContent(
      'The agent endpoint could not be started: Port 47831 is not free for the MCP endpoint.'
    );
  });

  it('refuses a port outside 1024 to 65535 and goes back to the port that works', async () => {
    const view = render(SettingsView);
    const port = await view.findByLabelText('Port on 127.0.0.1');

    await fireEvent.input(port, { target: { value: '80' } });
    await fireEvent.change(port);

    expect(await view.findByRole('alert')).toHaveTextContent('The port must be a whole number from 1024 to 65535.');
    expect(port).toHaveValue(47831);
    expect(redmineApi.saveAgentSettings).not.toHaveBeenCalled();
  });

  it('starts again when it is shown while on, so that a failure at launch is seen', async () => {
    vi.mocked(redmineApi.getAgentSettings).mockResolvedValue({ enabled: true, port: 47831 });
    vi.mocked(startAgentEndpoint).mockRejectedValue(new Error('Port 47831 is not free for the MCP endpoint.'));

    const view = render(SettingsView);

    expect(await view.findByRole('alert')).toHaveTextContent('The agent endpoint could not be started: Port 47831');
    expect(startAgentEndpoint).toHaveBeenCalledWith(47831);
  });
});

