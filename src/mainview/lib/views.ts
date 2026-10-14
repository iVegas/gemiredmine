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

export function needsServer(view: ViewId): boolean {
  return SERVER_VIEWS.has(view);
}

/** Element ids that tie a tab to its panel. */
export const viewTabId = (view: ViewId) => `view-tab-${view}`;
export const viewPanelId = (view: ViewId) => `view-panel-${view}`;

/** Opens a view in a new tab, or switches to its tab when it is already open. */
export function openView(view: ViewId) {
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

/** Back to the pinned view alone, as on a fresh start. */
export function resetViews() {
  openViews.set([PINNED_VIEW]);
  activeView.set(PINNED_VIEW);
}
