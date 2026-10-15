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
    'getDevPreviewStatus',
    'setDevPreviewEnabled',
    'recordDiagnostic',
    'createFeedback',
    'openIssueLink',
  ] as const;
  return {
    methods,
    platform: { marker: 'tauri platform' },
    backend: Object.fromEntries(methods.map(name => [name, vi.fn()])) as Record<(typeof methods)[number], ReturnType<typeof vi.fn>>,
  };
});

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('../tauri-platform', () => ({ tauriPlatform: () => fake.platform }));
vi.mock('../../../bun/backend', () => ({ createBackend: vi.fn(() => fake.backend) }));

import { createBackend } from '../../../bun/backend';
import { redmineApi } from '../api';
import { backend, hasDesktopBackend, hasWindowLayer } from '../bridge';
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
    expect(createBackend).toHaveBeenCalledWith(fake.platform);
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
      getDevPreviewStatus: [],
      setDevPreviewEnabled: [true],
      recordDiagnostic: ['error', 'scope', 'message'],
      createFeedback: [{ title: 't', description: 'd', includeLogs: true }],
      openIssueLink: ['https://github.com/iVegas/gemiredmine/issues/new'],
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
  it('are not offered, even in the desktop app, until the window layer exists', () => {
    vi.mocked(isTauri).mockReturnValue(true);

    expect(hasWindowLayer()).toBe(false);
    expect(canDetachViews()).toBe(false);
  });
});
