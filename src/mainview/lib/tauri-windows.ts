import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, cursorPosition, getCurrentWindow, type Window } from '@tauri-apps/api/window';
import type { AppWindow, ViewWindowsHost } from '../../bun/windows/view-windows';
import type { WindowMessages, WindowRequestHandlers } from '../../shared/window-contract';
import { viewWindowHash, type Point, type Rect } from '../../shared/windows';
import { MESSAGE_NAMES, MAIN_LABEL, sendMessage, viewLabel } from './window-transport';

// The window layer's platform: ViewWindows, which follows a dragged view window and puts it back into a tab,
// runs in the main window's webview, and this host gives it Tauri windows to work with.
//
// ViewWindows reads the pointer and the windows' frames synchronously, and Tauri only answers asynchronously.
// So the host keeps the latest answers, and refreshes them before the moments that need them: when a view is
// detached, when the tab strip is reported, and on every step of a drag.
//
// All coordinates the host hands out are CSS pixels, like the webview's own: Tauri reports physical pixels, and
// they are divided by the main window's scale factor.

/** The part of a Tauri window the host uses. The real one is a `Window`; tests bring a fake. */
export interface NativeWindow {
  readonly label: string;
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  isMinimized(): Promise<boolean>;
  scaleFactor(): Promise<number>;
  unminimize(): Promise<void>;
  setFocus(): Promise<void>;
  close(): Promise<void>;
  /** The new outer position, in physical pixels. */
  onMoved(listener: (position: { x: number; y: number }) => void): Promise<() => void>;
  /** The window is gone, however it was closed. */
  onDestroyed(listener: () => void): Promise<() => void>;
  /** Resolves when the window exists, and fails when it could not be created. */
  created(): Promise<void>;
}

export interface WindowSystem {
  /** The window this code runs in. */
  current(): NativeWindow;
  /** Opens a window showing `url`, at `frame` in CSS pixels. */
  create(label: string, options: { url: string; title: string; frame: Rect }): NativeWindow;
  /** The pointer's position on screen, in physical pixels. */
  cursor(): Promise<{ x: number; y: number }>;
  primaryButtonDown(): Promise<boolean>;
  /** The usable area of every display, in physical pixels. */
  workAreas(): Promise<{ x: number; y: number; width: number; height: number }[]>;
}

function nativeWindow(window: Window | WebviewWindow): NativeWindow {
  return {
    label: window.label,
    outerPosition: async () => {
      const { x, y } = await window.outerPosition();
      return { x, y };
    },
    outerSize: async () => {
      const { width, height } = await window.outerSize();
      return { width, height };
    },
    isMinimized: () => window.isMinimized(),
    scaleFactor: () => window.scaleFactor(),
    unminimize: () => window.unminimize(),
    setFocus: () => window.setFocus(),
    close: () => window.close(),
    onMoved: (listener) => window.onMoved(({ payload }) => listener({ x: payload.x, y: payload.y })),
    onDestroyed: (listener) => window.once('tauri://destroyed', () => listener()),
    created: () =>
      new Promise<void>((resolve, reject) => {
        void window.once('tauri://created', () => resolve());
        void window.once('tauri://error', ({ payload }) => reject(new Error(String(payload))));
      }),
  };
}

export const tauriWindowSystem: WindowSystem = {
  current: () => nativeWindow(getCurrentWindow()),

  create(label, { url, title, frame }) {
    // Created from this window's JavaScript, which needs the create-webview-window permission (main capability).
    const window = new WebviewWindow(label, {
      url,
      title,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      focus: true,
    });
    return nativeWindow(window);
  },

  async cursor() {
    const { x, y } = await cursorPosition();
    return { x, y };
  },

  primaryButtonDown: () => invoke<boolean>('primary_button_down'),

  async workAreas() {
    const monitors = await availableMonitors();
    return monitors.map(({ workArea }) => ({
      x: workArea.position.x,
      y: workArea.position.y,
      width: workArea.size.width,
      height: workArea.size.height,
    }));
  },
};

/** What a window's messages look like to the window layer: one function for each message. */
type Listeners = { [K in keyof WindowMessages]: (payload: WindowMessages[K]) => void };

class TauriAppWindow implements AppWindow {
  frame: Rect;
  minimized = false;
  private readonly closeListeners: (() => void | Promise<void>)[] = [];
  readonly send: Listeners;

  constructor(
    readonly id: number,
    readonly native: NativeWindow,
    frame: Rect,
    private readonly host: TauriHost
  ) {
    this.frame = frame;
    this.send = Object.fromEntries(
      (Object.keys(MESSAGE_NAMES) as (keyof WindowMessages)[]).map((name) => [
        name,
        (payload: unknown) => {
          // A window that is gone cannot hear this; its own closing is reported separately.
          void sendMessage(native.label, name, payload).catch(() => {});
        },
      ])
    ) as Listeners;
  }

