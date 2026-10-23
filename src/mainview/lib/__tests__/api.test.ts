import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import type { GemiBackend } from '../../../shared/backend';

const fake = vi.hoisted(() => {
  const methods = [
    'signIn',
    'getCurrentUser',
    'listTimeEntries',
    'listOpenTasks',
    'listAssignedTasks',
    'getTask',
    'listTaskLogEntries',
    'getLogEntry',
    'getDevPreviewStatus',
    'setDevPreviewEnabled',
    'recordDiagnostic',
    'createFeedback',
    'openIssueLink',
    'loadSavedServers',
    'saveServers',
    'loadCredentials',
    'saveCredential',
    'deleteCredential',
  ] as const;
  return {
    methods,
    platform: { marker: 'tauri platform' },
    window: { label: 'main' },
    preview: { marker: 'remote preview' },
    mainApi: { marker: 'main window api' },
    remoteApi: { marker: 'remote window api' },
    backend: Object.fromEntries(methods.map(name => [name, vi.fn()])) as Record<(typeof methods)[number], ReturnType<typeof vi.fn>>,
  };
});

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: fake.window.label }) }));
vi.mock('../tauri-platform', () => ({ tauriPlatform: () => fake.platform }));
vi.mock('../window-layer', () => ({
  startMainLayer: vi.fn(() => ({ api: fake.mainApi })),
  remoteWindowApi: () => fake.remoteApi,
  remotePreview: () => fake.preview,
}));
vi.mock('../../../bun/backend', () => ({ createBackend: vi.fn(() => fake.backend) }));

import { createBackend } from '../../../bun/backend';
import { redmineApi } from '../api';
import { backend, hasDesktopBackend, hasWindowLayer, isAndroidWebview, windowBackend } from '../bridge';
import { canDetachViews } from '../windows';

const access = { baseUrl: 'https://redmine.local', apiKey: 'key' };

describe('outside the desktop app', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('has no backend, and says so', () => {
    expect(hasDesktopBackend()).toBe(false);
    expect(() => backend()).toThrow('The desktop backend is not available in this environment.');
    expect(() => redmineApi.listAssignedTasks(access)).toThrow('The desktop backend is not available in this environment.');
    expect(createBackend).not.toHaveBeenCalled();
  });
});

describe('in the desktop app', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    for (const method of Object.values(fake.backend)) method.mockReset().mockResolvedValue('result');
  });

  it('runs one backend on the Tauri platform, created when first needed', async () => {
    await redmineApi.getDevPreviewStatus();
    await redmineApi.getDevPreviewStatus();

    expect(createBackend).toHaveBeenCalledTimes(1);
    expect(createBackend).toHaveBeenCalledWith(fake.platform, { onUnauthorized: expect.any(Function) });
  });

  it('hands every call to the backend with the same arguments', async () => {
    const range = { from: '2026-01-01', to: '2026-01-31' };
    const dueRange = { dueFrom: '2026-01-01', dueTo: '2026-01-31' };
    const calls: Record<keyof GemiBackend, unknown[]> = {
      signIn: [{ baseUrl: 'https://r', username: 'alice', password: 'secret' }],
      getCurrentUser: [access],
      listTimeEntries: [access, range],
      listOpenTasks: [access, dueRange],
      listAssignedTasks: [access],
      getTask: [access, 42],
      listTaskLogEntries: [access, 42],
      getLogEntry: [access, 7],
      listTimeActivities: [access],
      updateLogEntry: [access, 7, { spentOn: '2026-10-17', hours: 2, activityId: 8, comments: '' }],
      listTaskOptions: [access],
      updateTask: [access, 42, { subject: 'Fix', description: '', statusId: 2, priorityId: 4, startDate: null, dueDate: null, doneRatio: 0, estimatedHours: null, notes: '' }],
      createLogEntry: [access, { taskId: 42, spentOn: '2026-10-17', hours: 1.5, activityId: 8, comments: 'Review' }],
      getDevPreviewStatus: [],
      setDevPreviewEnabled: [true],
      recordDiagnostic: ['error', 'scope', 'message'],
      createFeedback: [{ title: 't', description: 'd', includeLogs: true }],
      openIssueLink: ['https://github.com/iVegas/gemiredmine/issues/new'],
      loadSavedServers: [],
      saveServers: [{ servers: [{ id: 's1', name: 'Work', url: 'https://r', remember: true }], activeServerId: 's1' }],
      loadCredentials: [['s1', 's2']],
      saveCredential: ['s1', 'key'],
      deleteCredential: ['s1'],
    };

    for (const name of fake.methods) {
      const result = await (redmineApi[name] as (...args: unknown[]) => Promise<unknown>)(...calls[name]);

      expect(fake.backend[name], name).toHaveBeenCalledExactlyOnceWith(...calls[name]);
      expect(result, name).toBe('result');
    }
  });

  it('passes on the failures of the backend', async () => {
    fake.backend.signIn.mockRejectedValue(new Error('The Redmine server did not answer within 30 seconds.'));

    await expect(redmineApi.signIn({ baseUrl: 'https://r', username: 'a', password: 'b' })).rejects.toThrow(
      'did not answer within 30 seconds'
    );
  });
});

