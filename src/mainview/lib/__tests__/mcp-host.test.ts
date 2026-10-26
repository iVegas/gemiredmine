import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { MAX_WAITING_PROPOSALS } from '../../../bun/mcp/host';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { redmineApi } from '../api';
import { hasDesktopBackend } from '../bridge';
import { isAndroidWebview } from '../tauri-platform';
import { activeServerId, servers } from '../store';
import { get as readStore } from 'svelte/store';
import { currentLabel } from '../window-transport';
import {
  agentProposals,
  agentsAvailable,
  agentToken,
  approveAgentProposal,
  rejectAgentProposal,
  resetAgentToken,
  restoreAgentEndpoint,
  startAgentEndpoint,
  storeHost,
  stopAgentEndpoint,
} from '../mcp-host';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../api', () => ({
  redmineApi: {
    getAgentSettings: vi.fn(),
    recordDiagnostic: vi.fn(async () => {}),
    listAssignedTasks: vi.fn(async () => []),
    getTask: vi.fn(async (_access: unknown, taskId: number) => ({
      issue: { id: taskId, subject: 'Fix login', status: { id: 1, name: 'New' }, priority: { id: 2, name: 'Normal' } },
      names: {},
    })),
    listTaskLogEntries: vi.fn(async () => []),
    createLogEntry: vi.fn(async () => {}),
    updateTask: vi.fn(async () => {}),
  },
}));
vi.mock('../bridge', () => ({ hasDesktopBackend: vi.fn(() => true) }));
vi.mock('../tauri-platform', () => ({ isAndroidWebview: vi.fn(() => false) }));
vi.mock('../window-transport', () => ({ MAIN_LABEL: 'main', currentLabel: vi.fn(() => 'main') }));

const KEY = 'secret-api-key-0123456789abcdef0123';

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(listen).mockReset();
  vi.mocked(redmineApi.getAgentSettings).mockReset();
  vi.mocked(redmineApi.recordDiagnostic).mockClear();
  vi.mocked(hasDesktopBackend).mockReturnValue(true);
  vi.mocked(isAndroidWebview).mockReturnValue(false);
  vi.mocked(currentLabel).mockReturnValue('main');
  servers.set([
    { id: 'srv-1', name: 'Work', url: 'https://redmine.work.example', apiToken: KEY, user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'K' } } as never,
    { id: 'srv-2', name: 'Home', url: 'https://home.example' } as never,
  ]);
  activeServerId.set('srv-1');
});

describe('what the endpoint can see of the servers', () => {
  it('lists the servers without their API keys, and says which one is shown', () => {
    const listed = storeHost.servers();

    expect(listed).toEqual([
      { id: 'srv-1', name: 'Work', url: 'https://redmine.work.example', signedIn: true, login: 'ana', active: true },
      { id: 'srv-2', name: 'Home', url: 'https://home.example', signedIn: false, login: undefined, active: false },
    ]);
    expect(JSON.stringify(listed)).not.toContain(KEY);
  });

  it('gives the access of a signed-in server to a request, and none for one the user is not signed in to', () => {
    expect(storeHost.access('srv-1')).toEqual({ baseUrl: 'https://redmine.work.example', apiKey: KEY });
    expect(storeHost.access('srv-2')).toBeNull();
    expect(storeHost.access('unknown')).toBeNull();
  });

  it('follows the store: a sign-out is seen at once', () => {
    servers.update((list) => list.map((server) => (server.id === 'srv-1' ? { ...server, apiToken: undefined } : server)));

    expect(storeHost.access('srv-1')).toBeNull();
    expect(get(servers)[0].apiToken).toBeUndefined();
  });
});

