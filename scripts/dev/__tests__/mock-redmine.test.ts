// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { API_KEY, ISSUE_COUNT, PASSWORD, USERNAME, createMockRedmine } from '../mock-redmine.mjs';
import { RedmineApiError, RedmineClient, RedmineMovedError, type FetchLike } from '../../../src/bun/redmine/client';
import { signInWithPassword } from '../../../src/bun/redmine/auth';

// The real Redmine client and sign-in, talking to the mock over real HTTP.

const TODAY = '2026-10-14';
const SLOW_MS = 200;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createMockRedmine({ today: TODAY, delayMs: SLOW_MS });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('sign-in', () => {
  it('exchanges a password for the API key', async () => {
    const result = await signInWithPassword(baseUrl, USERNAME, PASSWORD);

    expect(result).toEqual({
      apiKey: API_KEY,
      user: { id: 1, login: 'alice', firstname: 'Alice', lastname: 'Example' },
    });
  });

  it('maps a wrong password to the friendly message', async () => {
    await expect(signInWithPassword(baseUrl, USERNAME, 'wrong')).rejects.toThrow('Invalid username or password.');
  });

  it('accepts the API key afterwards', async () => {
    const { user } = await new RedmineClient({ baseUrl, apiKey: API_KEY }).getCurrentUser();

    expect(user.login).toBe('alice');
  });

  it('answers 401 to an unknown API key', async () => {
    const error = await new RedmineClient({ baseUrl, apiKey: 'f'.repeat(40) }).getCurrentUser().catch((e) => e);

    expect(error).toBeInstanceOf(RedmineApiError);
    expect(error.status).toBe(401);
  });
});

describe('lists', () => {
  const client = () => new RedmineClient({ baseUrl, apiKey: API_KEY });

  it('pages through every assigned task, highest priority first', async () => {
    const tasks = await client().getAssignedTasks();

    expect(tasks).toHaveLength(ISSUE_COUNT);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(ISSUE_COUNT);
    expect(tasks[0].priority.name).toBe('Immediate');
    expect(tasks.at(-1)?.priority.name).toBe('Low');
  });

  it('keeps only issues due in the requested range', async () => {
    const tasks = await client().getAssignedOpenIssues({ dueFrom: '2026-10-14', dueTo: '2026-10-16' });

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((task) => task.due_date! >= '2026-10-14' && task.due_date! <= '2026-10-16')).toBe(true);
  });

  it('keeps only time entries inside the requested range', async () => {
    const entries = await client().getTimeEntries({ from: '2026-10-05', to: '2026-10-09' });

    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.spent_on)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
  });
});

describe('redirects', () => {
  // Node follows redirects by default. The desktop HTTP client does not, so this is what the client sees there.
  const manualRedirects: FetchLike = (url, init) => fetch(url, { ...init, redirect: 'manual' });
  const clientFor = (path: string) => new RedmineClient({ baseUrl: `${baseUrl}${path}`, apiKey: API_KEY, fetch: manualRedirects });

  it('names the new address of a server that moved', async () => {
    const error = await clientFor('/moved').getCurrentUser().catch((e) => e);

    expect(error).toBeInstanceOf(RedmineMovedError);
    expect(error.status).toBe(301);
    expect(error.suggestedBaseUrl).toBe('https://elsewhere.example');
    expect(error.message).toBe('The server moved to https://elsewhere.example. Use that address as the server URL.');
  });

  it('recognises a list request that moved, query included', async () => {
    const error = await clientFor('/moved').getAssignedTasks().catch((e) => e);

    expect(error).toBeInstanceOf(RedmineMovedError);
    expect(error.suggestedBaseUrl).toBe('https://elsewhere.example');
  });

  it('does not offer the login page of a gateway as the server', async () => {
    const error = await clientFor('/sso').getCurrentUser().catch((e) => e);

    expect(error).toBeInstanceOf(RedmineMovedError);
    expect(error.status).toBe(302);
    expect(error.suggestedBaseUrl).toBeNull();
    expect(error.message).toContain('https://sso.example');
  });

  it('tells a moved server from wrong credentials when signing in', async () => {
    await expect(signInWithPassword(`${baseUrl}/moved`, USERNAME, PASSWORD, { fetch: manualRedirects })).rejects.toThrow(
      'The server moved to https://elsewhere.example.'
    );
  });
});

describe('like a real Redmine server', () => {
  it('sends no CORS headers, which is why requests are made outside the webview', async () => {
    const response = await fetch(`${baseUrl}/users/current.json`, { headers: { 'X-Redmine-API-Key': API_KEY } });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('asks for credentials with a Basic challenge', async () => {
    const response = await fetch(`${baseUrl}/issues.json`);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic');
  });
});

describe('special servers', () => {
  it('/moved redirects every request to the new address', async () => {
    const response = await fetch(`${baseUrl}/moved/users/current.json?x=1`, { redirect: 'manual' });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://elsewhere.example/users/current.json?x=1');
  });

  it('/sso redirects to a login page that does not contain the requested path', async () => {
    const response = await fetch(`${baseUrl}/sso/users/current.json`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location')!).host).toBe('sso.example');
    expect(response.headers.get('location')).not.toContain('current.json');
  });

  it('/slow answers like the plain server, but only after the delay', async () => {
    const started = performance.now();
    const response = await fetch(`${baseUrl}/slow/users/current.json`, { headers: { 'X-Redmine-API-Key': API_KEY } });

    expect(performance.now() - started).toBeGreaterThanOrEqual(SLOW_MS - 50);
    expect((await response.json()).user.login).toBe('alice');
  });
});
