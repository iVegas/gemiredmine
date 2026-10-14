import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ViewWindows,
  DRAG_POLL_MS,
  estimateContentOffset,
  placeViewWindow,
  type AppWindow,
  type ViewWindowsHost,
} from '../view-windows';
import type { SessionSnapshot, TabStripLayout, WindowRequestHandlers } from '../../../shared/window-contract';
import type { Point, Rect } from '../../../shared/windows';
import type { ViewId } from '../../../mainview/lib/views';

class FakeWindow implements AppWindow {
  closed = false;
  activations = 0;
  minimized = false;
  private readonly moveListeners: (() => void)[] = [];
  private readonly closeListeners: (() => void)[] = [];
  readonly send = {
    sessionChanged: vi.fn(),
    viewDropTarget: vi.fn(),
    viewAttached: vi.fn(),
    viewWindowClosed: vi.fn(),
    openView: vi.fn(),
  };

  constructor(
    readonly id: number,
    readonly title: string,
    readonly view: ViewId | null,
    public frame: Rect,
    readonly requests: WindowRequestHandlers
  ) {}

  getFrame() {
    return this.frame;
  }
  isMinimized() {
    return this.minimized;
  }
  activate() {
    this.activations += 1;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.closeListeners.forEach(listener => listener());
  }
  onMove(listener: () => void) {
    this.moveListeners.push(listener);
  }
  onClose(listener: () => void) {
    this.closeListeners.push(listener);
  }
  /** The user moves the window. */
  moveTo(x: number, y: number) {
    this.frame = { ...this.frame, x, y };
    this.moveListeners.forEach(listener => listener());
  }
}

class FakeHost implements ViewWindowsHost {
  readonly windows: FakeWindow[] = [];
  pointer: Point = { x: 0, y: 0 };
  buttonDown = false;
  workArea: Rect | undefined = { x: 0, y: 0, width: 1920, height: 1080 };
  task: (() => void) | null = null;
  interval = 0;

  openWindow({ title, view, frame, requests }: Parameters<ViewWindowsHost['openWindow']>[0]) {
    const window = new FakeWindow(this.windows.length + 1, title, view, frame, requests);
    this.windows.push(window);
    return window;
  }
  cursor() {
    return this.pointer;
  }
  primaryButtonDown() {
    return this.buttonDown;
  }
  workAreaAt() {
    return this.workArea;
  }
  repeat(ms: number, task: () => void) {
    this.task = task;
    this.interval = ms;
    return () => {
      if (this.task === task) this.task = null;
    };
  }
  /** One run of the repeating task, as its timer would do. */
  poll() {
    this.task?.();
  }
}

// The main window's frame, and a webview under a 37-pixel title bar, as measured from a pointer event.
const MAIN_FRAME: Rect = { x: 100, y: 50, width: 1000, height: 700 };
const CONTENT_TOP = MAIN_FRAME.y + 37;
const LAYOUT: TabStripLayout = {
  strip: { x: 16, y: 8, width: 800, height: 38 },
  tabs: [
    { left: 16, right: 120 }, // Dashboard, pinned
    { left: 124, right: 200 }, // To-do
    { left: 204, right: 300 }, // Settings
  ],
  firstMovable: 1,
  viewport: { width: 1000, height: 663 },
  origin: { x: MAIN_FRAME.x, y: CONTENT_TOP },
};

const session: SessionSnapshot = {
  servers: [{ id: 's1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' }],
  activeServerId: 's1',
};

/** A screen point over the main window's webview. */
const overContent = (x: number, y: number): Point => ({ x: MAIN_FRAME.x + x, y: CONTENT_TOP + y });

