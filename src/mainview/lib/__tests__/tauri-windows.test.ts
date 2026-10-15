import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../window-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../window-transport')>()),
  sendMessage: vi.fn(async () => {}),
}));

import { DRAG_POLL_MS, ViewWindows } from '../../../bun/windows/view-windows';
import type { SessionSnapshot, TabStripLayout } from '../../../shared/window-contract';
import type { Rect } from '../../../shared/windows';
import { TauriHost, type NativeWindow, type WindowSystem } from '../tauri-windows';
import { sendMessage } from '../window-transport';

class FakeNative implements NativeWindow {
  position = { x: 0, y: 0 };
  size = { width: 1000, height: 700 };
  minimized = false;
  focused = 0;
  unminimized = 0;
  closed = false;
  createFails: Error | null = null;
  private readonly moved: ((position: { x: number; y: number }) => void)[] = [];
  private readonly destroyed: (() => void)[] = [];

  constructor(
    readonly label: string,
    private readonly system: FakeSystem
  ) {}

  async outerPosition() {
    return this.position;
  }
  async outerSize() {
    return this.size;
  }
  async isMinimized() {
    return this.minimized;
  }
  async scaleFactor() {
    return this.system.scale;
  }
  async unminimize() {
    this.unminimized += 1;
    this.minimized = false;
  }
  async setFocus() {
    this.focused += 1;
  }
  async close() {
    // Closing a window takes a moment.
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (this.closed) return;
    this.closed = true;
    this.destroyed.forEach((listener) => listener());
  }
  async onMoved(listener: (position: { x: number; y: number }) => void) {
    this.moved.push(listener);
    return () => {};
  }
  async onDestroyed(listener: () => void) {
    this.destroyed.push(listener);
    return () => {};
  }
  created() {
    return this.createFails ? Promise.reject(this.createFails) : Promise.resolve();
  }

  /** The user drags the window to a physical position. */
  userMovesTo(x: number, y: number) {
    this.position = { x, y };
    this.moved.forEach((listener) => listener({ x, y }));
  }
}

class FakeSystem implements WindowSystem {
  scale = 1;
  cursorAt: { x: number; y: number } | null = { x: 0, y: 0 };
  button = false;
  areas = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  readonly main = new FakeNative('main', this);
  readonly created: { native: FakeNative; options: { url: string; title: string; frame: Rect } }[] = [];
  nextCreateFails: Error | null = null;

  current() {
    return this.main;
  }
  create(label: string, options: { url: string; title: string; frame: Rect }) {
    const native = new FakeNative(label, this);
    native.createFails = this.nextCreateFails;
    this.nextCreateFails = null;
    this.created.push({ native, options });
    return native;
  }
  async cursor() {
    if (!this.cursorAt) throw new Error('The pointer cannot be read here.');
    return this.cursorAt;
  }
  async primaryButtonDown() {
    return this.button;
  }
  async workAreas() {
    return this.areas;
  }
}

const session: SessionSnapshot = { servers: [{ id: 's1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' }], activeServerId: 's1' };

// The main window at (100, 50) in CSS pixels, with its webview under a 37-pixel title bar.
const LAYOUT: TabStripLayout = {
  strip: { x: 16, y: 8, width: 800, height: 38 },
  tabs: [
    { left: 16, right: 120 },
    { left: 124, right: 200 },
  ],
  firstMovable: 1,
  viewport: { width: 1000, height: 663 },
  origin: { x: 100, y: 87 },
};

async function start(configure: (system: FakeSystem) => void = () => {}) {
  const system = new FakeSystem();
  system.main.position = { x: 100 * system.scale, y: 50 * system.scale };
  configure(system);
  const host = new TauriHost(system);
  const main = new ViewWindows(host, 'Gemiredmine').openMain({ x: 0, y: 0, width: 1024, height: 768 });
  await host.refreshAll();
  const requests = host.requestsOf('main')!;
  return { system, host, main, requests };
}

const sent = () => vi.mocked(sendMessage).mock.calls.map(([target, name, payload]) => ({ target, name, payload }));

