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
  getDevPreviewStatus: () => backend().getDevPreviewStatus(),
  setDevPreviewEnabled: (enabled) => backend().setDevPreviewEnabled(enabled),
  recordDiagnostic: (level, scope, message) => backend().recordDiagnostic(level, scope, message),
  createFeedback: (input) => backend().createFeedback(input),
  openIssueLink: (url) => backend().openIssueLink(url),
  loadSavedServers: () => backend().loadSavedServers(),
  saveServers: (saved) => backend().saveServers(saved),
};
