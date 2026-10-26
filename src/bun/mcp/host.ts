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

export interface McpHost {
  servers(): McpServerInfo[];
  /** The address and API key of a server that the user is signed in to, or null. Used to make a request, never returned. */
  access(serverId: string): ServerAccess | null;
}

/** The Redmine calls the tools make. */
export type McpApi = Pick<GemiBackend, 'listAssignedTasks' | 'getTask' | 'listTaskLogEntries'>;

export interface McpDeps {
  host: McpHost;
  api: McpApi;
  /** The app's version, which the initialize reply names. */
  version: string;
}