describe('answering the requests the endpoint forwards', () => {
  // The window listens once, for its whole life, so the listener is captured by the first start and used by every test.
  let answer: (event: { payload: { id: number; body: string } }) => Promise<void>;

  beforeAll(async () => {
    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      answer = callback as typeof answer;
      return () => {};
    });
    await startAgentEndpoint(47831);
  });

  it('answers a request with the reply, under the id it came with', async () => {
    vi.mocked(invoke).mockClear();

    await answer({ payload: { id: 4, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) } });

    expect(invoke).toHaveBeenCalledWith('mcp_respond', { id: 4, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) });
  });

  it('sends nothing back for a notification, so the endpoint replies with no body', async () => {
    vi.mocked(invoke).mockClear();

    await answer({ payload: { id: 9, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) } });

    expect(invoke).toHaveBeenCalledWith('mcp_respond', { id: 9, body: '' });
  });

  it('does not register a second listener when the endpoint is started again', async () => {
    vi.mocked(listen).mockClear();
    vi.mocked(invoke).mockClear();

    await startAgentEndpoint(47831);

    expect(listen).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('mcp_start', { port: 47831 });
  });
});

describe('starting and stopping the endpoint', () => {
  it('passes the reason on when the endpoint cannot start, such as a port in use', async () => {
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(invoke).mockRejectedValue('Port 47831 is not free for the MCP endpoint: address in use');

    await expect(startAgentEndpoint(47831)).rejects.toThrow('Port 47831 is not free for the MCP endpoint: address in use');
  });

  it('stops it, and reads the token only when it is asked for', async () => {
    await stopAgentEndpoint();
    expect(invoke).toHaveBeenLastCalledWith('mcp_stop');

    vi.mocked(invoke).mockResolvedValueOnce('a-token');
    expect(await agentToken()).toBe('a-token');
    expect(invoke).toHaveBeenLastCalledWith('mcp_token');
  });
});

describe('where the endpoint runs', () => {
  it('runs only in the desktop app, in the main window, and never on Android', () => {
    expect(agentsAvailable()).toBe(true);

    vi.mocked(currentLabel).mockReturnValue('view-todo');
    expect(agentsAvailable()).toBe(false);

    vi.mocked(currentLabel).mockReturnValue('main');
    vi.mocked(isAndroidWebview).mockReturnValue(true);
    expect(agentsAvailable()).toBe(false);

    vi.mocked(isAndroidWebview).mockReturnValue(false);
    vi.mocked(hasDesktopBackend).mockReturnValue(false);
    expect(agentsAvailable()).toBe(false);
  });
});

describe('starting the endpoint at launch', () => {
  it('starts it on the saved port when the user turned it on', async () => {
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(redmineApi.getAgentSettings).mockResolvedValue({ enabled: true, port: 50001 });

    await restoreAgentEndpoint();

    expect(invoke).toHaveBeenCalledWith('mcp_start', { port: 50001 });
  });

  it('does nothing when the user did not turn it on', async () => {
    vi.mocked(redmineApi.getAgentSettings).mockResolvedValue({ enabled: false, port: 47831 });

    await restoreAgentEndpoint();

    expect(invoke).not.toHaveBeenCalled();
  });

  it('records why it did not start, and carries on', async () => {
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(redmineApi.getAgentSettings).mockResolvedValue({ enabled: true, port: 47831 });
    vi.mocked(invoke).mockRejectedValue('Port 47831 is not free for the MCP endpoint.');

    await restoreAgentEndpoint();

    expect(redmineApi.recordDiagnostic).toHaveBeenCalledWith(
      'error',
      'mcp',
      'The agent endpoint did not start: Port 47831 is not free for the MCP endpoint.'
    );
  });

  it('does nothing outside the desktop app, where there are no settings to read', async () => {
    vi.mocked(hasDesktopBackend).mockReturnValue(false);

    await restoreAgentEndpoint();

    expect(redmineApi.getAgentSettings).not.toHaveBeenCalled();
  });
});

