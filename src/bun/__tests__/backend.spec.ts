import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BuildInfo } from '../../shared/build-info';
import { createBackend, type BackendOptions, type BackendPlatform } from '../backend';
import { DevPreview } from '../diagnostics/service';
import type { FetchLike } from '../redmine/client';
import { createMemoryDataFs } from '../diagnostics/__tests__/support/memory-data-fs';

const info: BuildInfo = {
  version: '1.0.0-unstable.7',
  channel: 'unstable',
  label: 'Unstable',
  appName: 'Gemiredmine-Unstable',
  productName: 'Gemiredmine Unstable',
  identifier: 'com.gemiredmine.app.unstable',
  dataDirName: 'gemiredmine-unstable',
  platform: 'linux',
  devPreviewAvailable: true,
  repositoryUrl: 'https://github.com/iVegas/gemiredmine',
  commit: 'abc1234',
  buildDate: '2026-10-12T00:00:00.000Z',
};

const DATA_DIR = '/data/gemiredmine-unstable';
const access = { baseUrl: 'https://redmine.example.com', apiKey: 'test-key' };

const ok = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) }) as Response;
const failed = (status: number, statusText: string) => ({ ok: false, status, statusText }) as Response;
const list = (key: string, items: unknown[] = []) => ok({ [key]: items, total_count: items.length, offset: 0, limit: 100 });

function setup(options: BackendOptions = {}) {
  const files = createMemoryDataFs();
  const fetchMock = vi.fn<FetchLike>();
  const openUrl = vi.fn(async () => {});
  const platform: BackendPlatform = {
    fetch: fetchMock,
    fs: files,
    dataDir: async () => DATA_DIR,
    openUrl,
    environment: async () => ({ platform: 'linux', arch: 'x64', runtime: 'test 1.0' }),
  };
  const backend = createBackend(platform, { buildInfo: info, devPreviewAvailable: true, DevPreviewImpl: DevPreview, ...options });
  return { backend, fetchMock, openUrl, files };
}

/** A platform that can say what this computer is set up for, as the desktop shell's does. */
function setupWithSystemAiSetup(systemAiSetup: NonNullable<BackendPlatform['systemAiSetup']>) {
  const files = createMemoryDataFs();
  const fetchMock = vi.fn<FetchLike>();
  const openUrl = vi.fn(async () => {});
  const platform: BackendPlatform = {
    fetch: fetchMock,
    fs: files,
    dataDir: async () => DATA_DIR,
    openUrl,
    systemAiSetup,
    environment: async () => ({ platform: 'linux', arch: 'x64', runtime: 'test 1.0' }),
  };
  return { backend: createBackend(platform, { buildInfo: info, devPreviewAvailable: true, DevPreviewImpl: DevPreview }), fetchMock, openUrl, files };
}

const requested = (fetchMock: ReturnType<typeof setup>['fetchMock'], call = 0) => new URL(fetchMock.mock.calls[call][0]);
const headerOf = (fetchMock: ReturnType<typeof setup>['fetchMock'], name: string, call = 0) =>
  (fetchMock.mock.calls[call][1].headers as Headers).get(name);

