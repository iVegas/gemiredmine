import type { GemiBackend, ServerAccess } from '../shared/backend';
import type { BuildInfo } from '../shared/build-info';
import { buildInfo as generatedBuildInfo, DEV_PREVIEW_AVAILABLE } from '../shared/build-info.generated';
import { DevPreview as GeneratedDevPreview } from './dev-preview.generated';
import { isAllowedIssueUrl } from './diagnostics/feedback';
import type { DataFs } from './diagnostics/fs';
import type { DevPreview } from './diagnostics/service';
import { signInWithPassword } from './redmine/auth';
import { RedmineClient, assertHttpUrl, type FetchLike } from './redmine/client';
import { openAppStorage, type AppStorage } from './storage/app-storage';
import type { SqlDatabase } from './storage/database';
import { withTimeout } from './timeout';

/** How long a Redmine call may take before the user is told the server is not answering. */
export const REDMINE_TIMEOUT_MS = 30_000;

const NOT_AVAILABLE = 'The developer preview is not available in this build.';
const NO_STORAGE = 'This build cannot save data between runs.';

/**
 * What the backend needs from the place it runs in. The desktop shell supplies Bun's fetch and
 * node:fs; a backend running inside a webview supplies its HTTP and file plugins. Nothing in the
 * backend itself may use Node or Bun APIs, because the webview has none.
 */
export interface BackendPlatform {
  /** Sends Redmine requests. Needs no CORS headers from the server when it is a native HTTP client. */
  fetch: FetchLike;
  /** Reads and writes the developer preview's files */
  fs: DataFs;
  /** The per-channel folder for the developer preview's settings, logs and reports */
  dataDir(): Promise<string>;
  /**
   * Opens the SQLite database that holds what the app keeps between runs, creating it when it is missing. Only
   * the window that owns the app's configuration calls it. A platform without one cannot save anything.
   */
  database?(): Promise<SqlDatabase>;
  /** Opens a link in the system browser */
  openUrl(url: string): Promise<void>;
  /** Describes the machine and runtime, for feedback reports */
  environment(): Promise<{ platform: string; arch: string; runtime: string }>;
}

/**
 * What the backend needs from a developer preview. By default it opens its own. A second window of the app
 * passes the one that the first window owns instead: the preview aggregates in memory and rotates its files,
 * so it must have a single owner.
 */
export type PreviewPort = Pick<DevPreview, 'status' | 'setEnabled' | 'record' | 'createFeedback'>;

export interface BackendOptions {
  /** Defaults to the metadata generated for this build */
  buildInfo?: BuildInfo;
  /** Whether this build offers the developer preview. Defaults to the build's own setting. */
  devPreviewAvailable?: boolean;
  /** The DevPreview class. Defaults to the generated entry, which is a stub in builds without the preview. */
  DevPreviewImpl?: typeof DevPreview;
  /** Uses this preview instead of opening one. Nothing is read or written for it here. */
  preview?: PreviewPort;
  timeoutMs?: number;
}

