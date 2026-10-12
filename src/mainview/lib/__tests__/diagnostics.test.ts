import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installDiagnosticsHooks } from '../diagnostics';
import { redmineApi } from '../api';

vi.mock('../api', () => ({
  redmineApi: { recordDiagnostic: vi.fn().mockResolvedValue(undefined) },
}));

describe('installDiagnosticsHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDiagnosticsHooks();
  });

  it('forwards uncaught errors to the developer preview log', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Cannot read properties of undefined' }));

    expect(redmineApi.recordDiagnostic).toHaveBeenCalledWith(
      'error',
      'webview.error',
      'Cannot read properties of undefined'
    );
  });

  it('forwards unhandled promise rejections', () => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    Object.defineProperty(event, 'reason', { value: new Error('Network down') });
    window.dispatchEvent(event);

    expect(redmineApi.recordDiagnostic).toHaveBeenCalledWith('error', 'webview.rejection', 'Network down');
  });
});