describe('Redmine calls', () => {
  it('lists time entries for the signed-in user and range', async () => {
    const { backend, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(list('time_entries', [{ id: 1 }]));

    const entries = await backend.listTimeEntries(access, { from: '2026-10-01', to: '2026-10-31' });

    expect(entries).toEqual([{ id: 1 }]);
    expect(requested(fetchMock).origin + requested(fetchMock).pathname).toBe('https://redmine.example.com/time_entries.json');
    expect(requested(fetchMock).searchParams.get('user_id')).toBe('me');
    expect(requested(fetchMock).searchParams.get('from')).toBe('2026-10-01');
    expect(requested(fetchMock).searchParams.get('to')).toBe('2026-10-31');
    expect(headerOf(fetchMock, 'X-Redmine-API-Key')).toBe('test-key');
  });

  it('lists open tasks due in a range', async () => {
    const { backend, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(list('issues', [{ id: 42 }]));

    await backend.listOpenTasks(access, { dueFrom: '2026-10-01', dueTo: '2026-10-31' });

    expect(requested(fetchMock).pathname).toBe('/issues.json');
    expect(requested(fetchMock).searchParams.get('due_date')).toBe('><2026-10-01|2026-10-31');
  });

  it('lists every assigned task, highest priority first', async () => {
    const { backend, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(list('issues', [{ id: 7 }]));

    await backend.listAssignedTasks(access);

    expect(requested(fetchMock).searchParams.get('sort')).toBe('priority:desc');
    expect(requested(fetchMock).searchParams.has('due_date')).toBe(false);
  });

  it('signs in with a password and returns only the key and a summary of the user', async () => {
    const { backend, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      ok({ user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K', mail: 'ana@example.com', api_key: 'key-123' } })
    );

    const result = await backend.signIn({ baseUrl: access.baseUrl, username: 'ana', password: 'secret' });

    expect(result).toEqual({ apiKey: 'key-123', user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K' } });
    expect(headerOf(fetchMock, 'Authorization')).toMatch(/^Basic /);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('does not hand the API key or the address back when asked who is signed in', async () => {
    const { backend, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      ok({ user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K', mail: 'ana@example.com', api_key: 'key-123' } })
    );

    expect(await backend.getCurrentUser(access)).toEqual({ id: 7, login: 'ana', firstname: 'Ana', lastname: 'K' });
  });

  it('refuses a server URL that is not http(s) before sending anything', async () => {
    const { backend, fetchMock } = setup();

    await expect(backend.listAssignedTasks({ baseUrl: 'file:///etc/passwd', apiKey: 'k' })).rejects.toThrow(
      'must start with http:// or https://'
    );
    await expect(backend.signIn({ baseUrl: 'javascript:alert(1)', username: 'a', password: 'b' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops waiting for a server that does not answer, and aborts the request', async () => {
    vi.useFakeTimers();
    const { backend, fetchMock } = setup();
    fetchMock.mockReturnValue(new Promise(() => {}));

    const outcome = expect(backend.listAssignedTasks(access)).rejects.toThrow(
      'The Redmine server did not answer within 30 seconds.'
    );
    const signal = fetchMock.mock.calls[0][1].signal!;
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);

    await outcome;
    expect(signal.aborted).toBe(true);
  });

  it('uses the limit it was given', async () => {
    vi.useFakeTimers();
    const { backend, fetchMock } = setup({ timeoutMs: 5_000 });
    fetchMock.mockReturnValue(new Promise(() => {}));

    const outcome = expect(backend.listTimeEntries(access, { from: 'a', to: 'b' })).rejects.toThrow('within 5 seconds');
    await vi.advanceTimersByTimeAsync(5_000);

    await outcome;
  });
});

describe('failures in the developer preview log', () => {
  it('records a failed call when the preview is on', async () => {
    const { backend, fetchMock, files } = setup();
    await backend.setDevPreviewEnabled(true);
    fetchMock.mockResolvedValueOnce(failed(503, 'Service Unavailable'));

    await expect(backend.listAssignedTasks(access)).rejects.toThrow('Redmine API request failed: 503 Service Unavailable');
    await backend.setDevPreviewEnabled(false); // writes the pending entries

    const [line] = files.files.get(`${DATA_DIR}/logs/diagnostics.jsonl`)!.trim().split('\n');
    expect(JSON.parse(line)).toMatchObject({
      level: 'error',
      scope: 'listAssignedTasks',
      message: 'Redmine API request failed: 503 Service Unavailable',
    });
  });

  it('records nothing while the preview is off', async () => {
    const { backend, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(failed(500, 'Internal Server Error'));

    await expect(backend.getCurrentUser(access)).rejects.toThrow('500');

    expect((await backend.getDevPreviewStatus()).pendingEntries).toBe(0);
  });

  it('still reports the Redmine error when the log itself cannot be opened', async () => {
    const DevPreviewImpl = { open: vi.fn().mockRejectedValue(new Error('disk exploded')) } as unknown as typeof DevPreview;
    const { backend, fetchMock } = setup({ DevPreviewImpl });
    fetchMock.mockResolvedValueOnce(failed(503, 'Service Unavailable'));

    await expect(backend.listAssignedTasks(access)).rejects.toThrow('Redmine API request failed: 503');
  });
});

describe('developer preview', () => {
  it('creates one preview, even when the first calls arrive together', async () => {
    const open = vi.fn(DevPreview.open.bind(DevPreview));
    const { backend } = setup({ DevPreviewImpl: { open } as unknown as typeof DevPreview });

    await Promise.all([backend.getDevPreviewStatus(), backend.getDevPreviewStatus(), backend.setDevPreviewEnabled(true)]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        dataDir: DATA_DIR,
        available: true,
        repositoryUrl: 'https://github.com/iVegas/gemiredmine',
        environment: {
          productName: 'Gemiredmine Unstable',
          version: '1.0.0-unstable.7',
          channel: 'unstable',
          commit: 'abc1234',
          buildDate: '2026-10-12T00:00:00.000Z',
          platform: 'linux',
          arch: 'x64',
          runtime: 'test 1.0',
        },
      })
    );
  });

  it('tries again after the preview failed to start', async () => {
    const open = vi
      .fn(DevPreview.open.bind(DevPreview))
      .mockRejectedValueOnce(new Error('disk exploded'));
    const { backend } = setup({ DevPreviewImpl: { open } as unknown as typeof DevPreview });

    await expect(backend.getDevPreviewStatus()).rejects.toThrow('disk exploded');
    await expect(backend.getDevPreviewStatus()).resolves.toMatchObject({ available: true, enabled: false });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('records diagnostics from the webview and turns them into feedback', async () => {
    const { backend, files } = setup();
    await backend.setDevPreviewEnabled(true);
    await backend.recordDiagnostic('warn', 'ui', 'token=s3cr3t-value leaked?');

    const result = await backend.createFeedback({ title: 'Calendar is empty', description: 'After switching months', includeLogs: true });

    expect(result.issueUrl.startsWith('https://github.com/iVegas/gemiredmine/issues/new?')).toBe(true);
    expect(result.reportPath.startsWith(`${DATA_DIR}/feedback/`)).toBe(true);
    const report = files.files.get(result.reportPath)!;
    expect(report).toContain('After switching months');
    expect(report).toContain('token=[REDACTED]');
    expect(report).not.toContain('s3cr3t-value');
    expect(report).toContain('- Runtime: test 1.0');
  });

  it('opens only the project issue page', async () => {
    const { backend, openUrl } = setup();
    const issue = 'https://github.com/iVegas/gemiredmine/issues/new?title=x';

    await backend.openIssueLink(issue);
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(issue);

    for (const url of [
      'https://evil.example/issues/new?title=x',
      'https://github.com/iVegas/gemiredmine/issues',
      'https://github.com/iVegas/gemiredmine.evil.example/issues/new?title=x',
      'file:///etc/passwd',
    ]) {
      await expect(backend.openIssueLink(url)).rejects.toThrow('outside the project issue tracker');
    }
    expect(openUrl).toHaveBeenCalledTimes(1);
  });
});

describe('a preview owned by another window', () => {
  const port = () => ({
    status: vi.fn(async () => ({ available: true, enabled: true, dataDir: '/owner', logBytes: 5, pendingEntries: 1 })),
    setEnabled: vi.fn(async (enabled: boolean) => ({ available: true, enabled, dataDir: '/owner', logBytes: 0, pendingEntries: 0 })),
    record: vi.fn(),
    createFeedback: vi.fn(async () => ({ issueUrl: 'https://github.com/x', reportPath: '/owner/feedback/a.md', logsIncluded: 'all' as const })),
  });
  const openSpy = () => vi.spyOn(DevPreview, 'open');

  afterEach(() => vi.restoreAllMocks());

  it('hands every preview request to it and opens nothing of its own', async () => {
    const preview = port();
    const open = openSpy();
    const { backend, files } = setup({ preview });

    expect((await backend.getDevPreviewStatus()).dataDir).toBe('/owner');
    await backend.setDevPreviewEnabled(false);
    await backend.recordDiagnostic('warn', 'webview', 'something');
    await backend.createFeedback({ title: 'T', description: 'D', includeLogs: true });

    expect(preview.setEnabled).toHaveBeenCalledWith(false);
    expect(preview.record).toHaveBeenCalledWith({ level: 'warn', scope: 'webview', message: 'something' });
    expect(preview.createFeedback).toHaveBeenCalledWith({ title: 'T', description: 'D', includeLogs: true });
    expect(open).not.toHaveBeenCalled();
    expect(files.files.size).toBe(0);
  });

  it('records a failed Redmine call there', async () => {
    const preview = port();
    const { backend, fetchMock } = setup({ preview });
    fetchMock.mockResolvedValueOnce(failed(500, 'Server Error'));

    await expect(backend.listAssignedTasks(access)).rejects.toThrow('500');

    expect(preview.record).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', scope: 'listAssignedTasks' }));
  });

  it('still reports the Redmine error when the owner cannot be reached', async () => {
    const preview = port();
    preview.record.mockImplementation(() => {
      throw new Error('The main window is gone.');
    });
    const { backend, fetchMock } = setup({ preview });
    fetchMock.mockResolvedValueOnce(failed(401, 'Unauthorized'));

    await expect(backend.getCurrentUser(access)).rejects.toThrow('401');
  });

  it('is not used by a build without the developer preview', async () => {
    const preview = port();
    const { backend } = setup({ preview, devPreviewAvailable: false });

    expect((await backend.getDevPreviewStatus()).available).toBe(false);
    await backend.recordDiagnostic('error', 's', 'm');

    expect(preview.status).not.toHaveBeenCalled();
    expect(preview.record).not.toHaveBeenCalled();
  });
});

describe('a build without the developer preview', () => {
  const unavailable = () => {
    const open = vi.fn();
    return { ...setup({ devPreviewAvailable: false, DevPreviewImpl: { open } as unknown as typeof DevPreview }), open };
  };

  it('reports it as unavailable without starting anything', async () => {
    const { backend, open, files } = unavailable();

    expect(await backend.getDevPreviewStatus()).toEqual({
      available: false,
      enabled: false,
      dataDir: '',
      logBytes: 0,
      pendingEntries: 0,
    });
    await expect(backend.recordDiagnostic('error', 'ui', 'ignored')).resolves.toBeUndefined();

    expect(open).not.toHaveBeenCalled();
    expect(files.files.size).toBe(0);
  });

  it('refuses to turn it on, send feedback or open a link', async () => {
    const { backend, openUrl } = unavailable();

    await expect(backend.setDevPreviewEnabled(true)).rejects.toThrow('not available in this build');
    await expect(backend.createFeedback({ title: 't', description: 'd', includeLogs: false })).rejects.toThrow('not available');
    await expect(backend.openIssueLink('https://github.com/iVegas/gemiredmine/issues/new?title=x')).rejects.toThrow('not available');
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe('setting the assistant up without the user typing an address or a key', () => {
  const models = (ids: string[]) => ({ ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) }) as unknown as Response;

  it('reports the local model servers that answer, and the services this computer already has a key for', async () => {
    const { backend, fetchMock } = setup();
    fetchMock.mockImplementation(async (url) =>
      url === 'http://127.0.0.1:11434/v1/models' ? models(['qwen3:8b']) : failed(500, 'Internal Server Error')
    );

    expect(await backend.findLocalModelServers()).toEqual([
      { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b'] },
    ]);
    expect(await backend.findSystemAiSetup()).toEqual([]);
  });

  it('asks the address the computer is set up for as well, before the usual ones', async () => {
    const found = [{ provider: 'openai-compatible' as const, kind: 'address' as const, source: 'the OLLAMA_HOST environment variable', value: 'http://192.168.1.50:11434' }];
    const { backend, fetchMock } = setupWithSystemAiSetup(async () => found);
    fetchMock.mockImplementation(async (url) =>
      url === 'http://192.168.1.50:11434/v1/models' ? models([]) : failed(500, 'Internal Server Error')
    );

    const servers = await backend.findLocalModelServers();

    expect(servers).toEqual([{ label: 'The address this computer is set up for', baseUrl: 'http://192.168.1.50:11434/v1', models: [] }]);
    expect(await backend.findSystemAiSetup()).toEqual(found);
  });

  it('reports nothing found where the platform cannot look, or when the look fails', async () => {
    const { backend } = setup();
    expect(await backend.findSystemAiSetup()).toEqual([]);

    const { backend: failing } = setupWithSystemAiSetup(async () => {
      throw new Error('no environment here');
    });
    expect(await failing.findSystemAiSetup()).toEqual([]);
  });

  it('opens the page of a service by its name, so no link of the webview’s choosing can be opened', async () => {
    const { backend, openUrl } = setup();

    await backend.openAssistantKeyPage('gemini');
    expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://aistudio.google.com/apikey');

    await expect(backend.openAssistantKeyPage('https://evil.example' as never)).rejects.toThrow('is not a service this app can use');
    await expect(backend.openAssistantKeyPage('on-device')).rejects.toThrow('hands out no API key');
    expect(openUrl).toHaveBeenCalledTimes(1);
  });
});
