import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedmineClient } from '../client';

describe('RedmineClient', () => {
  let client: RedmineClient;

  beforeEach(() => {
    client = new RedmineClient({ baseUrl: 'https://redmine.example.com', apiKey: 'test-key' });
    global.fetch = vi.fn();
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
});
