import { writable, derived, get } from 'svelte/store';

export interface ServerUser {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
}

/**
 * A configured Redmine server. The API key lives only in memory for this session;
 * passwords are never stored.
 */
export interface ServerConnection {
  id: string;
  name: string;
  url: string;
  apiToken?: string;
  user?: ServerUser;
}

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
  activeServerId.update(currentId => {
    if (currentId !== id) return currentId;
    return get(servers)[0]?.id ?? null;
  });
}
