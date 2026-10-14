import type { ServerAccess, DateRange, SignInParams } from '../../shared/rpc';
import type { LogLevel } from '../../bun/diagnostics/aggregator';
import { backend } from './bridge';

export const redmineApi = {
  signIn: (params: SignInParams) => backend().signIn(params),
  getCurrentUser: (access: ServerAccess) => backend().getCurrentUser(access),
  listTimeEntries: (access: ServerAccess, range: DateRange) =>
    backend().listTimeEntries({ ...access, ...range }),
  listOpenTasks: (access: ServerAccess, dueRange: { dueFrom: string; dueTo: string }) =>
    backend().listOpenTasks({ ...access, ...dueRange }),
  listAssignedTasks: (access: ServerAccess) => backend().listAssignedTasks(access),
  getDevPreviewStatus: () => backend().getDevPreviewStatus(),
  setDevPreviewEnabled: (enabled: boolean) => backend().setDevPreviewEnabled({ enabled }),
  recordDiagnostic: (level: LogLevel, scope: string, message: string) =>
    backend().recordDiagnostic({ level, scope, message }),
  createFeedback: (input: { title: string; description: string; includeLogs: boolean }) =>
    backend().createFeedback(input),
  openIssueLink: (url: string) => backend().openIssueLink({ url }),
};
