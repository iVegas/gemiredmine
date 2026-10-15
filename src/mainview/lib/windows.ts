import { get, writable } from 'svelte/store';
import type { SessionSnapshot, TabStripLayout, ViewPlacement, WindowMessages } from '../../shared/window-contract';
import { stableJson, viewFromHash } from '../../shared/windows';
import { hasWindowLayer, onBackendMessage, windowBackend } from './bridge';
import { activeServerId, servers } from './store';
import {
  VIEW_TITLES,
  activeView,
  canDetach,
  closeView,
  insertView,
  isClosable,
  openView,
  openViews,
  routeViews,
  type ViewId,
  viewTitle,
} from './views';

// A view tab dragged out of the main window opens in a window of its own, which shows only that
// view. Dragging that window back over the main window's tab strip puts the view back in a tab.
// The Bun side (src/bun/windows) follows the window drag; this module is the webview's side.

/** Main window: views that have moved into windows of their own. */
export const detachedViews = writable<ViewId[]>([]);
/** Main window: where a view window dragged over the tab strip would join the tabs. */
export const windowDropTarget = writable<{ index: number } | null>(null);
/** View window: false until it has the servers from the main window. */
export const sessionReady = writable(true);

/** The view this window is dedicated to, from its URL, or null in the main window. */
export function viewWindowFromLocation(hash = typeof location === 'undefined' ? '' : location.hash): ViewId | null {
  const view = viewFromHash(hash);
  return view && view in VIEW_TITLES && isClosable(view as ViewId) ? (view as ViewId) : null;
}

/** Tabs open in windows of their own only where the app has a window layer. */
export function canDetachViews(): boolean {
  return hasWindowLayer();
}

// What the windows last agreed on, in a form that does not depend on the order of the keys: the events that
// carry the session between windows sort them, and a window that thought its own copy was different would send it
// back, and so on forever.
let lastShared = '';

function snapshot(): SessionSnapshot {
  return { servers: get(servers), activeServerId: get(activeServerId) };
}

function applySession(session: SessionSnapshot) {
  lastShared = stableJson(session);
  servers.set(session.servers);
  activeServerId.set(session.activeServerId);
}

/** Sends changes to the servers to the other windows, while `active` says there are any. */
function shareSessionChanges(active: () => boolean): () => void {
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    // A change can touch several stores; wait for all of them and share the result once.
    queueMicrotask(() => {
      queued = false;
      if (!active()) return;
      const session = snapshot();
      const json = stableJson(session);
      if (json === lastShared) return;
      lastShared = json;
      void windowBackend().shareSession(session);
    });
  };
  const unsubscribers = [servers.subscribe(queue), activeServerId.subscribe(queue)];
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

type MessageHandlers = { [K in keyof WindowMessages]?: (payload: WindowMessages[K]) => void };

/** Handles messages from the backend. Returns a function that stops handling them. */
function listen(handlers: MessageHandlers): () => void {
  const names = Object.keys(handlers) as (keyof WindowMessages)[];
  for (const name of names) onBackendMessage(name, handlers[name] as never);
  return () => names.forEach(name => onBackendMessage(name, undefined));
}

function forget(view: ViewId) {
  detachedViews.update(views => views.filter(detached => detached !== view));
}

/** Brings forward the window that shows a view. If that window is gone, the view opens in a tab. */
function focusViewWindow(view: ViewId) {
  void windowBackend()
    .focusViewWindow({ view })
    .then(found => {
      if (found) return;
      forget(view);
      openView(view);
    });
}

/** Sets up the main window. Returns a function that undoes it. */
export function startMainWindow(): () => void {
  if (!hasWindowLayer()) return () => {};

  const stopListening = listen({
    sessionChanged: applySession,
    viewDropTarget: ({ target }) => windowDropTarget.set(target),
    viewAttached: ({ view, index }) => {
      forget(view);
      windowDropTarget.set(null);
      insertView(view, index);
    },
    viewWindowClosed: ({ view }) => forget(view),
    openView: ({ view }) => openView(view),
  });

  // A view with a window of its own is shown there, not opened a second time in a tab.
  routeViews(view => {
    if (!get(detachedViews).includes(view)) return false;
    focusViewWindow(view);
    return true;
  });
  const stopSharing = shareSessionChanges(() => get(detachedViews).length > 0);

  return () => {
    stopListening();
    stopSharing();
    routeViews(null);
  };
}

/** Sets up a window that shows only `view`. Returns a function that undoes it. */
export function startViewWindow(view: ViewId): () => void {
  openViews.set([view]);
  activeView.set(view);
  if (!hasWindowLayer()) return () => {};

  // Other views open in the main window.
  routeViews(other => {
    if (other !== view) void windowBackend().openInMainWindow({ view: other });
    return true;
  });
  // The window closes with its view.
  const stopClosing = openViews.subscribe(views => {
    if (views.length === 0) void windowBackend().closeViewWindow();
  });

  sessionReady.set(false);
  const stopListening = listen({ sessionChanged: applySession });
  let stopSharing = () => {};
  let stopped = false;
  void windowBackend()
    .getSession()
    .then(session => {
      if (stopped) return;
      if (session) applySession(session);
      sessionReady.set(true);
      stopSharing = shareSessionChanges(() => true);
    });

  return () => {
    stopped = true;
    stopListening();
    stopSharing();
    stopClosing();
    routeViews(null);
    sessionReady.set(true);
  };
}

/** Main window: moves a tab's view into a window of its own. Returns false when it cannot. */
export async function detachView(view: ViewId): Promise<boolean> {
  if (!canDetachViews() || !canDetach(view) || !get(openViews).includes(view)) return false;
  const session = snapshot();
  await windowBackend().detachView({ view, title: viewTitle(view), session });
  lastShared = stableJson(session);
  detachedViews.update(views => [...views, view]);
  closeView(view);
  return true;
}

/** Main window: a view's tab was dropped on the tab strip, so its window closes and the view takes the tab's place. */
export function attachViewWindowAt(view: ViewId, index: number): Promise<void> {
  return windowBackend().attachViewWindow({ view, index });
}

/** View window: puts the view back in the main window's tabs. */
export function attachToMainWindow() {
  void windowBackend().attachView();
}

let lastLayout = '';

/** Main window: tells the backend where the tab strip is, while views have windows of their own. */
export function reportTabStrip(layout: TabStripLayout) {
  if (!hasWindowLayer() || get(detachedViews).length === 0) return;
  const json = JSON.stringify(layout);
  if (json === lastLayout) return;
  lastLayout = json;
  void windowBackend().reportTabStrip(layout);
}
