// What the user interface asks of the backend: the Redmine calls and the developer preview.
// The desktop shell answers over RPC (see rpc.ts); a backend that runs inside the webview
// implements the same interface. Type-only imports keep this file free of runtime code.
import type { RedmineIssue, RedmineIssueDetails, RedmineTimeEntry, RedmineUser } from '../bun/redmine/types';
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

/**
 * The names that an issue's history refers to by id. Redmine gives the old and the new value of a status, a priority or
 * a tracker as its id; this says what the id is called, by the key of the field. A name that could not be found is missing.
 */
export type HistoryNames = Partial<Record<'status_id' | 'priority_id' | 'tracker_id', Record<string, string>>>;

export interface TaskDetails {
  issue: RedmineIssueDetails;
  names: HistoryNames;
}

/** An activity that time can be logged under, such as "Development". */
export interface TimeActivity {
  id: number;
  name: string;
}

/** The fields of a log entry the user can change. */
export interface LogEntryChanges {
  /** YYYY-MM-DD */
  spentOn: string;
  hours: number;
  activityId: number;
  comments: string;
}

/** A status or a priority a task can take on this server. */
export interface TaskOption {
  id: number;
  name: string;
}

export interface TaskOptions {
  statuses: TaskOption[];
  priorities: TaskOption[];
}

/** The fields of a task the user can change. `null` clears a date or the estimate. */
export interface TaskChanges {
  subject: string;
  description: string;
  statusId: number;
  priorityId: number;
  /** YYYY-MM-DD */
  startDate: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  doneRatio: number;
  estimatedHours: number | null;
  /** A note that is added to the task's history with the change. Empty for none. */
  notes: string;
}

/** A log entry the user is adding to a task. */
export interface NewLogEntry {
  taskId: number;
  /** YYYY-MM-DD */
  spentOn: string;
  hours: number;
  activityId: number;
  comments: string;
}

export interface LoadedCredentials {
  /** By server id */
  apiKeys: Record<string, string>;
  /** Why the store could not be read, in words for the user, or null. Keys found before the problem are in `apiKeys`. */
  problem: string | null;
}

/**
 * How the saved sign-ins are kept on this device. `biometric` is null where the platform has no fingerprint or face
 * unlock, so the setting is not offered there. Otherwise it says whether this device can use one, and whether it is on.
 */
export interface CredentialOptions {
  biometric: { available: boolean; enabled: boolean } | null;
}

import type { AgentSettings } from './agents';
import type { AssistantKeySlot, AssistantProvider, AssistantSettings, SystemAiSetup } from './assistant';
import type { LocalModelServer } from '../bun/assistant/discovery';
import type { Proposal } from './proposals';

export interface GemiBackend {
  signIn(params: SignInParams): Promise<SignInResponse>;
  getCurrentUser(access: ServerAccess): Promise<CurrentUserSummary>;
  listTimeEntries(access: ServerAccess, range: DateRange): Promise<RedmineTimeEntry[]>;
  listOpenTasks(access: ServerAccess, dueRange: DueRange): Promise<RedmineIssue[]>;
  listAssignedTasks(access: ServerAccess): Promise<RedmineIssue[]>;
  /** One task with its history, attachments, subtasks and relations. Rejects with a 404 for one that cannot be seen. */
  getTask(access: ServerAccess, taskId: number): Promise<TaskDetails>;
  /** The time logged on a task, by anyone the user may see, the latest day first. */
  listTaskLogEntries(access: ServerAccess, taskId: number): Promise<RedmineTimeEntry[]>;
  /** One log entry, which is one time entry. */
  getLogEntry(access: ServerAccess, entryId: number): Promise<RedmineTimeEntry>;
  /** The activities that time can be logged under on this server. */
  listTimeActivities(access: ServerAccess): Promise<TimeActivity[]>;
  /** Changes a log entry. Rejects with a sentence the user can read, such as when Redmine does not allow the change. */
  updateLogEntry(access: ServerAccess, entryId: number, changes: LogEntryChanges): Promise<void>;
  /** The statuses and priorities a task can take on this server. */
  listTaskOptions(access: ServerAccess): Promise<TaskOptions>;
  /** Changes a task. Rejects with a sentence the user can read, such as when Redmine does not allow the change. */
  updateTask(access: ServerAccess, taskId: number, changes: TaskChanges): Promise<void>;
  /** Logs time on a task. Rejects when the server refuses it, such as for a user without the right to log time. */
  createLogEntry(access: ServerAccess, entry: NewLogEntry): Promise<void>;
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
  /** How the saved sign-ins are kept here, and whether a fingerprint or face is asked for before they are read. */
  getCredentialOptions(): Promise<CredentialOptions>;
  /** Asks for a fingerprint or face before the saved sign-ins are read, or stops asking. Rejects with a sentence the user can read. */
  setBiometricUnlock(enabled: boolean): Promise<void>;
  /** The settings of the endpoint that AI agents connect to. Off unless the user turned it on. */
  getAgentSettings(): Promise<AgentSettings>;
  /** The changes that AI agents proposed and the app has kept, the newest first. Rejects where the app has no storage. */
  listAgentProposals(): Promise<Proposal[]>;
  /** Keeps a proposed change, or its new status, replacing the one kept before. */
  saveAgentProposal(proposal: Proposal): Promise<void>;
  /** Keeps the settings of the endpoint. Rejects with a sentence the user can read when the port cannot be used. */
  saveAgentSettings(settings: AgentSettings): Promise<void>;
  /** The settings of the AI assistant, without its API keys. */
  getAssistantSettings(): Promise<AssistantSettings>;
  /** Keeps the settings of the AI assistant. Rejects with a sentence the user can read when they cannot be used. */
  saveAssistantSettings(settings: AssistantSettings): Promise<void>;
  /** The API key of the chat model or of the voice model, from the system's credential store, or null when there is none. */
  loadAssistantKey(slot: AssistantKeySlot): Promise<string | null>;
  /** Keeps an API key in the system's credential store. Rejects when the store cannot be used. */
  saveAssistantKey(slot: AssistantKeySlot, apiKey: string): Promise<void>;
  /** Removes an API key from the system's credential store. */
  deleteAssistantKey(slot: AssistantKeySlot): Promise<void>;
  /** The local model servers that answer on this computer, found by asking the usual addresses. Empty when none does. */
  findLocalModelServers(): Promise<LocalModelServer[]>;
  /** The model services this computer is already set up for: a key in the environment or in another tool's settings. */
  findSystemAiSetup(): Promise<SystemAiSetup[]>;
  /** Opens the page where a service hands out an API key, in the system browser. */
  openAssistantKeyPage(provider: AssistantProvider): Promise<void>;
}