describe('windows of their own', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    fake.window.label = 'main';
  });

  it('are offered in the main window and in view windows of the desktop app', () => {
    expect(hasWindowLayer()).toBe(true);
    expect(canDetachViews()).toBe(true);

    fake.window.label = 'view-calendar';
    expect(hasWindowLayer()).toBe(true);
  });

  it('are not offered outside the desktop app, or in a window the layer does not know', () => {
    fake.window.label = 'something-else';
    expect(hasWindowLayer()).toBe(false);
    expect(() => windowBackend()).toThrow('Windows of their own are not available in this build.');

    fake.window.label = 'main';
    vi.mocked(isTauri).mockReturnValue(false);
    expect(hasWindowLayer()).toBe(false);
    expect(canDetachViews()).toBe(false);
  });

  it('are not offered on Android, which has no windows of its own, but the backend still runs there', () => {
    const userAgent = vi.spyOn(navigator, 'userAgent', 'get');
    userAgent.mockReturnValue('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36');
    try {
      expect(isAndroidWebview()).toBe(true);
      expect(hasWindowLayer()).toBe(false);
      expect(canDetachViews()).toBe(false);
      expect(hasDesktopBackend()).toBe(true);
    } finally {
      userAgent.mockRestore();
    }
  });

  it('are offered on desktop Linux, whose user agent does not name Android', () => {
    expect(isAndroidWebview()).toBe(false);
    expect(hasWindowLayer()).toBe(true);
  });

  it('are answered by the main window itself, and asked of it by a view window', () => {
    expect(windowBackend()).toBe(fake.mainApi);

    fake.window.label = 'view-todo';
    expect(windowBackend()).toBe(fake.remoteApi);
  });
});

describe('the backend of each window', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(createBackend).mockClear();
  });

  // The bridge keeps the backend it made, so each case imports a fresh copy of it.
  async function backendOfWindow(label: string) {
    fake.window.label = label;
    vi.resetModules();
    const bridge = await import('../bridge');
    const { createBackend: create } = await import('../../../bun/backend');
    bridge.backend();
    return vi.mocked(create).mock.calls.at(-1)!;
  }

  it('owns the developer preview in the main window', async () => {
    const [platform, options] = await backendOfWindow('main');

    expect(platform).toBe(fake.platform);
    expect(options).toEqual({ onUnauthorized: expect.any(Function) });
  });

  it('hands its diagnostics to the main window in a view window', async () => {
    const [platform, options] = await backendOfWindow('view-calendar');

    expect(platform).toBe(fake.platform);
    expect(options).toEqual({ preview: fake.preview, onUnauthorized: expect.any(Function) });
  });

  it.each(['main', 'view-todo'])('signs the user out of a server that rejects the API key, in %s too', async (label) => {
    const [, options] = await backendOfWindow(label);

    expect(options?.onUnauthorized?.name).toBe('expireSignIn');
  });
});
