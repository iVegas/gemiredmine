import { writable, get } from 'svelte/store';

/** Views the app shows in tabs. */
export type ViewId = 'dashboard' | 'calendar' | 'todo' | 'settings' | 'about';

export const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  todo: 'To-do',
  settings: 'Settings',
  about: 'About',
};

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
