import { writable, get } from 'svelte/store';

/** The views that exist once. */
export type StaticViewId = 'dashboard' | 'calendar' | 'todo' | 'assistant' | 'settings' | 'about';

/**
 * A view of one task or one log entry of one server: `task:<server id>:<number>` or `log:<server id>:<number>`. The
 * server is part of the id because the same number means another task on another server, and because the view
 * stays with its server when the user switches to another.
 */
export type DetailViewId = `task:${string}:${number}` | `log:${string}:${number}`;

/** Views the app shows in tabs. */
export type ViewId = StaticViewId | DetailViewId;

export const VIEW_TITLES: Record<StaticViewId, string> = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  todo: 'To-do',
  assistant: 'Assistant',
  settings: 'Settings',
  about: 'About',
};

/**
 * The views the app is for, in the order the navigation bar shows them. Everything a user comes here to do is one click
 * away: nothing of this is hidden in a menu. "About" is not here; it belongs with the account, in the user menu.
 */
export const PRIMARY_VIEWS: readonly StaticViewId[] = ['dashboard', 'calendar', 'todo', 'assistant', 'settings'];

const DETAIL_VIEW = /^(task|log):([A-Za-z0-9_-]{1,64}):([1-9]\d{0,14})$/;

export interface DetailViewTarget {
  kind: 'task' | 'log';
  serverId: string;
  /** The Redmine id of the task or the log entry */
  id: number;
}

/** What a detail view shows, or null when the id is not one. */
export function parseDetailView(view: string): DetailViewTarget | null {
  const match = DETAIL_VIEW.exec(view);
  return match ? { kind: match[1] as 'task' | 'log', serverId: match[2], id: Number(match[3]) } : null;
}

export const isDetailView = (view: string): view is DetailViewId => DETAIL_VIEW.test(view);

/** Whether a string names a view the app has: a view of the tabs, or a task or log entry. Ids from another window are checked with it. */
export const isViewId = (value: string): value is ViewId =>
  isDetailView(value) || Object.prototype.hasOwnProperty.call(VIEW_TITLES, value);

export const taskView = (serverId: string, taskId: number) => `task:${serverId}:${taskId}` as DetailViewId;
export const logView = (serverId: string, entryId: number) => `log:${serverId}:${entryId}` as DetailViewId;

/** What a detail view calls itself once it has loaded, such as the subject of a task. By view id. */
export const viewLabels = writable<Record<string, string>>({});

export function setViewLabel(view: ViewId, label: string) {
  viewLabels.update(labels => (labels[view] === label ? labels : { ...labels, [view]: label }));
}

/** The title of a tab: what its view called itself, or what can be told from the id alone. */
export function viewTitle(view: ViewId, labels: Record<string, string> = get(viewLabels)): string {
  if (labels[view]) return labels[view];
  const detail = parseDetailView(view);
  if (detail) return `${detail.kind === 'task' ? 'Task' : 'Log'} #${detail.id}`;
  return VIEW_TITLES[view as StaticViewId];
}

/** Whether a view can have a window of its own: every tab but the pinned one. */
export function canDetach(view: ViewId): boolean {
  return isClosable(view);
}

/** The dashboard is pinned: it is always the first tab and cannot be closed. */
export const PINNED_VIEW: ViewId = 'dashboard';

/** Views that show data from the active server, so they need it to be signed in. */
const SERVER_VIEWS: ReadonlySet<ViewId> = new Set(['dashboard', 'calendar', 'todo']);

/** Open tabs, in display order. The pinned view is always first. */
export const openViews = writable<ViewId[]>([PINNED_VIEW]);
export const activeView = writable<ViewId>(PINNED_VIEW);

export function isClosable(view: ViewId): boolean {
  return view !== PINNED_VIEW;
}

/** The first position a tab can be moved to: the pinned view keeps the first one. */
export function firstMovableIndex(views: readonly ViewId[]): number {
  return views[0] === PINNED_VIEW ? 1 : 0;
}

export function needsServer(view: ViewId): boolean {
  return SERVER_VIEWS.has(view);
}

/** Element ids that tie a tab to its panel. */
export const viewTabId = (view: ViewId) => `view-tab-${view}`;
export const viewPanelId = (view: ViewId) => `view-panel-${view}`;

/**
 * Decides where a view opens when it is not this window's to show, such as a view that has a
 * window of its own (see lib/windows.ts). Returns true when it took care of the view.
 */
type ViewRouter = (view: ViewId) => boolean;
let router: ViewRouter | null = null;

export function routeViews(next: ViewRouter | null) {
  router = next;
}

/** Opens a view in a new tab, or switches to its tab when it is already open. */
export function openView(view: ViewId) {
  if (router?.(view)) return;
  openViews.update(views => (views.includes(view) ? views : [...views, view]));
  activeView.set(view);
}

/**
 * Closes a tab. The pinned view stays open. When the active tab is closed, the tab that
 * takes its place becomes active, or the one before it when it was the last tab.
 */
export function closeView(view: ViewId) {
  const views = get(openViews);
  const index = views.indexOf(view);
  if (!isClosable(view) || index === -1) return;

  const remaining = views.filter(open => open !== view);
  openViews.set(remaining);
  viewLabels.update(labels => {
    if (!(view in labels)) return labels;
    const { [view]: _closed, ...others } = labels;
    return others;
  });
  if (get(activeView) === view) {
    activeView.set(remaining[index] ?? remaining[index - 1]);
  }
}

function placeAt(views: ViewId[], view: ViewId, index: number): ViewId[] {
  const at = Math.min(Math.max(index, firstMovableIndex(views)), views.length);
  return [...views.slice(0, at), view, ...views.slice(at)];
}

/** Moves an open tab to `index` in the tab order. The pinned view stays first. */
export function moveView(view: ViewId, index: number) {
  if (!isClosable(view)) return;
  openViews.update(views =>
    views.includes(view) ? placeAt(views.filter(open => open !== view), view, index) : views
  );
}

/** Shows a view in a tab at `index`, or after the last tab, and switches to it. */
export function insertView(view: ViewId, index?: number) {
  openViews.update(views => {
    const others = views.filter(open => open !== view);
    return placeAt(others, view, index ?? others.length);
  });
  activeView.set(view);
}

/** Back to the pinned view alone, as on a fresh start. */
export function resetViews() {
  openViews.set([PINNED_VIEW]);
  activeView.set(PINNED_VIEW);
}

/** Opens a task of a server in a tab, or switches to its tab when it is open. */
export function openTask(serverId: string, taskId: number) {
  openView(taskView(serverId, taskId));
}

/** Opens a log entry of a server in a tab, or switches to its tab when it is open. */
export function openLogEntry(serverId: string, entryId: number) {
  openView(logView(serverId, entryId));
}

/** Closes the task and log entry tabs of a server, which is gone. */
export function closeViewsOfServer(serverId: string) {
  for (const view of get(openViews)) {
    if (parseDetailView(view)?.serverId === serverId) closeView(view);
  }
}
