import { get, writable } from 'svelte/store';
import type { SavedServers } from '../../shared/backend';
import { stableJson } from '../../shared/windows';
import { redmineApi } from './api';
import { hasDesktopBackend } from './bridge';
import { activeServerId, servers, type ServerConnection } from './store';

// The servers the user adds are kept in the app's database, so that the next start has them again. The main
// window does this for the whole app: a window with a view of its own gets its servers from the main window, and
// whatever it changes comes back to the main window, so the stores there are the ones to watch.
//
// The API key is not kept, and neither is the password. After a start the user signs in again, and the sign-in
// form starts with the name that was used last time.

/** Main window: false while the servers saved by an earlier run are loaded, so that no one sees an empty app first. */
export const serversRestored = writable(true);

/** Why the servers are not kept, in words for the user, or null when all is well. */
export const storageProblem = writable<string | null>(null);

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What of the servers is saved. The picking is explicit, so that the API key cannot slip into it. */
export function toSavedServers(list: readonly ServerConnection[], activeId: string | null): SavedServers {
  return {
    servers: list.map(({ id, name, url, user }) => ({
      id,
      name,
      url,
      ...(user ? { user: { id: user.id, login: user.login, firstname: user.firstname, lastname: user.lastname } } : {}),
    })),
    activeServerId: activeId,
  };
}

/**
 * Saves the servers whenever they change, one save at a time, the newest state last. `loaded` is the state the app
 * began with, which is saved already. Returns a function that stops.
 */
function saveChanges(loaded: SavedServers): () => void {
  // The newest state that was handed over to be saved. A save that fails clears it, so that the next change is
  // saved whatever it is.
  let newest = stableJson(loaded);
  let pending: SavedServers | null = null;
  let saving = false;
  let queued = false;
  let stopped = false;

  async function flush() {
    if (saving) return;
    saving = true;
    while (pending && !stopped) {
      const next: SavedServers = pending;
      pending = null;
      try {
        await redmineApi.saveServers(next);
        storageProblem.set(null);
      } catch (error) {
        newest = '';
        storageProblem.set(
          `Your servers could not be saved, so they will be missing the next time you start the app. ${describe(error)}`
        );
      }
    }
    saving = false;
  }

  const onChange = () => {
    if (queued) return;
    queued = true;
    // A change can touch both stores; wait for them and save the result once.
    queueMicrotask(() => {
      queued = false;
      const next = toSavedServers(get(servers), get(activeServerId));
      const json = stableJson(next);
      if (stopped || json === newest) return;
      newest = json;
      pending = next;
      void flush();
    });
  };

  const unsubscribers = [servers.subscribe(onChange), activeServerId.subscribe(onChange)];
  return () => {
    stopped = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

/**
 * Main window: puts the saved servers in the stores, then keeps saving the changes. Does nothing outside the
 * desktop app. When the saved servers cannot be read, nothing is saved in this run either: the stores are empty,
 * and saving them would erase what is still in the database. Returns a function that stops.
 */
export function startPersistence(): () => void {
  if (!hasDesktopBackend()) return () => {};

  let stopped = false;
  let stopSaving = () => {};
  serversRestored.set(false);
  redmineApi
    .loadSavedServers()
    .then((saved) => {
      if (stopped) return;
      servers.set(saved.servers);
      activeServerId.set(saved.activeServerId);
      stopSaving = saveChanges(saved);
    })
    .catch((error: unknown) => {
      storageProblem.set(
        `The servers saved by an earlier run could not be loaded, so nothing is saved in this run. ${describe(error)}`
      );
    })
    .finally(() => {
      if (!stopped) serversRestored.set(true);
    });

  return () => {
    stopped = true;
    stopSaving();
  };
}
