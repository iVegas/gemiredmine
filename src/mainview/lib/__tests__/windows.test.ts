import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import type { TabStripLayout, WindowMessages } from '../../../shared/window-contract';

const desktop = vi.hoisted(() => ({
  available: true,
  listeners: {} as Record<string, ((payload: never) => void) | undefined>,
  requests: {
    detachView: vi.fn(),
    focusViewWindow: vi.fn(),
    reportTabStrip: vi.fn(),
    attachView: vi.fn(),
    closeViewWindow: vi.fn(),
    openInMainWindow: vi.fn(),
    getSession: vi.fn(),
    shareSession: vi.fn(),
  },
}));

vi.mock('../bridge', () => ({
  hasWindowLayer: () => desktop.available,
  windowBackend: () => desktop.requests,
  onBackendMessage: (name: string, listener: ((payload: never) => void) | undefined) => {
    desktop.listeners[name] = listener;
  },
}));

import {
  attachToMainWindow,
  detachView,
  detachedViews,
  reportTabStrip,
  sessionReady,
  startMainWindow,
  startViewWindow,
  viewWindowFromLocation,
  windowDropTarget,
} from '../windows';
import { activeView, closeView, openView, openViews, resetViews } from '../views';
import { activeServerId, servers } from '../store';

/** The backend sends a message to this window. */
function receive<K extends keyof WindowMessages>(name: K, payload: WindowMessages[K]) {
  const listener = desktop.listeners[name] as ((payload: WindowMessages[K]) => void) | undefined;
  if (!listener) throw new Error(`No listener for ${name}`);
  listener(payload);
}

const settle = () => new Promise(resolve => setTimeout(resolve));

const dev = { id: 's1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' };
const prod = { id: 's2', name: 'Prod', url: 'https://prod.local' };