  getFrame(): Rect {
    return this.frame;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  activate(): void {
    void (async () => {
      if (await this.native.isMinimized()) await this.native.unminimize();
      await this.native.setFocus();
    })().catch(() => {});
  }

  close(): void {
    void this.native.close().catch(() => {});
  }

  onMove(listener: () => void): void {
    void this.native.onMoved((position) => {
      this.frame = { ...this.frame, x: position.x / this.host.scale, y: position.y / this.host.scale };
      listener();
    });
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  /** Runs what is waiting for this window to close. Returns when all of it has finished. */
  async closing(): Promise<void> {
    await Promise.all(this.closeListeners.map((listener) => listener()));
  }

  async refreshFrame(): Promise<void> {
    const scale = this.host.scale;
    const [position, size, minimized] = await Promise.all([
      this.native.outerPosition(),
      this.native.outerSize(),
      this.native.isMinimized(),
    ]);
    this.frame = { x: position.x / scale, y: position.y / scale, width: size.width / scale, height: size.height / scale };
    this.minimized = minimized;
  }
}

/** The ViewWindowsHost on Tauri windows. */
export class TauriHost implements ViewWindowsHost {
  scale = 1;
  private cursorPoint: Point | null = null;
  private pressed = false;
  private workAreaList: Rect[] = [];
  private nextId = 1;
  private readonly windows = new Map<string, TauriAppWindow>();
  private readonly handlers = new Map<string, WindowRequestHandlers>();
  private latestCreation: Promise<void> | null = null;

  constructor(private readonly system: WindowSystem = tauriWindowSystem) {}

  /** The requests of the window with this label, which answer for that window only. */
  requestsOf(label: string): WindowRequestHandlers | undefined {
    return this.handlers.get(label);
  }

  openWindow({ title, view, frame, requests }: Parameters<ViewWindowsHost['openWindow']>[0]): AppWindow {
    const label = view === null ? MAIN_LABEL : viewLabel(view);
    const handlers = this.guard(requests);
    this.handlers.set(label, handlers);
    return view === null ? this.adoptMain(frame) : this.createViewWindow(label, view, title, frame);
  }

  /** The main window exists already, from the Tauri configuration. Its frame is the one the system reports. */
  private adoptMain(frame: Rect): AppWindow {
    const native = this.system.current();
    const main = new TauriAppWindow(this.nextId++, native, frame, this);
    this.windows.set(native.label, main);
    // Closing the main window ends the app, and the view windows with it: the shell sees to that (src-tauri/src/lib.rs).
    // A close listener here would hold the window open until it, too, had permission to destroy it.
    void native.onMoved((position) => {
      main.frame = { ...main.frame, x: position.x / this.scale, y: position.y / this.scale };
    });
    return main;
  }

  private createViewWindow(label: string, view: string, title: string, frame: Rect): AppWindow {
    const native = this.system.create(label, { url: `index.html${viewWindowHash(view)}`, title, frame });
    const window = new TauriAppWindow(this.nextId++, native, frame, this);
    this.windows.set(label, window);
    const forget = () => {
      this.windows.delete(label);
      this.handlers.delete(label);
    };
    void native.onDestroyed(() => {
      forget();
      void window.closing();
    });
    // A window that could not be created counts as closed at once, so its view does not vanish silently.
    this.latestCreation = native.created().catch((error: unknown) => {
      forget();
      void window.closing();
      throw error;
    });
    this.latestCreation.catch(() => {});
    return window;
  }

  /**
   * The window requests, made to wait for fresh answers where they read them, and for the new window where
   * one is made. ViewWindows itself stays synchronous.
   */
  private guard(requests: WindowRequestHandlers): WindowRequestHandlers {
    return {
      ...requests,
      detachView: async (params) => {
        await this.refreshAll();
        this.latestCreation = null;
        const result = await requests.detachView(params);
        await this.latestCreation;
        return result;
      },
      reportTabStrip: async (layout) => {
        await this.refreshAll();
        return requests.reportTabStrip(layout);
      },
    };
  }

  cursor(): Point {
    if (this.cursorPoint) return this.cursorPoint;
    // The pointer cannot be read (a Wayland session): the middle of the main window is a place to put windows.
    const main = this.windows.get(MAIN_LABEL)?.frame;
    return main ? { x: main.x + main.width / 2, y: main.y + main.height / 2 } : { x: 0, y: 0 };
  }

  primaryButtonDown(): boolean {
    return this.pressed;
  }

  workAreaAt(point: Point): Rect | undefined {
    return this.workAreaList.find(
      (area) => point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height
    );
  }

  /** Reads the pointer and the button. */
  async refreshPointer(): Promise<void> {
    const [cursor, pressed] = await Promise.all([
      this.system.cursor().catch(() => null),
      this.system.primaryButtonDown().catch(() => false),
    ]);
    if (cursor) this.cursorPoint = { x: cursor.x / this.scale, y: cursor.y / this.scale };
    this.pressed = pressed;
  }

  /** Reads everything: the scale, the displays, every window's frame and the pointer. */
  async refreshAll(): Promise<void> {
    const [scale, areas] = await Promise.all([
      this.system.current().scaleFactor().catch(() => 1),
      this.system.workAreas().catch(() => []),
    ]);
    this.scale = scale > 0 ? scale : 1;
    this.workAreaList = areas.map((area) => ({
      x: area.x / this.scale,
      y: area.y / this.scale,
      width: area.width / this.scale,
      height: area.height / this.scale,
    }));
    await Promise.all([this.refreshPointer(), ...[...this.windows.values()].map((window) => window.refreshFrame().catch(() => {}))]);
  }

  repeat(ms: number, task: () => void): () => void {
    let stopped = false;
    let running = false;
    // A step waits for fresh pointer answers, and a slow answer makes the next step wait instead of piling up.
    const step = async (everything: boolean) => {
      if (stopped || running) return;
      running = true;
      try {
        await (everything ? this.refreshAll() : this.refreshPointer());
      } finally {
        running = false;
      }
      if (!stopped) task();
    };
    void step(true);
    const timer = setInterval(() => void step(false), ms);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}
