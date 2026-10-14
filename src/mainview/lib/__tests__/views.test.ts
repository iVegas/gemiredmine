import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { openViews, activeView, openView, closeView, resetViews, isClosable, needsServer } from '../views';

describe('view tabs', () => {
  beforeEach(() => {
    resetViews();
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
});