describe('view windows', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    desktop.available = true;
    desktop.listeners = {};
    for (const request of Object.values(desktop.requests)) request.mockResolvedValue(undefined);
    resetViews();
    servers.set([dev]);
    activeServerId.set('s1');
    detachedViews.set([]);
    windowDropTarget.set(null);
  });

  afterEach(() => {
    stop();
    stop = () => {};
  });

  describe('viewWindowFromLocation', () => {
    it('finds the view a window is for in its URL', () => {
      expect(viewWindowFromLocation('#view=calendar')).toBe('calendar');
      expect(viewWindowFromLocation('')).toBeNull();
    });

    it('ignores unknown views and the pinned dashboard', () => {
      expect(viewWindowFromLocation('#view=nothing')).toBeNull();
      expect(viewWindowFromLocation('#view=dashboard')).toBeNull();
    });

    it('finds a task or a log entry, which is what a window of its own shows after it was detached', () => {
      expect(viewWindowFromLocation('#view=task%3Asrv-1%3A42')).toBe('task:srv-1:42');
      expect(viewWindowFromLocation('#view=log%3Asrv-1%3A7')).toBe('log:srv-1:7');
      expect(viewWindowFromLocation('#view=task%3Asrv-1%3A0')).toBeNull();
    });
  });

  describe('main window', () => {
    beforeEach(() => {
      stop = startMainWindow();
      openView('calendar');
      openView('todo');
    });

    it('moves a tab into a window of its own, with the servers', async () => {
      expect(await detachView('calendar')).toBe(true);

      expect(desktop.requests.detachView).toHaveBeenCalledWith({
        view: 'calendar',
        title: 'Calendar',
        session: { servers: [dev], activeServerId: 's1' },
      });
      expect(get(openViews)).toEqual(['dashboard', 'todo']);
      expect(get(detachedViews)).toEqual(['calendar']);
    });

    it('keeps the pinned dashboard in its tab', async () => {
      expect(await detachView('dashboard')).toBe(false);
      expect(desktop.requests.detachView).not.toHaveBeenCalled();
    });

    it('keeps the tab when the backend cannot open the window', async () => {
      desktop.requests.detachView.mockRejectedValueOnce(new Error('no window'));

      await expect(detachView('calendar')).rejects.toThrow('no window');

      expect(get(openViews)).toEqual(['dashboard', 'calendar', 'todo']);
      expect(get(detachedViews)).toEqual([]);
    });

    it('shows a view window dropped on the tabs in a tab again', async () => {
      await detachView('calendar');
      receive('viewDropTarget', { target: { view: 'calendar', index: 1 } });
      expect(get(windowDropTarget)).toEqual({ view: 'calendar', index: 1 });

      receive('viewAttached', { view: 'calendar', index: 1 });

      expect(get(openViews)).toEqual(['dashboard', 'calendar', 'todo']);
      expect(get(activeView)).toBe('calendar');
      expect(get(detachedViews)).toEqual([]);
      expect(get(windowDropTarget)).toBeNull();
    });

    it('brings forward the window of a detached view instead of opening it again', async () => {
      await detachView('calendar');
      desktop.requests.focusViewWindow.mockResolvedValueOnce(true);

      openView('calendar');
      await settle();

      expect(desktop.requests.focusViewWindow).toHaveBeenCalledWith({ view: 'calendar' });
      expect(get(openViews)).toEqual(['dashboard', 'todo']);
    });

    it('opens the view in a tab when its window is gone', async () => {
      await detachView('calendar');
      desktop.requests.focusViewWindow.mockResolvedValueOnce(false);

      openView('calendar');
      await settle();

      expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar']);
      expect(get(detachedViews)).toEqual([]);
    });

    it('forgets a view whose window was closed', async () => {
      await detachView('calendar');

      receive('viewWindowClosed', { view: 'calendar' });
      openView('calendar');

      expect(get(detachedViews)).toEqual([]);
      expect(desktop.requests.focusViewWindow).not.toHaveBeenCalled();
      expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar']);
    });

    it('opens views that a view window asks for', () => {
      receive('openView', { view: 'settings' });

      expect(get(activeView)).toBe('settings');
    });

    it('shares server changes only while views have windows of their own', async () => {
      activeServerId.set(null);
      await settle();
      expect(desktop.requests.shareSession).not.toHaveBeenCalled();

      await detachView('calendar');
      servers.set([dev, prod]);
      activeServerId.set('s2');
      await settle();

      expect(desktop.requests.shareSession).toHaveBeenCalledTimes(1);
      expect(desktop.requests.shareSession).toHaveBeenCalledWith({ servers: [dev, prod], activeServerId: 's2' });
    });

    it('takes server changes from other windows without sending them back', async () => {
      await detachView('calendar');

      receive('sessionChanged', { servers: [prod], activeServerId: 's2' });
      await settle();

      expect(get(servers)).toEqual([prod]);
      expect(get(activeServerId)).toBe('s2');
      expect(desktop.requests.shareSession).not.toHaveBeenCalled();
    });

    it('does not send a session back because its keys arrive in another order', async () => {
      await detachView('calendar');

      // Tauri's events carry objects with their keys sorted, so the session comes back from another window looking
      // different as text, though it is the same. Sending it back would start an endless exchange between the windows.
      receive('sessionChanged', {
        activeServerId: 's2',
        servers: [{ url: prod.url, name: prod.name, id: prod.id }],
      });
      await settle();

      expect(get(servers)).toEqual([prod]);
      expect(desktop.requests.shareSession).not.toHaveBeenCalled();
    });

    it('reports where the tabs are only while views have windows of their own', async () => {
      const layout: TabStripLayout = {
        strip: { x: 0, y: 8, width: 600, height: 38 },
        tabs: [{ left: 0, right: 100 }],
        firstMovable: 1,
        viewport: { width: 1024, height: 768 },
        origin: { x: 10, y: 40 },
      };
      reportTabStrip(layout);
      expect(desktop.requests.reportTabStrip).not.toHaveBeenCalled();

      await detachView('calendar');
      reportTabStrip(layout);
      reportTabStrip({ ...layout });
      expect(desktop.requests.reportTabStrip).toHaveBeenCalledTimes(1);

      reportTabStrip({ ...layout, origin: { x: 20, y: 40 } });
      expect(desktop.requests.reportTabStrip).toHaveBeenCalledTimes(2);
    });

    it('stops handling messages and routing views when stopped', async () => {
      await detachView('calendar');

      stop();

      expect(desktop.listeners.viewAttached).toBeUndefined();
      openView('calendar');
      expect(desktop.requests.focusViewWindow).not.toHaveBeenCalled();
    });
  });

  it('does not detach views outside the desktop app', async () => {
    desktop.available = false;
    stop = startMainWindow();
    openView('calendar');

    expect(await detachView('calendar')).toBe(false);
    expect(get(openViews)).toEqual(['dashboard', 'calendar']);
    expect(desktop.listeners).toEqual({});
  });

  describe('view window', () => {
    it('shows only its view, with the servers from the main window', async () => {
      servers.set([]);
      activeServerId.set(null);
      desktop.requests.getSession.mockResolvedValueOnce({ servers: [dev], activeServerId: 's1' });

      stop = startViewWindow('calendar');

      expect(get(openViews)).toEqual(['calendar']);
      expect(get(activeView)).toBe('calendar');
      expect(get(sessionReady)).toBe(false);
      await settle();
      expect(get(sessionReady)).toBe(true);
      expect(get(servers)).toEqual([dev]);
      expect(get(activeServerId)).toBe('s1');
      expect(desktop.requests.shareSession).not.toHaveBeenCalled();
    });

    it('shares its server changes with the other windows', async () => {
      desktop.requests.getSession.mockResolvedValueOnce({ servers: [dev], activeServerId: 's1' });
      stop = startViewWindow('settings');
      await settle();

      servers.set([dev, prod]);
      await settle();

      expect(desktop.requests.shareSession).toHaveBeenCalledWith({ servers: [dev, prod], activeServerId: 's1' });
    });

    it('opens other views in the main window', () => {
      stop = startViewWindow('settings');

      openView('dashboard');

      expect(desktop.requests.openInMainWindow).toHaveBeenCalledWith({ view: 'dashboard' });
      expect(get(openViews)).toEqual(['settings']);
    });

    it('opens a task or a log entry in this window, where it was asked for', () => {
      stop = startViewWindow('calendar');

      openView('task:srv:42');

      expect(desktop.requests.openInMainWindow).not.toHaveBeenCalled();
      expect(get(openViews)).toEqual(['calendar', 'task:srv:42']);
      expect(get(activeView)).toBe('task:srv:42');
    });

    it('closes when its view is closed', () => {
      stop = startViewWindow('about');

      closeView('about');

      expect(desktop.requests.closeViewWindow).toHaveBeenCalledTimes(1);
    });

    it('asks to go back into the main window', () => {
      stop = startViewWindow('calendar');

      attachToMainWindow();

      expect(desktop.requests.attachView).toHaveBeenCalledTimes(1);
    });
  });
});
