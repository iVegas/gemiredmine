import { get } from 'svelte/store';
import type { ServerAccess } from '../../shared/backend';
import { servers, updateServer } from './store';

const sameAddress = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/**
 * A server rejected an API key (it answered 401), so the sign-in to it is over: the key may have been reset. The
 * server is signed out, with a notice for the sign-in form. Where the key was kept in the credential store, it is
 * forgotten there too, because credentials.ts follows the servers. Does nothing for a key that no server holds, such
 * as one that is still being tried in the form that adds a server.
 */
export function expireSignIn(access: ServerAccess): void {
  const server = get(servers).find((candidate) => candidate.apiToken === access.apiKey && sameAddress(candidate.url, access.baseUrl));
  if (!server) return;
  updateServer(server.id, {
    apiToken: undefined,
    signInNotice: `Your sign-in to ${server.name} is no longer valid: the server rejected the API key. Sign in again.`,
  });
}
