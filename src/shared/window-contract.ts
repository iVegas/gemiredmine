// The contract between the windows of the app: what a view window may ask of the main window, and
// what the window layer tells a window's webview. Type-only imports keep this file free of runtime code.
import type { ServerConnection } from '../mainview/lib/store';
import type { ViewId } from '../mainview/lib/views';
import type { Point, Rect, TabEdges } from './windows';

/**
 * The servers and the server in use. Every window of the app shows the same ones, so the
 * window layer passes them between windows. It keeps them in memory only, and only while a view
 * has a window of its own.
 */
export interface SessionSnapshot {
  servers: ServerConnection[];
  activeServerId: string | null;
}

/** Where the main window's tab strip is, so that a view window dragged over it can rejoin it. */
export interface TabStripLayout {
  /** The tab strip, in the webview's CSS pixels. */
  strip: Rect;
  /** Every open tab, in display order. */
  tabs: TabEdges[];
  /** Tabs before this index are pinned and keep their place. */
  firstMovable: number;
  /** The webview's size. */
  viewport: { width: number; height: number };
  /** Screen position of the webview's top-left corner, measured from the latest pointer event. */
  origin: Point | null;
}

/** Where a view joins the main window's tabs: `index` is its position, the end when omitted. */
export interface ViewPlacement {
  view: ViewId;
  index?: number;
}

/** Requests about the app's windows. Each window's webview has its own handlers for them. */
export type WindowRequests = {
  /** Main window: show a view in a new window under the pointer. */
  detachView: { params: { view: ViewId; title: string; session: SessionSnapshot }; response: void };
  /** Main window: bring forward the window showing a view. False when no window shows it. */
  focusViewWindow: { params: { view: ViewId }; response: boolean };
  /** Main window: where its tab strip is. */
  reportTabStrip: { params: TabStripLayout; response: void };
  /** View window: put the view back at the end of the main window's tabs, and close. */
  attachView: { params: void; response: void };
  /** View window: close, because its view was closed. */
  closeViewWindow: { params: void; response: void };
  /** View window: open another view, which happens in the main window. */
  openInMainWindow: { params: { view: ViewId }; response: void };
  /** View window: the servers, as the main window had them. */
  getSession: { params: void; response: SessionSnapshot | null };
  /** Any window: the servers changed here; the other windows get the change. */
  shareSession: { params: SessionSnapshot; response: void };
};

/** Handlers for the window requests, as the window layer implements them for one window. */
export type WindowRequestHandlers = {
  [K in keyof WindowRequests]: (
    params: WindowRequests[K]['params']
  ) => WindowRequests[K]['response'] | Promise<WindowRequests[K]['response']>;
};

/** Messages the window layer sends to a window's webview. */
export type WindowMessages = {
  /** Another window changed the servers. */
  sessionChanged: SessionSnapshot;
  /** Main window: a view window is dragged over the tab strip, or no longer is (null). */
  viewDropTarget: { target: Required<ViewPlacement> | null };
  /** Main window: a view window was dropped on the tab strip; show the view in a tab again. */
  viewAttached: ViewPlacement;
  /** Main window: a view window was closed, and its view with it. */
  viewWindowClosed: { view: ViewId };
  /** Main window: a view window asked to open a view. */
  openView: { view: ViewId };
};
