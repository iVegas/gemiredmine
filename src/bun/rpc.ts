import { BrowserView } from 'electrobun';
import type { GemiRPCSchema, ServerAccess } from '../shared/rpc';
import { RedmineClient, assertHttpUrl } from './redmine/client';
import { signInWithPassword } from './redmine/auth';

// Redmine calls run here, not in the webview, because Redmine servers do not send CORS headers.
function clientFor({ baseUrl, apiKey }: ServerAccess): RedmineClient {
  return new RedmineClient({ baseUrl: assertHttpUrl(baseUrl), apiKey });
}

export type AppRPC = ReturnType<typeof BrowserView.defineRPC<GemiRPCSchema>>;

export const rpc: AppRPC = BrowserView.defineRPC<GemiRPCSchema>({
  handlers: {
    requests: {
      signIn: ({ baseUrl, username, password }) => signInWithPassword(baseUrl, username, password),

      getCurrentUser: async (access) => {
        const { user } = await clientFor(access).getCurrentUser();
        return { id: user.id, login: user.login, firstname: user.firstname, lastname: user.lastname };
      },

      listTimeEntries: ({ baseUrl, apiKey, from, to }) =>
        clientFor({ baseUrl, apiKey }).getTimeEntries({ from, to }),

      listOpenTasks: ({ baseUrl, apiKey, dueFrom, dueTo }) =>
        clientFor({ baseUrl, apiKey }).getAssignedOpenIssues({ dueFrom, dueTo })
    }
  }
});
