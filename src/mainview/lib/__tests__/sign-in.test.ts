import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { expireSignIn } from '../sign-in';
import { servers } from '../store';

const alice = { id: 1, login: 'alice', firstname: 'Alice', lastname: 'Example' };

describe('expireSignIn', () => {
  beforeEach(() => {
    servers.set([
      { id: 'a1', name: 'Work', url: 'https://work.example/redmine', apiToken: 'key-work', user: alice },
      { id: 'b2', name: 'Home', url: 'https://home.example', apiToken: 'key-home', user: alice },
    ]);
  });

  it('signs the user out of the server that held the key, and says why, keeping who they were', () => {
    expireSignIn({ baseUrl: 'https://work.example/redmine', apiKey: 'key-work' });

    const [work, home] = get(servers);
    expect(work.apiToken).toBeUndefined();
    expect(work.signInNotice).toContain('Work');
    expect(work.signInNotice).toContain('no longer valid');
    expect(work.user).toEqual(alice);
    expect(home.apiToken).toBe('key-home');
    expect(home.signInNotice).toBeUndefined();
  });

  it('finds the server whether or not the address ends with a slash', () => {
    expireSignIn({ baseUrl: 'https://home.example/', apiKey: 'key-home' });

    expect(get(servers)[1].apiToken).toBeUndefined();
  });

  it('leaves a key that no server holds alone, such as one tried in the form that adds a server', () => {
    const before = get(servers);

    expireSignIn({ baseUrl: 'https://work.example/redmine', apiKey: 'some-other-key' });
    expireSignIn({ baseUrl: 'https://elsewhere.example', apiKey: 'key-work' });

    expect(get(servers)).toEqual(before);
  });
});
