import type {
  SessionSnapshot,
  TabStripLayout,
  WindowMessages,
  WindowRequestHandlers,
} from '../../shared/window-contract';
import type { ViewId } from '../../mainview/lib/views';
import { containsPoint, dropGap, type Point, type Rect } from '../../shared/windows';

/** How often the pointer is checked while a view window is being dragged. */
export const DRAG_POLL_MS = 40;
/** Slack around the main window's tab strip, so that it is easy to drop a window on. */
export const DROP_MARGIN = 8;
/** Where the pointer sits on a new view window: over its title bar, near the left. */
export const GRAB_OFFSET: Point = { x: 80, y: 16 };

/** A native window and the webview in it. */
export interface AppWindow {
  readonly id: number;
  /** The window's frame, in screen coordinates. */
  getFrame(): Rect;
  isMinimized(): boolean;
  activate(): void;
  close(): void;
  onMove(listener: () => void): void;
  onClose(listener: () => void): void;
  /** Sends messages to the window's webview. */
  readonly send: { [K in keyof WindowMessages]: (payload: WindowMessages[K]) => void };
}

/** What the window manager needs from the platform. The desktop shell provides it. */
export interface ViewWindowsHost {
  /** Opens a window. `view` is the one view it shows, or null for the main window. */
  openWindow(options: { title: string; view: ViewId | null; frame: Rect; requests: WindowRequestHandlers }): AppWindow;
  /** The pointer's position on screen. */
  cursor(): Point;
  /** Whether the primary mouse button is held down. */
  primaryButtonDown(): boolean;
  /** The usable area of the display that contains `point`. */
  workAreaAt(point: Point): Rect | undefined;
  /** Runs `task` now and then every `ms` milliseconds, until the returned function is called. */
  repeat(ms: number, task: () => void): () => void;
}

interface ViewWindow {
  view: ViewId;
  window: AppWindow;
  /** Set when the view moved back into the main window, so closing the window does not close the view. */
  attached: boolean;
}

interface WindowDrag {
  entry: ViewWindow;
  /** Whether the primary button was seen held down, which makes this a drag by the user. */
  held: boolean;
  /** Where the view would join the tabs if dropped now. */
  target: number | null;
  stop: () => void;
}

/**
 * Without a measurement from the webview, assume the window manager draws a title bar on top and
 * borders of the same width on the other sides.
 */
export function estimateContentOffset(frame: Rect, viewport: { width: number; height: number }): Point {
  const border = Math.max(0, (frame.width - viewport.width) / 2);
  return { x: border, y: Math.max(0, frame.height - viewport.height - border) };
}

/** Where a new view window goes: under the pointer, with the pointer on its title bar, kept on screen. */
export function placeViewWindow(cursor: Point, size: { width: number; height: number }, workArea?: Rect): Rect {
  let x = cursor.x - GRAB_OFFSET.x;
  let y = cursor.y - GRAB_OFFSET.y;
  let { width, height } = size;
  if (workArea) {
    width = Math.min(width, workArea.width);
    height = Math.min(height, workArea.height);
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));
  }
  return { x, y, width, height };
}

/**
 * The main window and the windows that views were dragged out into. A view window shows one
 * view; dragging it back over the main window's tab strip puts the view back in a tab.
 */
export class ViewWindows {
  private main: AppWindow | null = null;
  private readonly viewWindows = new Map<number, ViewWindow>();
  private session: SessionSnapshot | null = null;
  private layout: TabStripLayout | null = null;
  /** The main webview's top-left corner relative to its window frame, measured by the webview. */
  private contentOffset: Point | null = null;
  private drag: WindowDrag | null = null;

  constructor(
    private readonly host: ViewWindowsHost,
    private readonly appTitle: string
  ) {}

  openMain(frame: Rect): AppWindow {
    const main: AppWindow = this.host.openWindow({
      title: this.appTitle,
      view: null,
      frame,
      requests: this.requests(() => main),
    });
    this.main = main;
    main.onClose(() => {
      // View windows belong to the main window and close with it, which also ends the app.
      this.main = null;
      this.endDrag();
      for (const { window } of [...this.viewWindows.values()]) window.close();
    });
    return main;
  }