describe('the changes that wait for the user', () => {
  const change = { kind: 'log_time' as const, taskId: 7, spentOn: '2026-10-20', hours: 1, activityId: 9, comments: '' };

  beforeEach(() => {
    agentProposals.set([]);
    vi.mocked(redmineApi.createLogEntry).mockReset().mockResolvedValue(undefined);
  });

  it('keeps a proposed change as waiting, for the server it is about', () => {
    const proposed = storeHost.propose({ serverId: 'srv-1', serverName: 'Work', change, summary: 'Log 1 h' });

    expect(proposed).toMatchObject({ serverId: 'srv-1', serverName: 'Work', status: 'waiting', outcome: null, summary: 'Log 1 h' });
    expect(storeHost.proposal(proposed.id)).toEqual(proposed);
    expect(readStore(agentProposals)).toHaveLength(1);
    expect(redmineApi.createLogEntry).not.toHaveBeenCalled();
  });

  it('saves an approved change with the key of its server, and records what it did', async () => {
    const proposed = storeHost.propose({ serverId: 'srv-1', serverName: 'Work', change, summary: 'Log 1 h' });

    await approveAgentProposal(proposed.id);

    expect(redmineApi.createLogEntry).toHaveBeenCalledExactlyOnceWith(
      { baseUrl: 'https://redmine.work.example', apiKey: KEY },
      { taskId: 7, spentOn: '2026-10-20', hours: 1, activityId: 9, comments: '' }
    );
    expect(storeHost.proposal(proposed.id)).toMatchObject({ status: 'done', outcome: 'Logged 1 h on task #7.' });
  });

  it('fails an approved change when the user is no longer signed in, without calling Redmine', async () => {
    const proposed = storeHost.propose({ serverId: 'srv-2', serverName: 'Home', change, summary: 'Log 1 h' });

    await approveAgentProposal(proposed.id);

    expect(redmineApi.createLogEntry).not.toHaveBeenCalled();
    expect(storeHost.proposal(proposed.id)).toMatchObject({ status: 'failed' });
    expect(storeHost.proposal(proposed.id)?.outcome).toContain('no longer signed in to Home');
  });

  it('records why Redmine refused an approved change', async () => {
    vi.mocked(redmineApi.createLogEntry).mockRejectedValue(new Error('Redmine does not let you log time on this task.'));
    const proposed = storeHost.propose({ serverId: 'srv-1', serverName: 'Work', change, summary: 'Log 1 h' });

    await approveAgentProposal(proposed.id);

    expect(storeHost.proposal(proposed.id)).toMatchObject({
      status: 'failed',
      outcome: 'Redmine does not let you log time on this task.',
    });
  });

  it('rejects a change without calling Redmine, and leaves a decided change as it is', async () => {
    const proposed = storeHost.propose({ serverId: 'srv-1', serverName: 'Work', change, summary: 'Log 1 h' });

    rejectAgentProposal(proposed.id);
    await approveAgentProposal(proposed.id);

    expect(storeHost.proposal(proposed.id)).toMatchObject({ status: 'rejected' });
    expect(redmineApi.createLogEntry).not.toHaveBeenCalled();
  });

  it('asks an agent to wait when too many changes are undecided, and frees a place when one is decided', () => {
    const ids = Array.from({ length: MAX_WAITING_PROPOSALS }, () =>
      storeHost.propose({ serverId: 'srv-1', serverName: 'Work', change, summary: 'Log 1 h' }).id
    );

    expect(() => storeHost.propose({ serverId: 'srv-1', serverName: 'Work', change, summary: 'Log 1 h' })).toThrow(
      `${MAX_WAITING_PROPOSALS} changes are already waiting for the user.`
    );

    rejectAgentProposal(ids[0]);
    expect(() => storeHost.propose({ serverId: 'srv-1', serverName: 'Work', change, summary: 'Log 1 h' })).not.toThrow();
  });

  it('gives no proposal for an id it does not have', () => {
    expect(storeHost.proposal('p-missing')).toBeNull();
  });
});

describe('replacing the token', () => {
  it('asks the app for a new token, and gives it back', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('new-token');

    expect(await resetAgentToken()).toBe('new-token');
    expect(invoke).toHaveBeenLastCalledWith('mcp_reset_token');
  });

  it('passes on the reason when the token cannot be replaced', async () => {
    vi.mocked(invoke).mockRejectedValueOnce("The system's credential store did not accept the request.");

    await expect(resetAgentToken()).rejects.toThrow("The system's credential store did not accept the request.");
  });
});

