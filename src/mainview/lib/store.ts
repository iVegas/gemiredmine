import { writable, derived, get } from 'svelte/store';
import type { RedmineReference } from '../../bun/redmine/types';
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

/**
 * The project that each server's views show, by server id. A server with none shows every project the user takes part
 * in, which is the default. Project ids belong to one server, so the choice is kept per server.
 */
export type ProjectSelection = Record<string, RedmineReference>;

const REMEMBERED_PROJECTS = 'gemiredmine.projects';

function isProjectSelection(value: unknown): value is ProjectSelection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((project: unknown) => {
    const { id, name } = (project ?? {}) as Partial<RedmineReference>;
    return typeof id === 'number' && typeof name === 'string';
  });
}

/** The choices the last run left on this computer. Nothing when they cannot be read: the views then show every project. */
function rememberedProjects(): ProjectSelection {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(REMEMBERED_PROJECTS) ?? 'null');
    return isProjectSelection(saved) ? saved : {};
  } catch {
    return {};
  }
}

function rememberProjects(selection: ProjectSelection) {
  try {
    localStorage.setItem(REMEMBERED_PROJECTS, JSON.stringify(selection));
  } catch {
    // Remembering a choice is a convenience. The views work without it.
  }
}

export const projectSelection = writable<ProjectSelection>(rememberedProjects());

/** The project the active server's views show, or null for every project the user takes part in. */
export const activeProject = derived([activeServerId, projectSelection], ([$activeServerId, $projectSelection]) =>
  $activeServerId ? $projectSelection[$activeServerId] ?? null : null
);

/** Shows one project in the views of a server, or every project again (null). The choice is kept on this computer. */
export function selectProject(serverId: string, project: RedmineReference | null) {
  const next = { ...get(projectSelection) };
  if (project) next[serverId] = { id: project.id, name: project.name };
  else delete next[serverId];
  projectSelection.set(next);
  rememberProjects(next);
}

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
  if (get(projectSelection)[id]) selectProject(id, null);
  activeServerId.update(currentId => {
    if (currentId !== id) return currentId;
    return get(servers)[0]?.id ?? null;
  });
}
