import { AGENT_SETTINGS_KEY, agentSettingsFrom, isAgentPort, type AgentSettings } from '../shared/agents';
import {
  ASSISTANT_PROVIDER_INFO,
  ASSISTANT_PROVIDERS,
  ASSISTANT_SETTINGS_KEY,
  assistantKeyId,
  assistantSettingsFrom,
  assistantSettingsProblem,
  type AssistantKeySlot,
  type AssistantProvider,
  type AssistantSettings,
  type SystemAiSetup,
} from '../shared/assistant';
import type { Proposal } from '../shared/proposals';
import type { CredentialOptions, GemiBackend, HistoryNames, LoadedCredentials, ServerAccess } from '../shared/backend';
import type { BuildInfo } from '../shared/build-info';
import { buildInfo as generatedBuildInfo, DEV_PREVIEW_AVAILABLE } from '../shared/build-info.generated';
import { LOCAL_MODEL_CANDIDATES, findLocalModelServers, openAiAddress, type LocalModelServer } from './assistant/discovery';
import { DevPreview as GeneratedDevPreview } from './dev-preview.generated';
import { isAllowedIssueUrl } from './diagnostics/feedback';
import type { DataFs } from './diagnostics/fs';
import type { DevPreview } from './diagnostics/service';
import { signInWithPassword } from './redmine/auth';
import { RedmineApiError, RedmineClient, assertHttpUrl, type FetchLike } from './redmine/client';
import type { RedmineIssueDetails, RedmineReference } from './redmine/types';
import { openAppStorage, type AppStorage } from './storage/app-storage';
import type { SqlDatabase } from './storage/database';
import { withTimeout } from './timeout';

/** How long a Redmine call may take before the user is told the server is not answering. */
export const REDMINE_TIMEOUT_MS = 30_000;

const NOT_AVAILABLE = 'The developer preview is not available in this build.';
const NO_STORAGE = 'This build cannot save data between runs.';
const NO_CREDENTIALS = 'This build has no credential store to remember a sign-in in.';
const NO_BIOMETRIC = 'This device has no fingerprint or face unlock for the saved sign-ins.';

/**
 * Where the API keys of the user's servers are kept: the system's credential store, such as Windows Credential
 * Manager or the Secret Service. A key is kept per server id, and only when the user chose to be remembered.
 */
export interface CredentialStore {
  /** The key kept for the server, or null when there is none. */
  get(serverId: string): Promise<string | null>;
  set(serverId: string, apiKey: string): Promise<void>;
  /** Forgets the key. A server that has none is fine. */
  remove(serverId: string): Promise<void>;
  /** Only where the platform has a fingerprint or face unlock: the store then says what it offers. */
  options?(): Promise<CredentialOptions>;
  /** Only where `options` is given: turns the unlock on or off. */
  setBiometric?(enabled: boolean): Promise<void>;
}

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
  /** The system's credential store. A platform without one cannot remember a sign-in. */
  credentials?: CredentialStore;
  /** Opens a link in the system browser */
  openUrl(url: string): Promise<void>;
  /**
   * What this computer is already set up for: keys in the environment, or in the configuration of another tool. Only
   * the desktop shell can look; a platform without this reports nothing found.
   */
  systemAiSetup?(): Promise<SystemAiSetup[]>;
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
  /**
   * Called when a server answers 401 to an API key, which is no longer valid (the user may have reset it). The
   * request still fails. The callback must not throw; one that does is ignored.
   */
  onUnauthorized?: (access: ServerAccess) => void;
}

/** The lists that give the names of the ids an issue's history mentions, by the key of the field. */
const NAME_LISTS = {
  status_id: async (client: RedmineClient) => (await client.getIssueStatuses()).issue_statuses,
  priority_id: async (client: RedmineClient) => (await client.getIssuePriorities()).issue_priorities,
  tracker_id: async (client: RedmineClient) => (await client.getTrackers()).trackers,
} as const;

/**
 * What the ids in the issue's history are called. Only the lists that the history needs are fetched, and one that
 * cannot be fetched is left out: the view shows the id instead of failing.
 */
async function historyNames(client: RedmineClient, issue: RedmineIssueDetails): Promise<HistoryNames> {
  const keys = new Set<keyof typeof NAME_LISTS>();
  for (const journal of issue.journals ?? []) {
    for (const detail of journal.details) {
      if (detail.property === 'attr' && detail.name in NAME_LISTS) keys.add(detail.name as keyof typeof NAME_LISTS);
    }
  }
  const names: HistoryNames = {};
  await Promise.all(
    [...keys].map(async (key) => {
      try {
        names[key] = Object.fromEntries((await NAME_LISTS[key](client)).map((entry) => [String(entry.id), entry.name]));
      } catch {
        // The id is shown instead.
      }
    })
  );
  return names;
}