describe('ViewWindows', () => {
  let host: FakeHost;
  let windows: ViewWindows;
  let main: FakeWindow;

  beforeEach(() => {
    host = new FakeHost();
    windows = new ViewWindows(host, 'Gemiredmine');
    main = windows.openMain(MAIN_FRAME) as FakeWindow;
  });

  async function detach(view: ViewId, pointer: Point = { x: 1300, y: 400 }) {
    host.pointer = pointer;
    await main.requests.detachView({ view, title: view === 'calendar' ? 'Calendar' : 'Settings', session });
    return host.windows[host.windows.length - 1];
  }

  it('opens the main window with the app title', () => {
    expect(main.title).toBe('Gemiredmine');
    expect(main.view).toBeNull();
    expect(main.frame).toEqual(MAIN_FRAME);
  });

  it('opens a dragged-out view in a window under the pointer, as big as the main window', async () => {
    const window = await detach('calendar', { x: 600, y: 300 });

    expect(window.view).toBe('calendar');
    expect(window.title).toBe('Calendar – Gemiredmine');
    expect(window.frame).toEqual({ x: 520, y: 284, width: 1000, height: 700 });
  });

  it('brings forward the window a view already has instead of opening another', async () => {
    const window = await detach('calendar');

    await detach('calendar');

    expect(host.windows).toHaveLength(2);
    expect(window.activations).toBe(1);
  });

  it('accepts only plain view ids', async () => {
    expect(() => main.requests.detachView({ view: 'calendar#x' as ViewId, title: 'Calendar', session })).toThrow(
      'Unknown view'
    );
    expect(host.windows).toHaveLength(1);
  });

  it('lets only the main window detach views and report its tabs', async () => {
    const window = await detach('calendar');

    expect(() => window.requests.detachView({ view: 'settings', title: 'Settings', session })).toThrow(
      'Only the main window'
    );
    expect(() => window.requests.reportTabStrip(LAYOUT)).toThrow('Only the main window');
    expect(() => window.requests.focusViewWindow({ view: 'calendar' })).toThrow('Only the main window');
    expect(() => main.requests.attachView()).toThrow('Only a view window');
    expect(() => main.requests.closeViewWindow()).toThrow('Only a view window');
    expect(() => main.requests.openInMainWindow({ view: 'todo' })).toThrow('Only a view window');
  });

  it('brings a view window forward for the main window', async () => {
    const window = await detach('calendar');

    expect(main.requests.focusViewWindow({ view: 'calendar' })).toBe(true);
    expect(window.activations).toBe(1);
    expect(main.requests.focusViewWindow({ view: 'todo' })).toBe(false);
  });

  it('gives a view window the servers and passes changes between windows', async () => {
    const calendar = await detach('calendar');
    const settings = await detach('settings');
    expect(calendar.requests.getSession()).toEqual(session);

    const changed = { ...session, activeServerId: null };
    await settings.requests.shareSession(changed);

    expect(main.send.sessionChanged).toHaveBeenCalledWith(changed);
    expect(calendar.send.sessionChanged).toHaveBeenCalledWith(changed);
    expect(settings.send.sessionChanged).not.toHaveBeenCalled();
    expect(calendar.requests.getSession()).toEqual(changed);
  });

  it('keeps the servers only while a view has a window of its own', async () => {
    const window = await detach('calendar');

    window.close();
    await main.requests.shareSession(session);

    expect(main.requests.getSession()).toBeNull();
  });

  describe('dragging a view window back', () => {
    let window: FakeWindow;

    beforeEach(async () => {
      window = await detach('calendar');
      await main.requests.reportTabStrip(LAYOUT);
    });

    it('shows where the view would go while the window is over the tabs, and puts it there on release', () => {
      host.buttonDown = true;
      host.pointer = overContent(500, 600);
      window.moveTo(600, 500);
      expect(host.interval).toBe(DRAG_POLL_MS);
      host.poll();
      expect(main.send.viewDropTarget).not.toHaveBeenCalled();

      // Between To-do and Settings.
      host.pointer = overContent(202, 20);
      host.poll();
      expect(main.send.viewDropTarget).toHaveBeenLastCalledWith({ target: { view: 'calendar', index: 2 } });

      host.buttonDown = false;
      host.poll();

      expect(main.send.viewAttached).toHaveBeenCalledWith({ view: 'calendar', index: 2 });
      expect(main.send.viewDropTarget).toHaveBeenLastCalledWith({ target: null });
      expect(window.closed).toBe(true);
      expect(main.activations).toBe(1);
      expect(main.send.viewWindowClosed).not.toHaveBeenCalled();
      expect(host.task).toBeNull();
    });

    it('never puts a view before the pinned dashboard', () => {
      host.buttonDown = true;
      host.pointer = overContent(20, 20);
      window.moveTo(0, 0);
      host.poll();
      host.buttonDown = false;
      host.poll();

      expect(main.send.viewAttached).toHaveBeenCalledWith({ view: 'calendar', index: 1 });
    });

    it('accepts a drop just outside the tab strip', () => {
      host.buttonDown = true;
      window.moveTo(0, 0);
      host.poll();
      host.pointer = overContent(400, LAYOUT.strip.y + LAYOUT.strip.height + 6);
      host.buttonDown = false;
      host.poll();

      expect(main.send.viewAttached).toHaveBeenCalledWith({ view: 'calendar', index: 3 });
    });

    it('leaves the view in its window when dropped away from the tabs', () => {
      host.buttonDown = true;
      host.pointer = overContent(202, 20);
      window.moveTo(0, 0);
      host.poll();
      host.pointer = overContent(202, 300);
      host.poll();
      expect(main.send.viewDropTarget).toHaveBeenLastCalledWith({ target: null });

      host.buttonDown = false;
      host.poll();

      expect(main.send.viewAttached).not.toHaveBeenCalled();
      expect(window.closed).toBe(false);
      expect(host.task).toBeNull();
    });

    it('ignores moves made without the mouse, even over the tabs', () => {
      host.pointer = overContent(202, 20);
      window.moveTo(0, 0);
      host.poll();

      expect(main.send.viewAttached).not.toHaveBeenCalled();
      expect(host.task).toBeNull();
    });

    it('follows the main window when it moves', () => {
      main.frame = { ...MAIN_FRAME, x: 300, y: 250 };
      host.buttonDown = true;
      host.pointer = { x: 300 + 202, y: 250 + 37 + 20 };
      window.moveTo(0, 0);
      host.poll();
      host.buttonDown = false;
      host.poll();

      expect(main.send.viewAttached).toHaveBeenCalledWith({ view: 'calendar', index: 2 });
    });

    it('ignores the tabs of a minimized main window', () => {
      main.minimized = true;
      host.buttonDown = true;
      host.pointer = overContent(202, 20);
      window.moveTo(0, 0);
      host.poll();
      host.buttonDown = false;
      host.poll();

      expect(main.send.viewAttached).not.toHaveBeenCalled();
    });

    it('stops following a window that is closed during the drag', () => {
      host.buttonDown = true;
      host.pointer = overContent(202, 20);
      window.moveTo(0, 0);
      host.poll();

      window.close();

      expect(host.task).toBeNull();
      expect(main.send.viewDropTarget).toHaveBeenLastCalledWith({ target: null });
      expect(main.send.viewWindowClosed).toHaveBeenCalledWith({ view: 'calendar' });
    });
  });

  it('estimates where the tabs are before the webview has measured it', async () => {
    const window = await detach('calendar');
    // Equal frame and viewport sizes: the frame is taken to be the content area.
    await main.requests.reportTabStrip({ ...LAYOUT, origin: null, viewport: { width: 1000, height: 700 } });

    host.buttonDown = true;
    host.pointer = { x: MAIN_FRAME.x + 202, y: MAIN_FRAME.y + 20 };
    window.moveTo(0, 0);
    host.poll();
    host.buttonDown = false;
    host.poll();

    expect(main.send.viewAttached).toHaveBeenCalledWith({ view: 'calendar', index: 2 });
  });

  it('puts the view back at the end of the tabs from its window', async () => {
    const window = await detach('calendar');

    await window.requests.attachView();

    expect(main.send.viewAttached).toHaveBeenCalledWith({ view: 'calendar', index: undefined });
    expect(window.closed).toBe(true);
    expect(main.send.viewWindowClosed).not.toHaveBeenCalled();
  });

  it('tells the main window when a view window closes with its view', async () => {
    const window = await detach('calendar');

    await window.requests.closeViewWindow();

    expect(window.closed).toBe(true);
    expect(main.send.viewWindowClosed).toHaveBeenCalledWith({ view: 'calendar' });
  });

  it('opens other views in the main window', async () => {
    const window = await detach('settings');

    await window.requests.openInMainWindow({ view: 'dashboard' });

    expect(main.send.openView).toHaveBeenCalledWith({ view: 'dashboard' });
    expect(main.activations).toBe(1);
  });

  it('closes the view windows with the main window', async () => {
    const calendar = await detach('calendar');
    const settings = await detach('settings');

    main.close();

    expect(calendar.closed).toBe(true);
    expect(settings.closed).toBe(true);
    expect(main.send.viewWindowClosed).not.toHaveBeenCalled();
  });
});

