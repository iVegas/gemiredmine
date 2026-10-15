// What the user interface asks of the backend: the Redmine calls and the developer preview.
// The desktop shell answers over RPC (see rpc.ts); a backend that runs inside the webview
// implements the same interface. Type-only imports keep this file free of runtime code.
import type { RedmineIssue, RedmineTimeEntry, RedmineUser } from '../bun/redmine/types';
import type { DevPreviewStatus, FeedbackResult } from '../bun/diagnostics/service';
import type { FeedbackInput } from '../bun/diagnostics/feedback';
import type { LogLevel } from '../bun/diagnostics/aggregator';

/** Identifies a Redmine server and the API key the webview holds for it. */
export interface ServerAccess {
  baseUrl: string;
  apiKey: string;
}

export interface DateRange {
  /** YYYY-MM-DD, inclusive */
  from: string;
  /** YYYY-MM-DD, inclusive */
  to: string;
}

export interface DueRange {
  /** YYYY-MM-DD, inclusive */
  dueFrom: string;
  /** YYYY-MM-DD, inclusive */
  dueTo: string;
}

export interface SignInParams {
  baseUrl: string;
  username: string;
  password: string;
}

export interface SignInResponse {
  apiKey: string;
  user: { id: number; login: string; firstname: string; lastname: string };
}

export type CurrentUserSummary = Pick<RedmineUser, 'id' | 'login' | 'firstname' | 'lastname'>;

/** A Redmine server as it is kept between runs of the app. The API key is deliberately not part of it: see `GemiBackend.saveCredential`. */
export interface SavedServer {
  id: string;
  name: string;
  url: string;
  /** Whether the user chose to be remembered: the API key is kept in the system's credential store, not with the server. */
  remember: boolean;
  /** Who signed in last, so that the sign-in form can start with the user name. */
  user?: CurrentUserSummary;
}

export interface SavedServers {
  /** In the order the user sees them */
  servers: SavedServer[];
  activeServerId: string | null;
}

export interface LoadedCredentials {
  /** By server id */
  apiKeys: Record<string, string>;
  /** Why the store could not be read, in words for the user, or null. Keys found before the problem are in `apiKeys`. */
  problem: string | null;
}

export interface GemiBackend {
  signIn(params: SignInParams): Promise<SignInResponse>;
  getCurrentUser(access: ServerAccess): Promise<CurrentUserSummary>;
  listTimeEntries(access: ServerAccess, range: DateRange): Promise<RedmineTimeEntry[]>;
  listOpenTasks(access: ServerAccess, dueRange: DueRange): Promise<RedmineIssue[]>;
  listAssignedTasks(access: ServerAccess): Promise<RedmineIssue[]>;
  getDevPreviewStatus(): Promise<DevPreviewStatus>;
  setDevPreviewEnabled(enabled: boolean): Promise<DevPreviewStatus>;
  recordDiagnostic(level: LogLevel, scope: string, message: string): Promise<void>;
  createFeedback(input: FeedbackInput): Promise<FeedbackResult>;
  openIssueLink(url: string): Promise<void>;
  /** The servers saved by an earlier run, and which one was active. Rejects when the app has no storage. */
  loadSavedServers(): Promise<SavedServers>;
  /** Makes the saved servers equal to `saved`: servers that are not in it are forgotten. */
  saveServers(saved: SavedServers): Promise<void>;
  /** The API keys that the system's credential store holds for these servers. Servers that have none are left out. */
  loadCredentials(serverIds: string[]): Promise<LoadedCredentials>;
  /** Keeps the API key of a server in the system's credential store. Rejects when the store cannot be used. */
  saveCredential(serverId: string, apiKey: string): Promise<void>;
  /** Forgets the API key of a server. A server that has none is fine. */
  deleteCredential(serverId: string): Promise<void>;
}
