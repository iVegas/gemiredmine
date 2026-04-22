import { writable } from 'svelte/store';

export interface ServerConnection {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
  apiToken?: string;
}

export const servers = writable<ServerConnection[]>([]);
export const activeServerId = writable<string | null>(null);

export function addServer(server: Omit<ServerConnection, 'id'>) {
  const id = crypto.randomUUID();
  servers.update(current => [...current, { ...server, id }]);

  // Auto-select if it's the first server
  activeServerId.update(currentId => currentId === null ? id : currentId);
}