describe('placeViewWindow', () => {
  it('puts the pointer on the title bar of the new window', () => {
    expect(placeViewWindow({ x: 500, y: 300 }, { width: 800, height: 600 })).toEqual({
      x: 420,
      y: 284,
      width: 800,
      height: 600,
    });
  });

  it('keeps the window on the display', () => {
    const workArea = { x: 0, y: 32, width: 1920, height: 1048 };

    expect(placeViewWindow({ x: 1900, y: 1000 }, { width: 800, height: 600 }, workArea)).toEqual({
      x: 1120,
      y: 480,
      width: 800,
      height: 600,
    });
    expect(placeViewWindow({ x: 10, y: 10 }, { width: 2400, height: 600 }, workArea)).toEqual({
      x: 0,
      y: 32,
      width: 1920,
      height: 600,
    });
  });
});

describe('estimateContentOffset', () => {
  it('assumes a title bar on top and equal borders elsewhere', () => {
    expect(estimateContentOffset({ x: 0, y: 0, width: 1004, height: 739 }, { width: 1000, height: 700 })).toEqual({
      x: 2,
      y: 37,
    });
  });

  it('places the content at the frame when the frame is the content area', () => {
    expect(estimateContentOffset({ x: 0, y: 0, width: 1000, height: 700 }, { width: 1000, height: 700 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