/** Redmine answers 403 to a change the user has no permission for. Says so in words the user can act on. */
function refusedBy(what: string) {
  return (error: unknown): never => {
    if (error instanceof RedmineApiError && error.status === 403) {
      throw new Error(`Redmine does not let you change ${what}. Ask a project member who may change it.`);
    }
    throw error;
  };
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

  /** What this computer is set up for, or nothing where the platform cannot look. A failed look reports nothing. */
  async function systemAiSetup(): Promise<SystemAiSetup[]> {
    if (!platform.systemAiSetup) return [];
    try {
      return await platform.systemAiSetup();
    } catch {
      // Finding nothing is the usual case, so a look that fails is not worth an error on the settings screen.
      return [];
    }
  }

  /** Runs Redmine calls with the platform's HTTP client, giving up when the server does not answer in time. */
  function redmine<R>(run: (transport: { fetch: FetchLike; signal: AbortSignal }) => Promise<R>): Promise<R> {
    return withTimeout(timeoutMs, (signal) => run({ fetch: platform.fetch, signal }));
  }

  /** A Redmine call made with a server's API key. When the server rejects the key, the app is told. */
  async function authorized<R>(
    access: ServerAccess,
    run: (transport: { fetch: FetchLike; signal: AbortSignal }) => Promise<R>
  ): Promise<R> {
    try {
      return await redmine(run);
    } catch (error) {
      if (error instanceof RedmineApiError && error.status === 401) {
        try {
          options.onUnauthorized?.(access);
        } catch {
          // Telling the app is best effort. The error being reported is the one that matters.
        }
      }
      throw error;
    }
  }

  function credentialStore(): CredentialStore {
    if (!platform.credentials) throw new Error(NO_CREDENTIALS);
    return platform.credentials;
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
      authorized(access, async (transport) => {
        const { user } = await clientFor(access, transport).getCurrentUser();
        return { id: user.id, login: user.login, firstname: user.firstname, lastname: user.lastname };
      })
    ),

    listTimeEntries: traced('listTimeEntries', (access, { from, to, projectId }) =>
      authorized(access, (transport) => clientFor(access, transport).getTimeEntries({ from, to, projectId }))
    ),

    listOpenTasks: traced('listOpenTasks', (access, { dueFrom, dueTo, projectId }) =>
      authorized(access, (transport) => clientFor(access, transport).getAssignedOpenIssues({ dueFrom, dueTo, projectId }))
    ),

    listAssignedTasks: traced('listAssignedTasks', (access, scope) =>
      authorized(access, (transport) => clientFor(access, transport).getAssignedTasks(scope?.projectId))
    ),

    listMyProjects: traced('listMyProjects', (access) =>
      authorized(access, async (transport) => {
        const memberships = await clientFor(access, transport).getMemberships();
        // A project can be listed by more than one membership, such as one through a group: each is named once.
        const projects = new Map<number, RedmineReference>();
        for (const { project } of memberships) projects.set(project.id, { id: project.id, name: project.name });
        return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
      })
    ),

    getTask: traced('getTask', (access, taskId) =>
      authorized(access, async (transport) => {
        const client = clientFor(access, transport);
        const issue = await client.getIssue(taskId);
        return { issue, names: await historyNames(client, issue) };
      })
    ),

    listTaskLogEntries: traced('listTaskLogEntries', (access, taskId) =>
      authorized(access, (transport) => clientFor(access, transport).getIssueTimeEntries(taskId))
    ),

    getLogEntry: traced('getLogEntry', (access, entryId) =>
      authorized(access, (transport) => clientFor(access, transport).getTimeEntry(entryId))
    ),

    updateLogEntry: traced('updateLogEntry', (access, entryId, changes) =>
      authorized(access, (transport) =>
        clientFor(access, transport).updateTimeEntry(entryId, {
          spent_on: changes.spentOn,
          hours: changes.hours,
          activity_id: changes.activityId,
          comments: changes.comments,
        })
      ).catch(refusedBy('this log entry'))
    ),

    listTaskOptions: traced('listTaskOptions', (access) =>
      authorized(access, async (transport) => {
        const client = clientFor(access, transport);
        const [statuses, priorities] = await Promise.all([client.getIssueStatuses(), client.getIssuePriorities()]);
        return {
          statuses: statuses.issue_statuses.map(({ id, name }) => ({ id, name })),
          priorities: priorities.issue_priorities.map(({ id, name }) => ({ id, name })),
        };
      })
    ),

    updateTask: traced('updateTask', (access, taskId, changes) =>
      authorized(access, (transport) =>
        clientFor(access, transport).updateIssue(taskId, {
          subject: changes.subject,
          description: changes.description,
          status_id: changes.statusId,
          priority_id: changes.priorityId,
          start_date: changes.startDate,
          due_date: changes.dueDate,
          done_ratio: changes.doneRatio,
          estimated_hours: changes.estimatedHours,
          notes: changes.notes,
        })
      ).catch(refusedBy('this task'))
    ),

    listTimeActivities: traced('listTimeActivities', (access) =>
      authorized(access, async (transport) => {
        const { time_entry_activities } = await clientFor(access, transport).getTimeEntryActivities();
        return time_entry_activities.map(({ id, name }) => ({ id, name }));
      })
    ),

    createLogEntry: traced('createLogEntry', (access, entry) =>
      authorized(access, (transport) =>
        clientFor(access, transport).createTimeEntry({
          issue_id: entry.taskId,
          spent_on: entry.spentOn,
          hours: entry.hours,
          activity_id: entry.activityId,
          comments: entry.comments,
        })
      )
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

    async loadCredentials(serverIds): Promise<LoadedCredentials> {
      const apiKeys: Record<string, string> = {};
      let problem: string | null = null;
      try {
        const store = credentialStore();
        // One at a time: a locked keyring asks the user once, not once for every server.
        for (const id of serverIds) {
          const key = await store.get(id);
          if (key) apiKeys[id] = key;
        }
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
        await traceFailure('loadCredentials', error);
      }
      return { apiKeys, problem };
    },

    saveCredential: traced('saveCredential', async (serverId, apiKey) => credentialStore().set(serverId, apiKey)),

    deleteCredential: traced('deleteCredential', async (serverId) => credentialStore().remove(serverId)),

    getCredentialOptions: traced('getCredentialOptions', async (): Promise<CredentialOptions> => {
      const store = platform.credentials;
      return store?.options ? store.options() : { biometric: null };
    }),

    getAgentSettings: traced('getAgentSettings', async (): Promise<AgentSettings> =>
      agentSettingsFrom(await (await appStorage()).getSetting(AGENT_SETTINGS_KEY))
    ),

    listAgentProposals: traced('listAgentProposals', async (): Promise<Proposal[]> => (await appStorage()).listProposals()),

    saveAgentProposal: traced('saveAgentProposal', async (proposal) => (await appStorage()).saveProposal(proposal)),

    saveAgentSettings: traced('saveAgentSettings', async (settings) => {
      if (!isAgentPort(settings.port)) throw new Error('The port must be a whole number from 1024 to 65535.');
      await (await appStorage()).setSetting(AGENT_SETTINGS_KEY, { enabled: settings.enabled === true, port: settings.port });
    }),

    getAssistantSettings: traced('getAssistantSettings', async (): Promise<AssistantSettings> =>
      assistantSettingsFrom(await (await appStorage()).getSetting(ASSISTANT_SETTINGS_KEY))
    ),

    saveAssistantSettings: traced('saveAssistantSettings', async (settings) => {
      const problem = assistantSettingsProblem(settings);
      if (problem) throw new Error(problem);
      await (await appStorage()).setSetting(ASSISTANT_SETTINGS_KEY, assistantSettingsFrom(settings));
    }),

    loadAssistantKey: traced('loadAssistantKey', async (slot: AssistantKeySlot) => credentialStore().get(assistantKeyId(slot))),

    saveAssistantKey: traced('saveAssistantKey', async (slot: AssistantKeySlot, apiKey: string) => {
      const key = apiKey.trim();
      if (!key) throw new Error('The API key is empty.');
      await credentialStore().set(assistantKeyId(slot), key);
    }),

    deleteAssistantKey: traced('deleteAssistantKey', async (slot: AssistantKeySlot) => credentialStore().remove(assistantKeyId(slot))),

    findLocalModelServers: traced('findLocalModelServers', async (): Promise<LocalModelServer[]> => {
      // The addresses of a local server that the environment already names are asked as well, before the usual ones.
      const named = (await systemAiSetup())
        .filter((found) => found.kind === 'address')
        .map((found) => ({ label: 'The address this computer is set up for', baseUrl: openAiAddress(found.value) }))
        .filter((candidate) => candidate.baseUrl !== '');
      return findLocalModelServers(platform.fetch, { candidates: [...named, ...LOCAL_MODEL_CANDIDATES] });
    }),

    findSystemAiSetup: traced('findSystemAiSetup', systemAiSetup),

    openAssistantKeyPage: traced('openAssistantKeyPage', async (provider: AssistantProvider) => {
      // The webview names a service, never an address, so no link of its choosing can be opened this way.
      if (!ASSISTANT_PROVIDERS.includes(provider)) throw new Error(`"${provider}" is not a service this app can use.`);
      const page = ASSISTANT_PROVIDER_INFO[provider].keyPage;
      if (!page) throw new Error('That service hands out no API key.');
      await platform.openUrl(page);
    }),

    setBiometricUnlock: traced('setBiometricUnlock', async (enabled) => {
      const store = credentialStore();
      if (!store.setBiometric) throw new Error(NO_BIOMETRIC);
      await store.setBiometric(enabled);
    }),

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
