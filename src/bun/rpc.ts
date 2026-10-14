import { BrowserView, Utils } from 'electrobun';
import type { GemiRPCSchema, ServerAccess, WindowRequestHandlers } from '../shared/rpc';
import { DEV_PREVIEW_AVAILABLE, buildInfo } from '../shared/build-info.generated';
import { RedmineClient, assertHttpUrl } from './redmine/client';
import { signInWithPassword } from './redmine/auth';
import { dataDirFor } from './paths';
import { DevPreview } from './dev-preview.generated';

// Redmine calls run here, not in the webview, because Redmine servers do not send CORS headers.
function clientFor({ baseUrl, apiKey }: ServerAccess): RedmineClient {
  return new RedmineClient({ baseUrl: assertHttpUrl(baseUrl), apiKey });
}

let devPreviewInstance: DevPreview | undefined;

/** The developer preview. Throws in builds that do not offer it, where DevPreview is a stub. */
async function devPreview(): Promise<DevPreview> {
  if (!DEV_PREVIEW_AVAILABLE) {
    throw new Error('The developer preview is not available in this build.');
  }
  if (!devPreviewInstance) {
    devPreviewInstance = new DevPreview({
      dataDir: dataDirFor(buildInfo.dataDirName),
      available: true,
      repositoryUrl: buildInfo.repositoryUrl,
      environment: {
        productName: buildInfo.productName,
        version: buildInfo.version,
        channel: buildInfo.channel,
        commit: buildInfo.commit,
        buildDate: buildInfo.buildDate,
        platform: process.platform,
        arch: process.arch,
        runtime: `bun ${process.versions.bun ?? 'unknown'}`,
      },
    });
  }
  return devPreviewInstance;
}

/** Failed requests are recorded in the developer preview log, when it is enabled. */
async function traceFailure(scope: string, error: unknown): Promise<void> {
  if (!DEV_PREVIEW_AVAILABLE) return;
  (await devPreview()).record({
    level: 'error',
    scope,
    message: error instanceof Error ? error.message : String(error),
  });
}

function traced<P, R>(scope: string, handler: (params: P) => Promise<R>) {
  return async (params: P): Promise<R> => {
    try {
      return await handler(params);
    } catch (error) {
      await traceFailure(scope, error);
      throw error;
    }
  };
}

export type AppRPC = ReturnType<typeof BrowserView.defineRPC<GemiRPCSchema>>;

/** The RPC for one window's webview. `windowRequests` answer that window's requests about windows. */
export function createRpc(windowRequests: WindowRequestHandlers): AppRPC {
  return BrowserView.defineRPC<GemiRPCSchema>({
    handlers: {
      requests: {
        signIn: traced('signIn', ({ baseUrl, username, password }) => signInWithPassword(baseUrl, username, password)),

        getCurrentUser: traced('getCurrentUser', async (access) => {
          const { user } = await clientFor(access).getCurrentUser();
          return { id: user.id, login: user.login, firstname: user.firstname, lastname: user.lastname };
        }),

        listTimeEntries: traced('listTimeEntries', ({ baseUrl, apiKey, from, to }) =>
          clientFor({ baseUrl, apiKey }).getTimeEntries({ from, to })
        ),

        listOpenTasks: traced('listOpenTasks', ({ baseUrl, apiKey, dueFrom, dueTo }) =>
          clientFor({ baseUrl, apiKey }).getAssignedOpenIssues({ dueFrom, dueTo })
        ),

        listAssignedTasks: traced('listAssignedTasks', (access) => clientFor(access).getAssignedTasks()),

        getDevPreviewStatus: async () => {
          if (!DEV_PREVIEW_AVAILABLE) {
            return { available: false, enabled: false, dataDir: '', logBytes: 0, pendingEntries: 0 };
          }
          return (await devPreview()).status();
        },

        setDevPreviewEnabled: async ({ enabled }) => (await devPreview()).setEnabled(enabled),

        recordDiagnostic: async ({ level, scope, message }) => {
          if (!DEV_PREVIEW_AVAILABLE) return;
          (await devPreview()).record({ level, scope: String(scope), message: String(message) });
        },

        createFeedback: async ({ title, description, includeLogs }) =>
          (await devPreview()).createFeedback({ title, description, includeLogs }),

        openIssueLink: async ({ url }) => {
          if (!DEV_PREVIEW_AVAILABLE) throw new Error('The developer preview is not available in this build.');
          // Only the project's own "new issue" page may be opened from the app.
          if (!url.startsWith(`${buildInfo.repositoryUrl}/issues/new?`)) {
            throw new Error('Refusing to open a link outside the project issue tracker.');
          }
          Utils.openExternal(url);
        },

        ...windowRequests,
      },
    },
  });
}
