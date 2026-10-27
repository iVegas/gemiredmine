// Runs the endpoint that AI agents connect to (src-tauri/src/mcp.rs) from the main window. The endpoint forwards each
// request here, as an event; this answers it from the servers the user has added, and hands the answer back. It also
// keeps the changes that agents propose until the user approves or rejects them.
//
// Only the main window does this. The endpoint sends its requests to that window alone, and the servers and their API
// keys live in that window's store.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get, writable } from 'svelte/store';
import { answerMcp } from '../../bun/mcp/protocol';
import { MAX_WAITING_PROPOSALS, type McpHost, type McpServerInfo, type Proposal, type ProposalStatus } from '../../bun/mcp/host';
import { runProposal } from '../../bun/mcp/proposals';
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

/** The changes that agents proposed, the newest first. The app keeps them in its database, see `loadAgentProposals`. */
export const agentProposals = writable<Proposal[]>([]);

/** An id that no earlier change has, since the changes outlive a run of the app. */
const newProposalId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Keeps a change as it is now. A failure is reported in the developer preview; the change stays on screen. */
function saveProposal(proposal: Proposal) {
  redmineApi.saveAgentProposal(proposal).catch((error: unknown) =>
    redmineApi
      .recordDiagnostic('error', 'mcp', `A proposed change could not be kept: ${error instanceof Error ? error.message : String(error)}`)
      .catch(() => undefined)
  );
}

function setProposal(id: string, patch: Partial<Proposal>) {
  agentProposals.update((list) => list.map((proposal) => (proposal.id === id ? { ...proposal, ...patch } : proposal)));
  const updated = get(agentProposals).find((proposal) => proposal.id === id);
  if (updated) saveProposal(updated);
}

/**
 * Loads the changes the app kept. A change that was running when the app stopped is marked failed: whether Redmine
 * took it is not known, so it is not run again. The user checks Redmine and proposes it again if it is missing.
 */
export async function loadAgentProposals(): Promise<void> {
  const kept = await redmineApi.listAgentProposals();
  const interrupted = kept.filter((proposal) => proposal.status === 'running');
  const restored = kept.map((proposal) =>
    proposal.status === 'running'
      ? { ...proposal, status: 'failed' as const, outcome: 'The app stopped before this change finished. Check Redmine before you propose it again.' }
      : proposal
  );
  for (const proposal of interrupted) saveProposal(restored.find((candidate) => candidate.id === proposal.id)!);
  agentProposals.update((list) => [...list.filter((proposal) => !restored.some((kept) => kept.id === proposal.id)), ...restored]);
}

/** Changes that have not been decided yet, which count against the limit. */
const undecided = () => get(agentProposals).filter((proposal) => proposal.status === 'waiting' || proposal.status === 'running').length;

/** What the tools see of the servers and of the proposals. The API key is handed out only for a request that needs it. */
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
  propose({ serverId, serverName, change, summary }) {
    if (undecided() >= MAX_WAITING_PROPOSALS) {
      throw new Error(
        `${MAX_WAITING_PROPOSALS} changes are already waiting for the user. Ask the user to approve or reject some of them first.`
      );
    }
    const proposal: Proposal = {
      id: newProposalId(),
      serverId,
      serverName,
      change,
      summary,
      status: 'waiting',
      outcome: null,
      createdAt: new Date().toISOString(),
    };
    agentProposals.update((list) => [proposal, ...list]);
    saveProposal(proposal);
    return proposal;
  },
  proposal(id: string): Proposal | null {
    return get(agentProposals).find((proposal) => proposal.id === id) ?? null;
  },
};

/** Runs a waiting change with the user's own key, once the user has approved it. */
export async function approveAgentProposal(id: string): Promise<void> {
  const proposal = get(agentProposals).find((candidate) => candidate.id === id);
  if (!proposal || proposal.status !== 'waiting') return;
  setProposal(id, { status: 'running' });
  const finish = (status: ProposalStatus, outcome: string) => setProposal(id, { status, outcome });
  const access = storeHost.access(proposal.serverId);
  if (!access) {
    finish('failed', `You are no longer signed in to ${proposal.serverName}. Sign in to it, then propose the change again.`);
    return;
  }
  try {
    finish('done', await runProposal(proposal, access, redmineApi));
  } catch (error) {
    finish('failed', error instanceof Error ? error.message : String(error));
  }
}

/** Declines a waiting change. Nothing is sent to Redmine. */
export function rejectAgentProposal(id: string): void {
  const proposal = get(agentProposals).find((candidate) => candidate.id === id);
  if (proposal?.status === 'waiting') setProposal(id, { status: 'rejected', outcome: 'You rejected it.' });
}

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
 * Replaces the token. The one that was given out stops working at once, and a running endpoint is restarted with the
 * new one. Rejects with the reason when the store cannot be used.
 */
export async function resetAgentToken(): Promise<string> {
  try {
    return await invoke<string>('mcp_reset_token');
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error));
  }
}

/**
 * Starts the endpoint at launch when the user turned it on. Nothing is started otherwise, and a failure is recorded in
 * the developer preview, where the settings page can show it later.
 */
export async function restoreAgentEndpoint(): Promise<void> {
  if (!agentsAvailable()) return;
  // The changes waiting for approval are shown even while the endpoint is off, so they are loaded first.
  await loadAgentProposals().catch((error: unknown) =>
    redmineApi
      .recordDiagnostic('error', 'mcp', `The proposed changes could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
      .catch(() => undefined)
  );
  try {
    const settings: AgentSettings = await redmineApi.getAgentSettings();
    if (settings.enabled) await startAgentEndpoint(settings.port);
  } catch (error) {
    await redmineApi
      .recordDiagnostic('error', 'mcp', `The agent endpoint did not start: ${error instanceof Error ? error.message : String(error)}`)
      .catch(() => undefined);
  }
}
