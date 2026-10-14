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
}
