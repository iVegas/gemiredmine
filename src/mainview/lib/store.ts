import { writable, derived, get } from 'svelte/store';
import { closeViewsOfServer } from './views';

export interface ServerUser {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
}

/**
 * A configured Redmine server. Passwords are never stored. The API key lives in memory; when the user chose to be
 * remembered, it is also kept in the system's credential store (see credentials.ts), and nowhere else.
 */
export interface ServerConnection {
  id: string;
  name: string;
  url: string;
  apiToken?: string;
  user?: ServerUser;
  /** Whether the user chose to be remembered at this server. Missing means yes, which is the default. */
  remember?: boolean;
  /** Why the user has to sign in again, when the server rejected the API key. Shown with the sign-in form. */
  signInNotice?: string;
}

/** Whether the API key of this server is kept in the credential store. It is, unless the user chose otherwise. */
export const remembersSignIn = (server: Pick<ServerConnection, 'remember'>): boolean => server.remember !== false;

export const servers = writable<ServerConnection[]>([]);
export const activeServerId = writable<string | null>(null);

export const serversById = derived(servers, ($servers) =>
  $servers.reduce((acc, server) => acc.set(server.id, server), new Map<string, ServerConnection>())
);

export const activeServer = derived([serversById, activeServerId], ([$serversById, $activeServerId]) =>
  $activeServerId ? $serversById.get($activeServerId) ?? null : null
);

export function addServer(server: Omit<ServerConnection, 'id'>): string {
  const id = crypto.randomUUID();
  servers.update(current => [...current, { ...server, id }]);

  // Auto-select if it's the first server
  activeServerId.update(currentId => currentId === null ? id : currentId);
  return id;
}

export function updateServer(id: string, patch: Partial<Omit<ServerConnection, 'id'>>) {
  servers.update(current =>
    current.map(server => (server.id === id ? { ...server, ...patch } : server))
  );
}

/** Removes a server. If it was the active one, the first remaining server becomes active. */
export function removeServer(id: string) {
  servers.update(current => current.filter(server => server.id !== id));
  // What was open of this server has nothing to show any more.
  closeViewsOfServer(id);
  activeServerId.update(currentId => {
    if (currentId !== id) return currentId;
    return get(servers)[0]?.id ?? null;
  });
}
