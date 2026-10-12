import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signInWithPassword } from '../auth';

const jsonResponse = (body: unknown) =>
  ({ ok: true, text: async () => JSON.stringify(body) }) as Response;

describe('signInWithPassword', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns the API key and a summary of the user', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K', mail: 'ana@example.com', api_key: 'key-123' }
      })
    );

    const result = await signInWithPassword('https://redmine.example.com/', 'ana', 'secret');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://redmine.example.com/users/current.json',
      expect.anything()
    );
    expect(result).toEqual({
      apiKey: 'key-123',
      user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K' }
    });
  });

  it('does not return the password', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K', api_key: 'key-123' } })
    );

    const result = await signInWithPassword('https://redmine.example.com', 'ana', 'secret');

    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports invalid credentials for a 401 response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    } as Response);

    await expect(signInWithPassword('https://redmine.example.com', 'ana', 'wrong')).rejects.toThrow(
      'Invalid username or password.'
    );
  });

  it('fails clearly when Redmine withholds the API key', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ user: { id: 7, login: 'ana', firstname: 'Ana', lastname: 'K' } })
    );

    await expect(signInWithPassword('https://redmine.example.com', 'ana', 'secret')).rejects.toThrow(
      'did not return an API key'
    );
  });

  it('rejects non-http server URLs before making a request', async () => {
    await expect(signInWithPassword('javascript:alert(1)', 'ana', 'secret')).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
