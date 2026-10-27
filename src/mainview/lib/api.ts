import type { GemiBackend } from '../../shared/backend';
import { backend } from './bridge';
import { noteRedmineChange } from './data-changes';

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
  // The writes below count as changes, so the views that show Redmine data reload (data-changes.ts).
  updateLogEntry: async (access, entryId, changes) => {
    const updated = await backend().updateLogEntry(access, entryId, changes);
    noteRedmineChange();
    return updated;
  },
  listTaskOptions: (access) => backend().listTaskOptions(access),
  updateTask: async (access, taskId, changes) => {
    const updated = await backend().updateTask(access, taskId, changes);
    noteRedmineChange();
    return updated;
  },
  createLogEntry: async (access, entry) => {
    const created = await backend().createLogEntry(access, entry);
    noteRedmineChange();
    return created;
  },
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
  listAgentProposals: () => backend().listAgentProposals(),
  saveAgentProposal: (proposal) => backend().saveAgentProposal(proposal),
  getAssistantSettings: () => backend().getAssistantSettings(),
  saveAssistantSettings: (settings) => backend().saveAssistantSettings(settings),
  loadAssistantKey: (slot) => backend().loadAssistantKey(slot),
  saveAssistantKey: (slot, apiKey) => backend().saveAssistantKey(slot, apiKey),
  deleteAssistantKey: (slot) => backend().deleteAssistantKey(slot),
  findLocalModelServers: () => backend().findLocalModelServers(),
  findSystemAiSetup: () => backend().findSystemAiSetup(),
  openAssistantKeyPage: (provider) => backend().openAssistantKeyPage(provider),
};
