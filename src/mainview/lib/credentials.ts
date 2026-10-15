import { get, writable } from 'svelte/store';
import { redmineApi } from './api';
import { remembersSignIn, servers, type ServerConnection } from './store';

// The API key of a server is kept in the system's credential store when the user chose to be remembered at that
// server, and only then. This module keeps the store in line with the servers: it reads the keys when the app starts,
// and afterwards follows every change, whichever way it came about: signing in, signing out, the choice being turned
// off, a server being removed, or the server rejecting the key.
//
// Nothing here stops the user from working. A store that cannot be used is reported, and the app carries on with the
// keys in memory.

/** True while the saved keys are being read, so that the sign-in form is not shown for a moment first. */
export const credentialsRestoring = writable(false);

/** Why the keys cannot be kept or read, in words for the user, or null. */
export const credentialProblem = writable<string | null>(null);

/** How long the user waits for the store, which may be asking for the password of a locked keyring. */
const RESTORE_WAIT_MS = 30_000;

/** How long a change to the store may take before it counts as failed. A store that never answers must not hold up the next. */
const CHANGE_WAIT_MS = 30_000;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Gives up waiting for `work` after `ms`. The work itself is not stopped, and what it says later is ignored. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The credential store did not answer in ${ms / 1000} seconds.`)), ms);
    work.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error))
    );
  });
}

/** The key a server should have in the store, or null when it should have none. */
const wanted = (server: ServerConnection): string | null => (remembersSignIn(server) && server.apiToken ? server.apiToken : null);

/** Main window: reads the keys of the servers that are remembered, then keeps the store in line. Returns a function that stops. */
export function startCredentials(): () => void {
  let stopped = false;
  // What the store holds, as far as is known, by server id: the key, null for none, absent for not known.
  const known = new Map<string, string | null>();

  // Reading the keys

  const ids = get(servers).filter(remembersSignIn).map((server) => server.id);
  if (ids.length > 0) {
    credentialsRestoring.set(true);
    const finish = () => credentialsRestoring.set(false);
    // The notice for a store that is slow, so that it can be taken away if the answer comes after all.
    const slow = 'The saved sign-ins are taking long to read: the system\'s credential store has not answered. You can sign in now.';
    const timer = setTimeout(() => {
      finish();
      if (!stopped) credentialProblem.set(slow);
    }, RESTORE_WAIT_MS);
    redmineApi
      .loadCredentials(ids)
      .then(({ apiKeys, problem }) => {
        if (stopped) return;
        if (get(credentialProblem) === slow) credentialProblem.set(null);
        for (const id of ids) {
          if (id in apiKeys) known.set(id, apiKeys[id]);
          else if (!problem) known.set(id, null);
        }
        // A server that was signed in to while the keys were read keeps the key it has.
        servers.update((list) =>
          list.map((server) => (server.id in apiKeys && !server.apiToken && remembersSignIn(server) ? { ...server, apiToken: apiKeys[server.id] } : server))
        );
        if (problem) credentialProblem.set(`The saved sign-ins could not be read, so you have to sign in. ${problem}`);
      })
      .catch((error: unknown) => {
        if (!stopped) credentialProblem.set(`The saved sign-ins could not be read, so you have to sign in. ${describe(error)}`);
      })
      .finally(() => {
        clearTimeout(timer);
        if (!stopped) finish();
      });
  }

  // Following the servers

  /** What has to be done to bring the store in line with the servers. */
  function changes(): Array<{ id: string; key: string | null }> {
    const list = get(servers);
    const result: Array<{ id: string; key: string | null }> = [];
    for (const server of list) {
      const key = wanted(server);
      const held = known.get(server.id);
      // Something is deleted only when it is known to be there.
      if (key === null ? typeof held === 'string' : held !== key) result.push({ id: server.id, key });
    }
    for (const [id, held] of known) {
      if (typeof held === 'string' && !list.some((server) => server.id === id)) result.push({ id, key: null });
    }
    return result;
  }

  let busy = false;
  async function flush() {
    if (busy) return;
    busy = true;
    try {
      for (let change = changes()[0]; change && !stopped; change = changes()[0]) {
        try {
          await within(
            CHANGE_WAIT_MS,
            change.key === null ? redmineApi.deleteCredential(change.id) : redmineApi.saveCredential(change.id, change.key)
          );
        } catch (error) {
          credentialProblem.set(
            change.key === null
              ? `A saved sign-in could not be removed from the credential store. ${describe(error)}`
              : `Your sign-in could not be remembered, so you stay signed in only until the app is closed. ${describe(error)}`
          );
          // The next change to a server tries again.
          return;
        }
        if (stopped) return;
        credentialProblem.set(null);
        if (get(servers).some((server) => server.id === change.id)) known.set(change.id, change.key);
        else known.delete(change.id);
      }
    } finally {
      busy = false;
    }
  }

  let queued = false;
  const unsubscribe = servers.subscribe(() => {
    if (queued) return;
    queued = true;
    // A change can touch several servers; look at the result once.
    queueMicrotask(() => {
      queued = false;
      if (!stopped) void flush();
    });
  });

  return () => {
    stopped = true;
    unsubscribe();
    credentialsRestoring.set(false);
  };
}
