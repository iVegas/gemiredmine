import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedmineClient, RedmineApiError, assertHttpUrl } from '../client';

const jsonResponse = (body: unknown) =>
  ({ ok: true, text: async () => JSON.stringify(body) }) as Response;

const requestedUrl = (callIndex: number) =>
  new URL(vi.mocked(global.fetch).mock.calls[callIndex][0] as string);

describe('RedmineClient', () => {
  let client: RedmineClient;

  beforeEach(() => {
    client = new RedmineClient({ baseUrl: 'https://redmine.example.com', apiKey: 'test-key' });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('formats baseUrl correctly by removing trailing slash', () => {
    const clientWithSlash = new RedmineClient({ baseUrl: 'https://test.com/' });
    // @ts-ignore - access private for testing
    expect(clientWithSlash.config.baseUrl).toBe('https://test.com');
  });

  it('makes successful GET requests', async () => {
    const mockResponse = { trackers: [{ id: 1, name: 'Bug' }] };
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockResponse)
    } as Response);

    const result = await client.getTrackers();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://redmine.example.com/trackers.json',
      expect.objectContaining({
        headers: expect.any(Headers)
      })
    );
    expect(result).toEqual(mockResponse);
  });

  it('throws error on failed requests', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    } as Response);

    await expect(client.getTrackers()).rejects.toThrow('Redmine API request failed: 404 Not Found');
  });

  it('uses API key authentication if provided', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({})
    } as Response);

    await client.getTrackers();

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const headers = fetchCall[1]?.headers as Headers;
    expect(headers.get('X-Redmine-API-Key')).toBe('test-key');
  });

  it('uses Basic authentication if username and password are provided', async () => {
    const authClient = new RedmineClient({
      baseUrl: 'https://redmine.example.com',
      username: 'user',
      password: 'password'
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({})
    } as Response);

    await authClient.getTrackers();

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const headers = fetchCall[1]?.headers as Headers;

    // btoa('user:password') = dXNlcjpwYXNzd29yZA==
    expect(headers.get('Authorization')).toBe('Basic dXNlcjpwYXNzd29yZA==');
  });

  it('handles empty response body gracefully', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => ''
    } as Response);

    const result = await client.getTrackers();

    expect(result).toBeUndefined();
  });

  it('exposes the HTTP status on RedmineApiError', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    } as Response);

    const error = await client.getTrackers().catch((e) => e);

    expect(error).toBeInstanceOf(RedmineApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe('Redmine API request failed: 401 Unauthorized');
  });

  it('encodes non-Latin-1 passwords as UTF-8 in Basic auth', async () => {
    const authClient = new RedmineClient({
      baseUrl: 'https://redmine.example.com',
      username: 'jörg',
      password: 'pässwörd€'
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}));

    await authClient.getTrackers();

    const headers = vi.mocked(global.fetch).mock.calls[0][1]?.headers as Headers;
    const expected = Buffer.from('jörg:pässwörd€', 'utf8').toString('base64');
    expect(headers.get('Authorization')).toBe(`Basic ${expected}`);
  });

  it('fetches the current user', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K', api_key: 'abc' } })
    );

    const result = await client.getCurrentUser();

    expect(requestedUrl(0).pathname).toBe('/users/current.json');
    expect(result.user.api_key).toBe('abc');
  });

  it('collects time entries across pages for the current user and range', async () => {
    const page = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: i, spent_on: '2026-10-01', hours: 1 }));
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ time_entries: page(100), total_count: 150, offset: 0, limit: 100 }))
      .mockResolvedValueOnce(jsonResponse({ time_entries: page(50), total_count: 150, offset: 100, limit: 100 }));

    const entries = await client.getTimeEntries({ from: '2026-10-01', to: '2026-10-31' });

    expect(entries).toHaveLength(150);
    expect(requestedUrl(0).searchParams.get('user_id')).toBe('me');
    expect(requestedUrl(0).searchParams.get('from')).toBe('2026-10-01');
    expect(requestedUrl(0).searchParams.get('to')).toBe('2026-10-31');
    expect(requestedUrl(0).searchParams.get('offset')).toBe('0');
    expect(requestedUrl(1).searchParams.get('offset')).toBe('100');
  });

  it('stops paging when a page is shorter than the page size', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ time_entries: [{ id: 1 }], total_count: 500, offset: 0, limit: 100 })
    );

    const entries = await client.getTimeEntries({ from: '2026-10-01', to: '2026-10-31' });

    expect(entries).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('queries open issues assigned to the current user with a due-date range', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ issues: [{ id: 42, subject: 'Write docs' }], total_count: 1, offset: 0, limit: 100 })
    );

    const issues = await client.getAssignedOpenIssues({ dueFrom: '2026-10-01', dueTo: '2026-10-31' });

    expect(issues).toEqual([{ id: 42, subject: 'Write docs' }]);
    expect(requestedUrl(0).pathname).toBe('/issues.json');
    expect(requestedUrl(0).searchParams.get('assigned_to_id')).toBe('me');
    expect(requestedUrl(0).searchParams.get('status_id')).toBe('open');
    expect(requestedUrl(0).searchParams.get('due_date')).toBe('><2026-10-01|2026-10-31');
  });
});

describe('assertHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(assertHttpUrl('https://redmine.example.com')).toBe('https://redmine.example.com');
    expect(assertHttpUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('rejects other schemes and malformed URLs', () => {
    expect(() => assertHttpUrl('file:///etc/passwd')).toThrow('must start with http:// or https://');
    expect(() => assertHttpUrl('not a url')).toThrow('not valid');
  });
});
