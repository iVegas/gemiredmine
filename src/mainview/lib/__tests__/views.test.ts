import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  openViews,
  activeView,
  openView,
  closeView,
  resetViews,
  isClosable,
  needsServer,
  moveView,
  insertView,
  routeViews,
  firstMovableIndex,
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
