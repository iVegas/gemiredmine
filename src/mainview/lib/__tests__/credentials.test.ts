import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../api', () => ({ redmineApi: { loadCredentials: vi.fn(), saveCredential: vi.fn(), deleteCredential: vi.fn() } }));

import { redmineApi } from '../api';
import { credentialProblem, credentialsRestoring, startCredentials } from '../credentials';
import { servers, updateServer, removeServer, type ServerConnection } from '../store';

const api = vi.mocked(redmineApi);

const work: ServerConnection = { id: 'a1', name: 'Work', url: 'https://work.example' };
const home: ServerConnection = { id: 'b2', name: 'Home', url: 'https://home.example' };

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

const token = (id: string) => get(servers).find((server) => server.id === id)?.apiToken;

let stop: () => void = () => {};

beforeEach(() => {
  vi.resetAllMocks();
  api.loadCredentials.mockResolvedValue({ apiKeys: {}, problem: null });
  api.saveCredential.mockResolvedValue(undefined);
  api.deleteCredential.mockResolvedValue(undefined);
  servers.set([]);
  credentialProblem.set(null);
  credentialsRestoring.set(false);
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('reading the saved API keys', () => {
  it('asks for none, and holds nothing back, when no server is remembered', async () => {
    servers.set([{ ...work, remember: false }]);

    stop = startCredentials();
    await settle();

    expect(api.loadCredentials).not.toHaveBeenCalled();
    expect(get(credentialsRestoring)).toBe(false);
  });

  it('asks only for the servers that are remembered, and signs them in with what it finds', async () => {
    servers.set([work, { ...home, remember: false }, { id: 'c3', name: 'Third', url: 'https://third.example', remember: true }]);
    api.loadCredentials.mockResolvedValue({ apiKeys: { a1: 'key-a1' }, problem: null });

    stop = startCredentials();
    await settle();

    expect(api.loadCredentials).toHaveBeenCalledExactlyOnceWith(['a1', 'c3']);
    expect(token('a1')).toBe('key-a1');
    expect(token('b2')).toBeUndefined();
    expect(token('c3')).toBeUndefined();
  });

  it('shows the sign-in form only after the keys were read: it is restoring until then', async () => {
    const loading = deferred<{ apiKeys: Record<string, string>; problem: string | null }>();
    api.loadCredentials.mockReturnValue(loading.promise);
    servers.set([work]);

    stop = startCredentials();
    expect(get(credentialsRestoring)).toBe(true);

    loading.resolve({ apiKeys: { a1: 'k' }, problem: null });
    await settle();

    expect(get(credentialsRestoring)).toBe(false);
  });

  it('does not write back what it has just read', async () => {
    servers.set([work]);
    api.loadCredentials.mockResolvedValue({ apiKeys: { a1: 'key-a1' }, problem: null });

    stop = startCredentials();
    await settle();

    expect(api.saveCredential).not.toHaveBeenCalled();
    expect(api.deleteCredential).not.toHaveBeenCalled();
  });

  it('does not replace a key the user signed in with while the keys were being read, and keeps that one', async () => {
    const loading = deferred<{ apiKeys: Record<string, string>; problem: string | null }>();
    api.loadCredentials.mockReturnValue(loading.promise);
    servers.set([work]);
    stop = startCredentials();

    updateServer('a1', { apiToken: 'fresh-key' });
    loading.resolve({ apiKeys: { a1: 'old-key' }, problem: null });
    await settle();

    expect(token('a1')).toBe('fresh-key');
    expect(api.saveCredential).toHaveBeenCalledExactlyOnceWith('a1', 'fresh-key');
  });

  it('uses the keys it found before the store failed, and says why you have to sign in', async () => {
    servers.set([work, home]);
    api.loadCredentials.mockResolvedValue({ apiKeys: { a1: 'key-a1' }, problem: 'The keyring is locked.' });

    stop = startCredentials();
    await settle();

    expect(token('a1')).toBe('key-a1');
    expect(token('b2')).toBeUndefined();
    expect(get(credentialProblem)).toContain('could not be read');
    expect(get(credentialProblem)).toContain('The keyring is locked.');
    expect(get(credentialsRestoring)).toBe(false);
  });

  it('says so when reading fails altogether', async () => {
    servers.set([work]);
    api.loadCredentials.mockRejectedValue(new Error('no way to the Secret Service'));

    stop = startCredentials();
    await settle();

    expect(get(credentialProblem)).toContain('no way to the Secret Service');
    expect(get(credentialsRestoring)).toBe(false);
  });

  it('stops making the user wait after 30 seconds, and still uses the keys when they arrive', async () => {
    vi.useFakeTimers();
    const loading = deferred<{ apiKeys: Record<string, string>; problem: string | null }>();
    api.loadCredentials.mockReturnValue(loading.promise);
    servers.set([work]);
    stop = startCredentials();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(get(credentialsRestoring)).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(get(credentialsRestoring)).toBe(false);

    loading.resolve({ apiKeys: { a1: 'late-key' }, problem: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(token('a1')).toBe('late-key');
  });

  it('says that the store is slow once the user has waited, and takes that back when the answer comes', async () => {
    vi.useFakeTimers();
    const loading = deferred<{ apiKeys: Record<string, string>; problem: string | null }>();
    api.loadCredentials.mockReturnValue(loading.promise);
    servers.set([work]);
    stop = startCredentials();

    await vi.advanceTimersByTimeAsync(31_000);
    expect(get(credentialProblem)).toContain('taking long to read');
    expect(get(credentialsRestoring)).toBe(false);

    loading.resolve({ apiKeys: { a1: 'late-key' }, problem: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(get(credentialProblem)).toBeNull();
    expect(token('a1')).toBe('late-key');
  });

  it('replaces the notice about a slow store with the reason, when the answer is a failure', async () => {
    vi.useFakeTimers();
    const loading = deferred<{ apiKeys: Record<string, string>; problem: string | null }>();
    api.loadCredentials.mockReturnValue(loading.promise);
    servers.set([work]);
    stop = startCredentials();
    await vi.advanceTimersByTimeAsync(31_000);

    loading.resolve({ apiKeys: {}, problem: 'The keyring is locked.' });
    await vi.advanceTimersByTimeAsync(0);

    expect(get(credentialProblem)).toContain('The keyring is locked.');
    expect(get(credentialProblem)).not.toContain('taking long');
  });

  it('does not take away a notice that is about something else when the slow answer comes', async () => {
    vi.useFakeTimers();
    const loading = deferred<{ apiKeys: Record<string, string>; problem: string | null }>();
    api.loadCredentials.mockReturnValue(loading.promise);
    servers.set([work]);
    stop = startCredentials();
    await vi.advanceTimersByTimeAsync(31_000);
    credentialProblem.set('Your sign-in could not be remembered. Something else.');

    loading.resolve({ apiKeys: {}, problem: null });
    await vi.advanceTimersByTimeAsync(0);

    expect(get(credentialProblem)).toContain('Something else.');
  });

  it('changes nothing once it has been stopped', async () => {
    const loading = deferred<{ apiKeys: Record<string, string>; problem: string | null }>();
    api.loadCredentials.mockReturnValue(loading.promise);
    servers.set([work]);
    stop = startCredentials();

    stop();
    loading.resolve({ apiKeys: { a1: 'k' }, problem: null });
    await settle();

    expect(token('a1')).toBeUndefined();
    expect(get(credentialsRestoring)).toBe(false);
  });
});

describe('keeping the credential store in line with the servers', () => {
  beforeEach(async () => {
    servers.set([work, home]);
    stop = startCredentials();
    await settle();
    api.loadCredentials.mockClear();
  });

  it('keeps the API key of a server that is signed in to, when the user chose to be remembered', async () => {
    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    expect(api.saveCredential).toHaveBeenCalledExactlyOnceWith('a1', 'key-a1');
  });

  it('keeps nothing for a server where the user chose not to be remembered', async () => {
    updateServer('b2', { remember: false, apiToken: 'key-b2' });
    await settle();

    expect(api.saveCredential).not.toHaveBeenCalled();
    expect(api.deleteCredential).not.toHaveBeenCalled();
    expect(token('b2')).toBe('key-b2');
  });

  it('keeps the key once for the several changes that follow signing in', async () => {
    updateServer('a1', { apiToken: 'key-a1' });
    updateServer('a1', { user: { id: 1, login: 'alice', firstname: 'A', lastname: 'E' } });
    await settle();
    updateServer('a1', { name: 'Office' });
    await settle();

    expect(api.saveCredential).toHaveBeenCalledTimes(1);
  });

  it('forgets the key when the user signs out', async () => {
    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    updateServer('a1', { apiToken: undefined, user: undefined });
    await settle();

    expect(api.deleteCredential).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('forgets the key when the server rejects it', async () => {
    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    updateServer('a1', { apiToken: undefined, signInNotice: 'Sign in again.' });
    await settle();

    expect(api.deleteCredential).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('forgets the key when the user turns remembering off, and keeps it again when it is turned on', async () => {
    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    updateServer('a1', { remember: false });
    await settle();
    expect(api.deleteCredential).toHaveBeenCalledExactlyOnceWith('a1');
    expect(token('a1')).toBe('key-a1');

    updateServer('a1', { remember: true });
    await settle();
    expect(api.saveCredential).toHaveBeenCalledTimes(2);
    expect(api.saveCredential).toHaveBeenLastCalledWith('a1', 'key-a1');
  });

  it('forgets the key of a server that is removed', async () => {
    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    removeServer('a1');
    await settle();

    expect(api.deleteCredential).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('does not ask the store to forget what it never held', async () => {
    updateServer('b2', { apiToken: undefined });
    removeServer('b2');
    await settle();

    expect(api.deleteCredential).not.toHaveBeenCalled();
  });

  it('replaces the key when the user signs in again with another', async () => {
    updateServer('a1', { apiToken: 'first' });
    await settle();

    updateServer('a1', { apiToken: 'second' });
    await settle();

    expect(api.saveCredential).toHaveBeenCalledTimes(2);
    expect(api.saveCredential).toHaveBeenLastCalledWith('a1', 'second');
  });

  it('works on one server at a time', async () => {
    let running = 0;
    let overlapped = false;
    api.saveCredential.mockImplementation(async () => {
      overlapped ||= ++running > 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
    });

    updateServer('a1', { apiToken: 'key-a1' });
    updateServer('b2', { apiToken: 'key-b2' });
    await vi.waitFor(() => expect(api.saveCredential).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(overlapped).toBe(false);
  });

  it('says so when a key cannot be kept, and the user stays signed in', async () => {
    api.saveCredential.mockRejectedValueOnce(new Error('The Secret Service could not be reached.'));

    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    expect(get(credentialProblem)).toContain('could not be remembered');
    expect(get(credentialProblem)).toContain('Secret Service');
    expect(token('a1')).toBe('key-a1');
  });

  it('tries again with the next change, and says nothing more when that works', async () => {
    api.saveCredential.mockRejectedValueOnce(new Error('disk full'));
    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    updateServer('b2', { name: 'Home office' });
    await settle();

    expect(api.saveCredential).toHaveBeenCalledTimes(2);
    expect(api.saveCredential).toHaveBeenLastCalledWith('a1', 'key-a1');
    expect(get(credentialProblem)).toBeNull();
  });

  it('says so when a key cannot be forgotten', async () => {
    updateServer('a1', { apiToken: 'key-a1' });
    await settle();
    api.deleteCredential.mockRejectedValueOnce(new Error('the keyring is locked'));

    updateServer('a1', { apiToken: undefined });
    await settle();

    expect(get(credentialProblem)).toContain('could not be removed');
    expect(get(credentialProblem)).toContain('the keyring is locked');
  });

  it('counts a store that does not answer as a failure after 30 seconds, and tries again with the next change', async () => {
    vi.useFakeTimers();
    api.saveCredential.mockReturnValueOnce(new Promise(() => {}));
    updateServer('a1', { apiToken: 'key-a1' });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(get(credentialProblem)).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(get(credentialProblem)).toContain('did not answer in 30 seconds');
    expect(token('a1')).toBe('key-a1');

    updateServer('b2', { name: 'Home office' });
    await vi.advanceTimersByTimeAsync(0);

    expect(api.saveCredential).toHaveBeenCalledTimes(2);
    expect(get(credentialProblem)).toBeNull();
  });

  it('does nothing once it has been stopped', async () => {
    stop();

    updateServer('a1', { apiToken: 'key-a1' });
    await settle();

    expect(api.saveCredential).not.toHaveBeenCalled();
  });
});

describe('a key that was read from the store', () => {
  it('is forgotten when the user signs out, because it is known to be there', async () => {
    servers.set([work]);
    api.loadCredentials.mockResolvedValue({ apiKeys: { a1: 'key-a1' }, problem: null });
    stop = startCredentials();
    await settle();

    updateServer('a1', { apiToken: undefined });
    await settle();

    expect(api.deleteCredential).toHaveBeenCalledExactlyOnceWith('a1');
  });

  it('is not assumed to be there when the store could not be read, so nothing is deleted blindly', async () => {
    servers.set([work]);
    api.loadCredentials.mockResolvedValue({ apiKeys: {}, problem: 'locked' });
    stop = startCredentials();
    await settle();

    updateServer('a1', { remember: false });
    await settle();

    expect(api.deleteCredential).not.toHaveBeenCalled();
  });
});
