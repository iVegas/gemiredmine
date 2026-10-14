// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { API_KEY, ISSUE_COUNT, PASSWORD, USERNAME, createMockRedmine } from '../../../scripts/dev/mock-redmine.mjs';
import type { BuildInfo } from '../../shared/build-info';
import { createBackend, type BackendPlatform } from '../backend';
import { DevPreview } from '../diagnostics/service';
import { nodeDataFs } from '../node-data-fs';

// The backend the desktop shell runs, with a real HTTP client, real files and a Redmine to talk to.
// It stands in for the window and the RPC transport, which are all that a manual smoke test adds.

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

let server: Server;
let baseUrl: string;
let workDir: string;
let dataDir: string;
const opened: string[] = [];

const platform = (): BackendPlatform => ({
  fetch: (url, init) => fetch(url, init),
  fs: nodeDataFs,
  dataDir: async () => dataDir,
  openUrl: async (url) => {
    opened.push(url);
  },
  environment: async () => ({ platform: 'linux', arch: 'x64', runtime: 'node test' }),
});

const backendWith = (overrides: Partial<BackendPlatform> = {}, timeoutMs?: number) =>
  createBackend({ ...platform(), ...overrides }, { buildInfo: info, devPreviewAvailable: true, DevPreviewImpl: DevPreview, timeoutMs });

beforeAll(async () => {
  server = createMockRedmine({ today: '2026-10-14', delayMs: 5_000 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  workDir = mkdtempSync(join(tmpdir(), 'gemi-backend-'));
  dataDir = join(workDir, info.dataDirName);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workDir, { recursive: true, force: true });
});

describe('the backend against a Redmine server', () => {
  const backend = backendWith();

  it('signs in with a password and then works with the API key', async () => {
    const signedIn = await backend.signIn({ baseUrl, username: USERNAME, password: PASSWORD });

    expect(signedIn).toEqual({ apiKey: API_KEY, user: { id: 1, login: 'alice', firstname: 'Alice', lastname: 'Example' } });
    expect(await backend.getCurrentUser({ baseUrl, apiKey: signedIn.apiKey })).toEqual(signedIn.user);
  });

  it('reports a wrong password in plain words', async () => {
    await expect(backend.signIn({ baseUrl, username: USERNAME, password: 'wrong' })).rejects.toThrow(
      'Invalid username or password.'
    );
  });

  it('lists every assigned task, over more than one page', async () => {
    const tasks = await backend.listAssignedTasks({ baseUrl, apiKey: API_KEY });

    expect(tasks).toHaveLength(ISSUE_COUNT);
    expect(tasks[0].priority.name).toBe('Immediate');
  });

  it('lists the tasks due in a range and the time logged in a range', async () => {
    const due = await backend.listOpenTasks({ baseUrl, apiKey: API_KEY }, { dueFrom: '2026-10-14', dueTo: '2026-10-16' });
    const entries = await backend.listTimeEntries({ baseUrl, apiKey: API_KEY }, { from: '2026-10-05', to: '2026-10-09' });

    expect(due.length).toBeGreaterThan(0);
    expect(due.every((task) => task.due_date! >= '2026-10-14' && task.due_date! <= '2026-10-16')).toBe(true);
    expect(entries).toHaveLength(5);
  });

  it('tells a server that moved from wrong credentials, when the HTTP client does not follow redirects', async () => {
    const strict = backendWith({ fetch: (url, init) => fetch(url, { ...init, redirect: 'manual' }) });

    await expect(strict.listAssignedTasks({ baseUrl: `${baseUrl}/moved`, apiKey: API_KEY })).rejects.toThrow(
      'The server moved to https://elsewhere.example. Use that address as the server URL.'
    );
  });

  it('gives up on a server that does not answer', async () => {
    const impatient = backendWith({}, 100);

    await expect(impatient.listAssignedTasks({ baseUrl: `${baseUrl}/slow`, apiKey: API_KEY })).rejects.toThrow(
      'The Redmine server did not answer within 0.1 seconds.'
    );
  });
});

describe('the developer preview on a real data folder', () => {
  it('collects what happened and turns it into feedback, keeping its files private', async () => {
    const backend = backendWith({}, 100);

    expect(await backend.getDevPreviewStatus()).toMatchObject({ available: true, enabled: false, dataDir, logBytes: 0 });
    await backend.setDevPreviewEnabled(true);
    await expect(backend.listAssignedTasks({ baseUrl: `${baseUrl}/slow`, apiKey: API_KEY })).rejects.toThrow('did not answer');
    await backend.recordDiagnostic('warn', 'ui', 'token=s3cr3t-value leaked?');

    const feedback = await backend.createFeedback({ title: 'Slow server', description: 'It hangs', includeLogs: true });
    await backend.openIssueLink(feedback.issueUrl);

    expect(opened).toEqual([feedback.issueUrl]);
    expect(feedback.issueUrl.startsWith('https://github.com/iVegas/gemiredmine/issues/new?')).toBe(true);

    const log = readFileSync(join(dataDir, 'logs', 'diagnostics.jsonl'), 'utf8');
    expect(log).toContain('"scope":"listAssignedTasks"');
    expect(log).toContain('did not answer within 0.1 seconds');
    expect(log).toContain('token=[REDACTED]');
    const report = readFileSync(feedback.reportPath, 'utf8');
    expect(report).toContain('It hangs');
    expect(report).not.toContain('s3cr3t-value');
    expect(readdirSync(join(dataDir, 'feedback'))).toHaveLength(1);

    if (process.platform !== 'win32') {
      const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);
      expect(mode(dataDir)).toBe('700');
      expect(mode(join(dataDir, 'logs'))).toBe('700');
      expect(mode(join(dataDir, 'settings.json'))).toBe('600');
      expect(mode(join(dataDir, 'logs', 'diagnostics.jsonl'))).toBe('600');
      expect(mode(feedback.reportPath)).toBe('600');
    }
  });

  it('remembers that it was turned on', async () => {
    expect(await backendWith().getDevPreviewStatus()).toMatchObject({ enabled: true });
  });
});
