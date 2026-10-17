import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  openViews,
  activeView,
  openView,
  closeView,
  resetViews,
  isClosable,
  isViewId,
  needsServer,
  moveView,
  insertView,
  routeViews,
  firstMovableIndex,
  canDetach,
  closeViewsOfServer,
  isDetailView,
  logView,
  openLogEntry,
  openTask,
  parseDetailView,
  setViewLabel,
  taskView,
  viewLabels,
  viewTitle,
} from '../views';

describe('view tabs', () => {
  beforeEach(() => {
    resetViews();
    routeViews(null);
  });

  it('starts with only the pinned dashboard open and active', () => {
    expect(get(openViews)).toEqual(['dashboard']);
    expect(get(activeView)).toBe('dashboard');
  });

  it('opens a view in a new tab after the existing ones and activates it', () => {
    openView('calendar');
    openView('todo');

    expect(get(openViews)).toEqual(['dashboard', 'calendar', 'todo']);
    expect(get(activeView)).toBe('todo');
  });

  it('switches to an already open view instead of opening it twice', () => {
    openView('calendar');
    openView('todo');

    openView('calendar');

    expect(get(openViews)).toEqual(['dashboard', 'calendar', 'todo']);
    expect(get(activeView)).toBe('calendar');
  });

  it('never closes the pinned dashboard', () => {
    openView('calendar');
    activeView.set('dashboard');

    closeView('dashboard');

    expect(get(openViews)).toEqual(['dashboard', 'calendar']);
    expect(get(activeView)).toBe('dashboard');
    expect(isClosable('dashboard')).toBe(false);
    expect(isClosable('calendar')).toBe(true);
  });

  it('activates the tab that takes the place of the closed active tab', () => {
    openView('calendar');
    openView('todo');
    activeView.set('calendar');

    closeView('calendar');

    expect(get(openViews)).toEqual(['dashboard', 'todo']);
    expect(get(activeView)).toBe('todo');
  });

  it('activates the previous tab when the last tab was active', () => {
    openView('calendar');
    openView('todo');

    closeView('todo');

    expect(get(activeView)).toBe('calendar');
  });

  it('keeps the active tab when another tab is closed', () => {
    openView('calendar');
    openView('todo');

    closeView('calendar');

    expect(get(openViews)).toEqual(['dashboard', 'todo']);
    expect(get(activeView)).toBe('todo');
  });

  it('ignores closing a view that is not open', () => {
    closeView('settings');

    expect(get(openViews)).toEqual(['dashboard']);
    expect(get(activeView)).toBe('dashboard');
  });

  it('knows which views show server data', () => {
    expect(needsServer('dashboard')).toBe(true);
    expect(needsServer('calendar')).toBe(true);
    expect(needsServer('todo')).toBe(true);
    expect(needsServer('settings')).toBe(false);
    expect(needsServer('about')).toBe(false);
  });

  it('moves a tab to a new position', () => {
    openView('calendar');
    openView('todo');
    openView('settings');

    moveView('settings', 1);
    expect(get(openViews)).toEqual(['dashboard', 'settings', 'calendar', 'todo']);

    moveView('calendar', 3);
    expect(get(openViews)).toEqual(['dashboard', 'settings', 'todo', 'calendar']);
    expect(get(activeView)).toBe('settings');
  });

  it('keeps the pinned dashboard first when tabs move', () => {
    openView('calendar');
    openView('todo');

    moveView('todo', 0);
    expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar']);

    moveView('dashboard', 2);
    expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar']);
    expect(firstMovableIndex(get(openViews))).toBe(1);
  });

  it('ignores moving a view that is not open', () => {
    openView('calendar');

    moveView('todo', 1);

    expect(get(openViews)).toEqual(['dashboard', 'calendar']);
  });

  it('inserts a view at a position, or at the end, and switches to it', () => {
    openView('calendar');
    activeView.set('dashboard');

    insertView('todo', 1);
    expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar']);
    expect(get(activeView)).toBe('todo');

    insertView('settings');
    expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar', 'settings']);

    insertView('about', 0);
    expect(get(openViews)).toEqual(['dashboard', 'about', 'todo', 'calendar', 'settings']);
  });

  it('lets a router open views elsewhere', () => {
    const routed: string[] = [];
    routeViews(view => {
      routed.push(view);
      return view === 'calendar';
    });

    openView('calendar');
    openView('todo');

    expect(routed).toEqual(['calendar', 'todo']);
    expect(get(openViews)).toEqual(['dashboard', 'todo']);
  });
});

describe('detail views', () => {
  beforeEach(() => {
    routeViews(null);
    resetViews();
    viewLabels.set({});
  });

  it('are named by what they show, the server and the number', () => {
    expect(taskView('server-1', 42)).toBe('task:server-1:42');
    expect(logView('server-1', 7)).toBe('log:server-1:7');
    expect(parseDetailView('task:0b1c-2d:42')).toEqual({ kind: 'task', serverId: '0b1c-2d', id: 42 });
    expect(parseDetailView('log:server_1:7')).toEqual({ kind: 'log', serverId: 'server_1', id: 7 });
  });

  it.each(['task', 'task:', 'task:s:', 'task:s:0', 'task:s:-1', 'task:s:1.5', 'task:s:abc', 'task::5', 'task:a b:5', 'task:s:5:6', 'issue:s:5', 'dashboard', '', 'task:s:1234567890123456'])(
    'are not made of %j',
    (view) => {
      expect(parseDetailView(view)).toBeNull();
      expect(isDetailView(view)).toBe(false);
    }
  );

  it('have a title from the id alone until the view has loaded, then the one it chose', () => {
    expect(viewTitle(taskView('s', 42))).toBe('Task #42');
    expect(viewTitle(logView('s', 7))).toBe('Log #7');

    setViewLabel(taskView('s', 42), '#42 Fix the login');

    expect(viewTitle(taskView('s', 42))).toBe('#42 Fix the login');
    expect(viewTitle('calendar')).toBe('Calendar');
  });

  it('open in a tab, once, and switch to the tab when they are open already', () => {
    openTask('s', 42);
    openLogEntry('s', 7);
    openTask('s', 42);

    expect(get(openViews)).toEqual(['dashboard', 'task:s:42', 'log:s:7']);
    expect(get(activeView)).toBe('task:s:42');
  });

  it('are closable, movable and detachable like the other tabs', () => {
    expect(isClosable(taskView('s', 1))).toBe(true);
    expect(canDetach(taskView('s', 1))).toBe(true);
    expect(canDetach(logView('s', 1))).toBe(true);
    expect(canDetach('calendar')).toBe(true);
    expect(canDetach('dashboard')).toBe(false);
  });

  it('are recognised as view ids that arrive from another window, and nothing else is', () => {
    expect(isViewId(taskView('s', 1))).toBe(true);
    expect(isViewId('calendar')).toBe(true);
    expect(isViewId('constructor')).toBe(false);
    expect(isViewId('task:s')).toBe(false);
  });

  it('forget their title when they are closed', () => {
    openTask('s', 42);
    setViewLabel(taskView('s', 42), '#42 Fix the login');

    closeView(taskView('s', 42));

    expect(get(viewLabels)).toEqual({});
  });

  it('close with their server, and only theirs', () => {
    openTask('s1', 42);
    openLogEntry('s1', 7);
    openTask('s2', 42);
    openView('calendar');

    closeViewsOfServer('s1');

    expect(get(openViews)).toEqual(['dashboard', 'task:s2:42', 'calendar']);
  });
});
