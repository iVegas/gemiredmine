import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { redmineApi } from '../api';
import { hasDesktopBackend } from '../bridge';
import { isAndroidWebview } from '../tauri-platform';
import { activeServerId, servers } from '../store';
import { currentLabel } from '../window-transport';
import {
  agentsAvailable,
  agentToken,
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
    getTask: vi.fn(),
    listTaskLogEntries: vi.fn(async () => []),
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
