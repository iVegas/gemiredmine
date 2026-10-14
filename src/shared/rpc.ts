// Typed contract between the Bun backend (src/bun) and the webview (src/mainview).
// Type-only imports keep this file free of runtime code on either side.
import type { RPCSchema } from 'electrobun/view';
import type { RedmineIssue, RedmineTimeEntry, RedmineUser } from '../bun/redmine/types';
import type { DevPreviewStatus, FeedbackResult } from '../bun/diagnostics/service';
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

export type GemiRPCSchema = {
  bun: RPCSchema<{
    requests: {
      signIn: { params: SignInParams; response: SignInResponse };
      getCurrentUser: { params: ServerAccess; response: CurrentUserSummary };
      listTimeEntries: { params: ServerAccess & DateRange; response: RedmineTimeEntry[] };
      listOpenTasks: {
        params: ServerAccess & { dueFrom: string; dueTo: string };
        response: RedmineIssue[];
      };
      listAssignedTasks: { params: ServerAccess; response: RedmineIssue[] };
      getDevPreviewStatus: { params: void; response: DevPreviewStatus };
      setDevPreviewEnabled: { params: { enabled: boolean }; response: DevPreviewStatus };
      recordDiagnostic: { params: { level: LogLevel; scope: string; message: string }; response: void };
      createFeedback: {
        params: { title: string; description: string; includeLogs: boolean };
        response: FeedbackResult;
      };
      openIssueLink: { params: { url: string }; response: void };
    };
  }>;
  webview: RPCSchema;
};
