import { Electroview } from 'electrobun/view';
import type { GemiRPCSchema } from '../../shared/rpc';
import type { DateRange, DueRange, GemiBackend, ServerAccess, SignInParams } from '../../shared/backend';
import type { LogLevel } from '../../bun/diagnostics/aggregator';

const defineRpc = () =>
  Electroview.defineRPC<GemiRPCSchema>({
    // Redmine lists can be slow on large instances. The backend gives up on a silent server after 30 s
    // with a message saying so, so this limit sits just above it and only catches a lost backend.
    maxRequestTime: 35_000,
    handlers: {},
  });

let rpc: ReturnType<typeof defineRpc> | null = null;

/**
 * The Electrobun bridge only exists inside the desktop webview. It is created on first use
 * so that importing this module is safe elsewhere (tests, or the Capacitor Android build).
 */
function backend() {
  if (!rpc) {
    if (typeof window === 'undefined' || !('__electrobun' in window)) {
      throw new Error('The desktop backend is not available in this environment.');
    }
    rpc = defineRpc();
    new Electroview({ rpc });
  }
  return rpc.request;
}

export const redmineApi: GemiBackend = {
  signIn: (params: SignInParams) => backend().signIn(params),
  getCurrentUser: (access: ServerAccess) => backend().getCurrentUser(access),
  listTimeEntries: (access: ServerAccess, range: DateRange) =>
    backend().listTimeEntries({ ...access, ...range }),
  listOpenTasks: (access: ServerAccess, dueRange: DueRange) =>
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
