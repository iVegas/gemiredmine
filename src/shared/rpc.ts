// Typed contract between the Bun backend (src/bun) and the webview (src/mainview).
// Type-only imports keep this file free of runtime code on either side.
import type { RPCSchema } from 'electrobun/view';
import type { RedmineIssue, RedmineTimeEntry, RedmineUser } from '../bun/redmine/types';

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
    };
  }>;
  webview: RPCSchema;
};
