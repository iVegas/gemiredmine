// What the MCP endpoint needs from the app, and what the app hands to it. The module that answers the messages knows
// nothing else: the servers and their API keys come in through McpHost, and the Redmine calls through McpApi. A test
// can therefore give it a fake server, and the keys never leave the code that makes the requests.

import type { GemiBackend, ServerAccess } from '../../shared/backend';

/** One server the user has added, as an agent may see it. It never carries the API key. */
export interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  /** Whether the user is signed in to it, so that the tools can reach it. */
  signedIn: boolean;
  /** The user's login on the server, when it is known. */
  login?: string;
  /** Whether this is the server the app shows. Tools use it when an agent does not name a server. */
  active: boolean;
}

/**
 * A change that an agent asks for. It does nothing until the user approves it in the app: the agent only proposes it.
 * A status is named by its id here, because the tool resolved the name when it proposed the change.
 */
export type ProposedChange =
  | {
      kind: 'log_time';
      taskId: number;
      /** YYYY-MM-DD */
      spentOn: string;
      hours: number;
      activityId: number;
      comments: string;
    }
  | {
      kind: 'update_task';
      taskId: number;
      statusId: number | null;
      doneRatio: number | null;
      notes: string;
    };

export type ProposalStatus = 'waiting' | 'running' | 'done' | 'failed' | 'rejected';

/** A change that waits for the user, and what became of it. */
export interface Proposal {
  id: string;
  serverId: string;
  serverName: string;
  change: ProposedChange;
  /** A sentence the user can read before approving. */
  summary: string;
  status: ProposalStatus;
  /** What happened when the change ran: its result, or the reason it failed. Null until then. */
  outcome: string | null;
  createdAt: string;
}

/** The most changes that may wait for the user at once. Beyond it an agent is asked to wait for the user first. */
export const MAX_WAITING_PROPOSALS = 20;

export interface McpHost {
  servers(): McpServerInfo[];
  /** The address and API key of a server that the user is signed in to, or null. Used to make a request, never returned. */
  access(serverId: string): ServerAccess | null;
  /**
   * Keeps a change for the user to approve. Rejects when too many changes are already waiting.
   */
  propose(input: { serverId: string; serverName: string; change: ProposedChange; summary: string }): Proposal;
  /** One proposal by its id, or null when there is none. */
  proposal(id: string): Proposal | null;
}

/** The Redmine calls the tools make, and the ones a proposal makes when the user approves it. */
export type McpApi = Pick<
  GemiBackend,
  'listAssignedTasks' | 'getTask' | 'listTaskLogEntries' | 'listTimeActivities' | 'listTaskOptions' | 'createLogEntry' | 'updateTask'
>;

export interface McpDeps {
  host: McpHost;
  api: McpApi;
  /** The app's version, which the initialize reply names. */
  version: string;
}
