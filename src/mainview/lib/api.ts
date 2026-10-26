import type { GemiBackend } from '../../shared/backend';
import { backend } from './bridge';

// The UI reaches the backend only through this object, so a different shell can put a different
// backend behind it. In the desktop app it runs in this webview, see bridge.ts.
export const redmineApi: GemiBackend = {
  signIn: (params) => backend().signIn(params),
  getCurrentUser: (access) => backend().getCurrentUser(access),
  listTimeEntries: (access, range) => backend().listTimeEntries(access, range),
  listOpenTasks: (access, dueRange) => backend().listOpenTasks(access, dueRange),
  listAssignedTasks: (access) => backend().listAssignedTasks(access),
  getTask: (access, taskId) => backend().getTask(access, taskId),
  listTaskLogEntries: (access, taskId) => backend().listTaskLogEntries(access, taskId),
  getLogEntry: (access, entryId) => backend().getLogEntry(access, entryId),
  listTimeActivities: (access) => backend().listTimeActivities(access),
  updateLogEntry: (access, entryId, changes) => backend().updateLogEntry(access, entryId, changes),
  listTaskOptions: (access) => backend().listTaskOptions(access),
  updateTask: (access, taskId, changes) => backend().updateTask(access, taskId, changes),
  createLogEntry: (access, entry) => backend().createLogEntry(access, entry),
  getDevPreviewStatus: () => backend().getDevPreviewStatus(),
  setDevPreviewEnabled: (enabled) => backend().setDevPreviewEnabled(enabled),
  recordDiagnostic: (level, scope, message) => backend().recordDiagnostic(level, scope, message),
  createFeedback: (input) => backend().createFeedback(input),
  openIssueLink: (url) => backend().openIssueLink(url),
  loadSavedServers: () => backend().loadSavedServers(),
  saveServers: (saved) => backend().saveServers(saved),
  loadCredentials: (serverIds) => backend().loadCredentials(serverIds),
  saveCredential: (serverId, apiKey) => backend().saveCredential(serverId, apiKey),
  deleteCredential: (serverId) => backend().deleteCredential(serverId),
  getCredentialOptions: () => backend().getCredentialOptions(),
  setBiometricUnlock: (enabled) => backend().setBiometricUnlock(enabled),
  getAgentSettings: () => backend().getAgentSettings(),
  saveAgentSettings: (settings) => backend().saveAgentSettings(settings),
};
