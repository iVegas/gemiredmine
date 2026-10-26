// Runs the endpoint that AI agents connect to (src-tauri/src/mcp.rs) from the main window. The endpoint forwards each
// request here, as an event; this answers it from the servers the user has added, and hands the answer back.
//
// Only the main window does this. The endpoint sends its requests to that window alone, and the servers and their API
// keys live in that window's store.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { answerMcp } from '../../bun/mcp/protocol';
import type { McpHost, McpServerInfo } from '../../bun/mcp/host';
import type { AgentSettings } from '../../shared/agents';
import { buildInfo } from '../../shared/build-info.generated';
import type { ServerAccess } from '../../shared/backend';
import { redmineApi } from './api';
import { hasDesktopBackend } from './bridge';
import { activeServerId, servers } from './store';
import { isAndroidWebview } from './tauri-platform';
import { MAIN_LABEL, currentLabel } from './window-transport';

/** The event that carries a request from the endpoint, as {id, body}. */
const REQUEST_EVENT = 'mcp-request';

/** Whether this window can run the endpoint: the desktop app's main window. Android has no endpoint. */
export const agentsAvailable = (): boolean => hasDesktopBackend() && !isAndroidWebview() && currentLabel() === MAIN_LABEL;

/** What the tools see of the servers. The API key is handed out only for a request that needs it. */
export const storeHost: McpHost = {
  servers(): McpServerInfo[] {
    const active = get(activeServerId);
    return get(servers).map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      signedIn: Boolean(server.apiToken),
      login: server.user?.login,
      active: server.id === active,
    }));
  },
  access(serverId: string): ServerAccess | null {
    const server = get(servers).find((candidate) => candidate.id === serverId);
    return server?.apiToken ? { baseUrl: server.url, apiKey: server.apiToken } : null;
  },
};

let listening: Promise<UnlistenFn> | null = null;

/** Answers each forwarded request once, for as long as the window lives. */
function listenForRequests(): Promise<UnlistenFn> {
  listening ??= listen<{ id: number; body: string }>(REQUEST_EVENT, async ({ payload }) => {
    const reply = await answerMcp(payload.body, { host: storeHost, api: redmineApi, version: buildInfo.version });
    // A reply that cannot be handed back leaves the agent waiting until its own timeout. Nothing else can be done about it.
    await invoke('mcp_respond', { id: payload.id, body: reply }).catch(() => undefined);
  });
  return listening;
}

/** Starts the endpoint on a port, or moves it to another port. Rejects with the reason, such as a port in use. */
export async function startAgentEndpoint(port: number): Promise<void> {
  await listenForRequests();
  try {
    await invoke('mcp_start', { port });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error));
  }
}

export async function stopAgentEndpoint(): Promise<void> {
  await invoke('mcp_stop');
}

/** The bearer token that an agent must send. It is made on first use and kept in the system's credential store. */
export async function agentToken(): Promise<string> {
  return invoke<string>('mcp_token');
}

/**
 * Starts the endpoint at launch when the user turned it on. Nothing is started otherwise, and a failure is recorded in
 * the developer preview, where the settings page can show it later.
 */
export async function restoreAgentEndpoint(): Promise<void> {
  if (!agentsAvailable()) return;
  try {
    const settings: AgentSettings = await redmineApi.getAgentSettings();
    if (settings.enabled) await startAgentEndpoint(settings.port);
  } catch (error) {
    await redmineApi
      .recordDiagnostic('error', 'mcp', `The agent endpoint did not start: ${error instanceof Error ? error.message : String(error)}`)
      .catch(() => undefined);
  }
}
