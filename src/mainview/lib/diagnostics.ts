import { redmineApi } from './api';

/**
 * Forwards uncaught webview errors to the developer preview log. Only installed in builds
 * that offer the preview; the backend ignores the events unless the user opted in.
 */
export function installDiagnosticsHooks(): void {
  const forward = (scope: string, message: string) => {
    try {
      void redmineApi.recordDiagnostic('error', scope, message).catch(() => {});
    } catch {
      // The backend is unavailable (for example in a browser). Diagnostics are best effort.
    }
  };

  window.addEventListener('error', event => {
    forward('webview.error', event.message || 'Uncaught error');
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    forward('webview.rejection', reason instanceof Error ? reason.message : String(reason));
  });
}