export function createBackend(platform: BackendPlatform, options: BackendOptions = {}): GemiBackend {
  const info = options.buildInfo ?? generatedBuildInfo;
  const previewAvailable = options.devPreviewAvailable ?? DEV_PREVIEW_AVAILABLE;
  const timeoutMs = options.timeoutMs ?? REDMINE_TIMEOUT_MS;

  async function openPreview(): Promise<DevPreview> {
    const [dataDir, environment] = await Promise.all([platform.dataDir(), platform.environment()]);
    const Implementation = options.DevPreviewImpl ?? GeneratedDevPreview;
    return Implementation.open({
      dataDir,
      fs: platform.fs,
      available: true,
      repositoryUrl: info.repositoryUrl,
      environment: {
        productName: info.productName,
        version: info.version,
        channel: info.channel,
        commit: info.commit,
        buildDate: info.buildDate,
        ...environment,
      },
    });
  }

  // One instance, even when the first calls arrive together. A failed start can be tried again.
  let preview: Promise<PreviewPort> | undefined;
  function devPreview(): Promise<PreviewPort> {
    if (!previewAvailable) return Promise.reject(new Error(NOT_AVAILABLE));
    if (options.preview) return Promise.resolve(options.preview);
    preview ??= openPreview().catch((error) => {
      preview = undefined;
      throw error;
    });
    return preview;
  }

  // One storage, even when the first calls arrive together. A failed start can be tried again.
  let storage: Promise<AppStorage> | undefined;
  function appStorage(): Promise<AppStorage> {
    if (!platform.database) return Promise.reject(new Error(NO_STORAGE));
    storage ??= platform
      .database()
      .then(openAppStorage)
      .catch((error) => {
        storage = undefined;
        throw error;
      });
    return storage;
  }

  /** Failed requests are recorded in the developer preview log, when it is enabled. */
  async function traceFailure(scope: string, error: unknown): Promise<void> {
    if (!previewAvailable) return;
    try {
      (await devPreview()).record({
        level: 'error',
        scope,
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Diagnostics are best effort. They must never hide the error being reported.
    }
  }

  function traced<A extends unknown[], R>(scope: string, handler: (...args: A) => Promise<R>) {
    return async (...args: A): Promise<R> => {
      try {
        return await handler(...args);
      } catch (error) {
        await traceFailure(scope, error);
        throw error;
      }
    };
  }

  /** Runs Redmine calls with the platform's HTTP client, giving up when the server does not answer in time. */
  function redmine<R>(run: (transport: { fetch: FetchLike; signal: AbortSignal }) => Promise<R>): Promise<R> {
    return withTimeout(timeoutMs, (signal) => run({ fetch: platform.fetch, signal }));
  }

  // Redmine servers do not send CORS headers, so a webview could not call them itself.
  function clientFor({ baseUrl, apiKey }: ServerAccess, transport: { fetch: FetchLike; signal: AbortSignal }) {
    return new RedmineClient({ baseUrl: assertHttpUrl(baseUrl), apiKey, ...transport });
  }

  return {
    signIn: traced('signIn', ({ baseUrl, username, password }) =>
      redmine((transport) => signInWithPassword(baseUrl, username, password, transport))
    ),

    getCurrentUser: traced('getCurrentUser', (access) =>
      redmine(async (transport) => {
        const { user } = await clientFor(access, transport).getCurrentUser();
        return { id: user.id, login: user.login, firstname: user.firstname, lastname: user.lastname };
      })
    ),

    listTimeEntries: traced('listTimeEntries', (access, { from, to }) =>
      redmine((transport) => clientFor(access, transport).getTimeEntries({ from, to }))
    ),

    listOpenTasks: traced('listOpenTasks', (access, { dueFrom, dueTo }) =>
      redmine((transport) => clientFor(access, transport).getAssignedOpenIssues({ dueFrom, dueTo }))
    ),

    listAssignedTasks: traced('listAssignedTasks', (access) =>
      redmine((transport) => clientFor(access, transport).getAssignedTasks())
    ),

    async getDevPreviewStatus() {
      if (!previewAvailable) {
        return { available: false, enabled: false, dataDir: '', logBytes: 0, pendingEntries: 0 };
      }
      return (await devPreview()).status();
    },

    async setDevPreviewEnabled(enabled) {
      return (await devPreview()).setEnabled(enabled);
    },

    async recordDiagnostic(level, scope, message) {
      if (!previewAvailable) return;
      (await devPreview()).record({ level, scope: String(scope), message: String(message) });
    },

    async createFeedback({ title, description, includeLogs }) {
      return (await devPreview()).createFeedback({ title, description, includeLogs });
    },

    loadSavedServers: traced('loadSavedServers', async () => (await appStorage()).loadServers()),

    saveServers: traced('saveServers', async (saved) => (await appStorage()).saveServers(saved)),

    async openIssueLink(url) {
      if (!previewAvailable) throw new Error(NOT_AVAILABLE);
      // Only the project's own "new issue" page may be opened from the app.
      if (!isAllowedIssueUrl(url, info.repositoryUrl)) {
        throw new Error('Refusing to open a link outside the project issue tracker.');
      }
      await platform.openUrl(url);
    },
  };
}