  /** Handlers for one window's requests. `self` is that window, once it exists. */
  private requests(self: () => AppWindow | null): WindowRequestHandlers {
    const fromMain = () => {
      if (!this.main || self() !== this.main) throw new Error('Only the main window can do this.');
      return this.main;
    };
    const fromViewWindow = () => {
      const entry = this.viewWindows.get(self()?.id ?? -1);
      if (!entry) throw new Error('Only a view window can do this.');
      return entry;
    };

    return {
      detachView: ({ view, title, session }) => this.detach(fromMain(), view, title, session),
      focusViewWindow: ({ view }) => {
        fromMain();
        const entry = this.windowFor(view);
        entry?.window.activate();
        return Boolean(entry);
      },
      reportTabStrip: layout => this.setLayout(fromMain(), layout),
      attachView: () => this.attach(fromViewWindow()),
      closeViewWindow: () => fromViewWindow().window.close(),
      openInMainWindow: ({ view }) => {
        fromViewWindow();
        this.main?.send.openView({ view });
        this.main?.activate();
      },
      getSession: () => this.session,
      shareSession: session => this.share(self(), session),
    };
  }

  private detach(main: AppWindow, view: ViewId, title: string, session: SessionSnapshot) {
    // The view becomes part of a URL, so only plain view ids are accepted.
    if (!/^[a-z]+$/.test(view)) throw new Error(`Unknown view: ${view}`);
    this.session = session;

    const existing = this.windowFor(view);
    if (existing) {
      existing.window.activate();
      return;
    }

    const cursor = this.host.cursor();
    const { width, height } = main.getFrame();
    let entry: ViewWindow | undefined;
    const window = this.host.openWindow({
      title: `${title} – ${this.appTitle}`,
      view,
      frame: placeViewWindow(cursor, { width, height }, this.host.workAreaAt(cursor)),
      requests: this.requests(() => entry?.window ?? null),
    });
    const created: ViewWindow = { view, window, attached: false };
    entry = created;
    this.viewWindows.set(window.id, created);
    window.onMove(() => this.moved(created));
    window.onClose(() => this.closed(created));
  }

  private windowFor(view: ViewId): ViewWindow | undefined {
    return [...this.viewWindows.values()].find(entry => entry.view === view);
  }

  private setLayout(main: AppWindow, layout: TabStripLayout) {
    this.layout = layout;
    if (layout.origin) {
      const frame = main.getFrame();
      this.contentOffset = { x: layout.origin.x - frame.x, y: layout.origin.y - frame.y };
    }
  }

  private share(from: AppWindow | null, session: SessionSnapshot) {
    // Without view windows nobody needs the servers, so the backend does not keep them.
    if (this.viewWindows.size === 0) return;
    this.session = session;
    const windows = [this.main, ...[...this.viewWindows.values()].map(entry => entry.window)];
    for (const window of windows) {
      if (window && window !== from) window.send.sessionChanged(session);
    }
  }

  /**
   * A view window started moving. The pointer is followed until the mouse button is released:
   * over the main window's tab strip the view goes back into a tab. Moves made without the mouse
   * (by the window manager, or from the keyboard) never do.
   */
  private moved(entry: ViewWindow) {
    if (this.drag?.entry === entry) return;
    this.endDrag();
    const drag: WindowDrag = { entry, held: false, target: null, stop: () => {} };
    this.drag = drag;
    drag.stop = this.host.repeat(DRAG_POLL_MS, () => this.followDrag(drag));
  }

  private followDrag(drag: WindowDrag) {
    if (this.drag !== drag) return;
    const pressed = this.host.primaryButtonDown();
    if (pressed) drag.held = true;
    const target = drag.held ? this.dropIndexAt(this.host.cursor()) : null;

    if (pressed) {
      if (target !== drag.target) {
        drag.target = target;
        this.main?.send.viewDropTarget({ target: target === null ? null : { view: drag.entry.view, index: target } });
      }
      return;
    }

    this.endDrag();
    if (target !== null) this.attach(drag.entry, target);
  }

  private endDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.stop();
    if (drag.target !== null) this.main?.send.viewDropTarget({ target: null });
  }

  /** Where in the main window's tabs a view dropped at `cursor` goes, or null when not over them. */
  private dropIndexAt(cursor: Point): number | null {
    if (!this.main || !this.layout || this.main.isMinimized()) return null;
    const frame = this.main.getFrame();
    const offset = this.contentOffset ?? estimateContentOffset(frame, this.layout.viewport);
    const point = { x: cursor.x - frame.x - offset.x, y: cursor.y - frame.y - offset.y };
    if (!containsPoint(this.layout.strip, point, DROP_MARGIN)) return null;
    return dropGap(point.x, this.layout.tabs, this.layout.firstMovable);
  }

  private attach(entry: ViewWindow, index?: number) {
    if (!this.main) return;
    entry.attached = true;
    this.main.send.viewAttached({ view: entry.view, index });
    entry.window.close();
    this.main.activate();
  }

  private closed(entry: ViewWindow) {
    this.viewWindows.delete(entry.window.id);
    if (this.drag?.entry === entry) this.endDrag();
    if (!entry.attached) this.main?.send.viewWindowClosed({ view: entry.view });
    if (this.viewWindows.size === 0) this.session = null;
  }
}