describe('TauriHost with ViewWindows', () => {
  beforeEach(() => {
    vi.mocked(sendMessage).mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a view window under the pointer, in CSS pixels, with the title and address of its view', async () => {
    const { system, requests } = await start((s) => {
      s.scale = 2;
      s.main.position = { x: 200, y: 100 };
      s.main.size = { width: 2000, height: 1400 };
      s.cursorAt = { x: 1000, y: 800 }; // 500, 400 in CSS pixels
      s.areas = [{ x: 0, y: 0, width: 3840, height: 2160 }];
    });

    await requests.detachView({ view: 'calendar', title: 'Calendar', session });

    expect(system.created).toHaveLength(1);
    expect(system.created[0].native.label).toBe('view-calendar');
    expect(system.created[0].options).toEqual({
      url: 'index.html#view=calendar',
      title: 'Calendar – Gemiredmine',
      // The pointer sits 80 across and 16 down from the corner; the window is the main window's size, kept on screen.
      frame: { x: 420, y: 380, width: 1000, height: 700 },
    });
  });

  it('reads the pointer when the view is detached, not earlier', async () => {
    const { system, requests } = await start();
    system.cursorAt = { x: 900, y: 500 };

    await requests.detachView({ view: 'todo', title: 'To-do', session });

    // 900 - 80 across; down it would be 500 - 16, but the window has to fit on a 1080-pixel display.
    expect(system.created[0].options.frame).toMatchObject({ x: 820, y: 380 });
  });

  it('places the window in the middle of the main window when the pointer cannot be read', async () => {
    const { system, requests } = await start((s) => {
      s.cursorAt = null;
    });

    await requests.detachView({ view: 'todo', title: 'To-do', session });

    // The middle of the main window is (600, 400), and the window is kept on a 1080-pixel display.
    expect(system.created[0].options.frame).toMatchObject({ x: 520, y: 380 });
  });

  it('fails the detach, and reports the view window as closed, when it cannot be created', async () => {
    const { system, requests } = await start();
    system.nextCreateFails = new Error('not allowed');

    await expect(requests.detachView({ view: 'about', title: 'About', session })).rejects.toThrow('not allowed');

    expect(sent()).toContainEqual({ target: 'main', name: 'viewWindowClosed', payload: { view: 'about' } });
    expect(requests.getSession).toBeDefined();
  });

  describe('dragging a view window back', () => {
    async function detached() {
      const context = await start();
      await context.requests.reportTabStrip(LAYOUT);
      await context.requests.detachView({ view: 'todo', title: 'To-do', session });
      vi.mocked(sendMessage).mockClear();
      return { ...context, view: context.system.created[0].native };
    }

    const dragStep = () => vi.advanceTimersByTimeAsync(DRAG_POLL_MS);

    it('shows where the view would go while the window is over the tab strip, and puts it there on release', async () => {
      const { system, view } = await detached();

      view.userMovesTo(300, 120);
      system.button = true;
      system.cursorAt = { x: 250, y: 107 }; // over the strip, between the first and second tab
      await dragStep();
      await dragStep();

      expect(sent()).toContainEqual({ target: 'main', name: 'viewDropTarget', payload: { target: { view: 'todo', index: 1 } } });

      system.button = false;
      await dragStep();
      await vi.advanceTimersByTimeAsync(10);

      expect(sent()).toContainEqual({ target: 'main', name: 'viewAttached', payload: { view: 'todo', index: 1 } });
      expect(view.closed).toBe(true);
    });

    it('does nothing when the pointer lets go away from the tab strip', async () => {
      const { system, view } = await detached();

      view.userMovesTo(600, 500);
      system.button = true;
      system.cursorAt = { x: 650, y: 520 };
      await dragStep();
      await dragStep();
      system.button = false;
      await dragStep();

      expect(sent().filter((message) => message.name === 'viewAttached')).toEqual([]);
      expect(view.closed).toBe(false);
    });

    it('never attaches a window that moved without the mouse button', async () => {
      const { system, view } = await detached();

      view.userMovesTo(300, 120);
      system.cursorAt = { x: 250, y: 107 };
      await dragStep();
      await dragStep();

      expect(sent().filter((message) => message.name === 'viewAttached' || message.name === 'viewDropTarget')).toEqual([]);
    });
  });

  it('brings a view window forward, and un-minimises it first', async () => {
    const { system, requests } = await start();
    await requests.detachView({ view: 'calendar', title: 'Calendar', session });
    const view = system.created[0].native;
    view.minimized = true;

    const found = await requests.focusViewWindow({ view: 'calendar' });
    await vi.advanceTimersByTimeAsync(0);

    expect(found).toBe(true);
    expect(view.unminimized).toBe(1);
    expect(view.focused).toBe(1);
  });

  it('forgets the requests of a view window that is gone', async () => {
    const { system, host, requests } = await start();
    await requests.detachView({ view: 'calendar', title: 'Calendar', session });
    expect(host.requestsOf('view-calendar')).toBeDefined();

    const closing = system.created[0].native.close();
    await vi.advanceTimersByTimeAsync(10);
    await closing;

    expect(host.requestsOf('view-calendar')).toBeUndefined();
    expect(sent()).toContainEqual({ target: 'main', name: 'viewWindowClosed', payload: { view: 'calendar' } });
  });
});
