import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ViewTabs from '../ViewTabs.svelte';
import { openViews, activeView, openView, resetViews } from '../lib/views';
import { detachedViews, windowDropTarget } from '../lib/windows';

const desktop = vi.hoisted(() => ({
  available: false,
  requests: {
    detachView: vi.fn(),
    reportTabStrip: vi.fn(),
  },
}));

vi.mock('../lib/bridge', () => ({
  hasWindowLayer: () => desktop.available,
  windowBackend: () => desktop.requests,
  onBackendMessage: () => {},
}));

/** Lays the tabs out side by side, 100 pixels wide with 4 pixels between them. */
function layOutTabs(tabs: HTMLElement[]) {
  tabs.forEach((tab, index) => {
    const left = index * 104;
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: left, y: 8, width: 100, height: 38 }));
  });
}

/** Drags a tab with the mouse, from its middle to `toX`. */
async function dragTab(tab: HTMLElement, toX: number, toY = 20) {
  const fromX = tab.getBoundingClientRect().left + 50;
  await fireEvent.pointerDown(tab, { pointerId: 1, button: 0, clientX: fromX, clientY: 20 });
  await fireEvent.pointerMove(tab, { pointerId: 1, clientX: (fromX + toX) / 2, clientY: toY });
  await fireEvent.pointerMove(tab, { pointerId: 1, clientX: toX, clientY: toY });
}

const tabNames = (tabs: HTMLElement[]) => tabs.map(tab => tab.textContent?.replace('✕', '').trim());

describe('ViewTabs Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktop.available = false;
    desktop.requests.detachView.mockResolvedValue(undefined);
    resetViews();
    detachedViews.set([]);
    windowDropTarget.set(null);
  });

  it('shows the dashboard as a pinned first tab without a close control', () => {
    openView('calendar');
    const view = render(ViewTabs);

    const tabs = view.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent?.replace('✕', '').trim())).toEqual(['Dashboard', 'Calendar']);
    expect(tabs[0]).toHaveAttribute('title', 'Pinned tab');
    expect(view.getByTestId('pinned-icon')).toBeInTheDocument();
    expect(view.queryByTestId('close-dashboard')).not.toBeInTheDocument();
    expect(view.getByTestId('close-calendar')).toBeInTheDocument();
  });

  it('marks the active tab as selected and links each tab to its panel', () => {
    openView('calendar');
    const view = render(ViewTabs);

    const calendar = view.getByRole('tab', { name: 'Calendar' });
    expect(calendar).toHaveAttribute('aria-selected', 'true');
    expect(calendar).toHaveAttribute('tabindex', '0');
    expect(calendar).toHaveAttribute('aria-controls', 'view-panel-calendar');
    expect(view.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('tabindex', '-1');
  });

  it('switches views when a tab is clicked', async () => {
    openView('calendar');
    const view = render(ViewTabs);

    await fireEvent.click(view.getByRole('tab', { name: 'Dashboard' }));

    expect(get(activeView)).toBe('dashboard');
  });

  it('closes a tab with its close control without selecting it first', async () => {
    openView('calendar');
    openView('todo');
    const view = render(ViewTabs);

    await fireEvent.click(view.getByTestId('close-calendar'));

    expect(get(openViews)).toEqual(['dashboard', 'todo']);
    expect(get(activeView)).toBe('todo');
    expect(view.queryByRole('tab', { name: 'Calendar' })).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow, Home and End keys', async () => {
    openView('calendar');
    openView('todo');
    const view = render(ViewTabs);

    await fireEvent.keyDown(view.getByRole('tab', { name: 'To-do' }), { key: 'ArrowRight' });
    expect(get(activeView)).toBe('dashboard');

    await fireEvent.keyDown(view.getByRole('tab', { name: 'Dashboard' }), { key: 'ArrowLeft' });
    expect(get(activeView)).toBe('todo');

    await fireEvent.keyDown(view.getByRole('tab', { name: 'To-do' }), { key: 'Home' });
    expect(get(activeView)).toBe('dashboard');

    await fireEvent.keyDown(view.getByRole('tab', { name: 'Dashboard' }), { key: 'End' });
    expect(get(activeView)).toBe('todo');
    await vi.waitFor(() => expect(view.getByRole('tab', { name: 'To-do' })).toHaveFocus());
  });

  it('closes a closable tab with Delete and keeps focus on the tab strip', async () => {
    openView('calendar');
    const view = render(ViewTabs);
    const calendar = view.getByRole('tab', { name: 'Calendar' });
    expect(calendar).toHaveAttribute('aria-keyshortcuts', 'Delete Control+Shift+PageUp Control+Shift+PageDown');

    await fireEvent.keyDown(calendar, { key: 'Delete' });

    expect(get(openViews)).toEqual(['dashboard']);
    await vi.waitFor(() => expect(view.getByRole('tab', { name: 'Dashboard' })).toHaveFocus());
  });

  it('does not close the dashboard with Delete', async () => {
    const view = render(ViewTabs);
    const dashboard = view.getByRole('tab', { name: 'Dashboard' });
    expect(dashboard).not.toHaveAttribute('aria-keyshortcuts');

    await fireEvent.keyDown(dashboard, { key: 'Delete' });

    expect(get(openViews)).toEqual(['dashboard']);
  });

  describe('dragging tabs', () => {
    beforeEach(() => {
      openView('calendar');
      openView('todo');
      openView('settings');
    });

    it('moves a tab to where it is dropped, showing where it will go', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const settings = view.getByRole('tab', { name: 'Settings' });
      activeView.set('todo');

      // To the gap between Dashboard and Calendar.
      await dragTab(settings, 140);

      expect(settings).toHaveAttribute('data-dragging', 'inside');
      expect(within(view.getByRole('tab', { name: 'Calendar' })).getByTestId('drop-indicator')).toBeInTheDocument();
      expect(get(activeView)).toBe('settings');

      await fireEvent.pointerUp(settings, { pointerId: 1, button: 0, clientX: 140, clientY: 20 });

      expect(get(openViews)).toEqual(['dashboard', 'settings', 'calendar', 'todo']);
      expect(tabNames(view.getAllByRole('tab'))).toEqual(['Dashboard', 'Settings', 'Calendar', 'To-do']);
      expect(view.queryByTestId('drop-indicator')).not.toBeInTheDocument();
      expect(view.getByRole('status')).toHaveTextContent('Settings tab moved to position 2 of 4');
    });

    it('moves a tab after the last one', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const calendar = view.getByRole('tab', { name: 'Calendar' });

      await dragTab(calendar, 500);
      expect(within(view.getByRole('tab', { name: 'Settings' })).getByTestId('drop-indicator')).toBeInTheDocument();
      await fireEvent.pointerUp(calendar, { pointerId: 1, button: 0, clientX: 500, clientY: 20 });

      expect(get(openViews)).toEqual(['dashboard', 'todo', 'settings', 'calendar']);
    });

    it('keeps the pinned dashboard first', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const todo = view.getByRole('tab', { name: 'To-do' });

      await dragTab(todo, 5);
      await fireEvent.pointerUp(todo, { pointerId: 1, button: 0, clientX: 5, clientY: 20 });

      expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar', 'settings']);
    });

    it('does not drag the pinned dashboard', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const dashboard = view.getByRole('tab', { name: 'Dashboard' });

      await dragTab(dashboard, 380);
      await fireEvent.pointerUp(dashboard, { pointerId: 1, button: 0, clientX: 380, clientY: 20 });

      expect(dashboard).not.toHaveAttribute('data-dragging');
      expect(get(openViews)).toEqual(['dashboard', 'calendar', 'todo', 'settings']);
    });

    it('does not start a drag from the close control', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));

      await fireEvent.pointerDown(view.getByTestId('close-todo'), { pointerId: 1, button: 0, clientX: 290, clientY: 20 });
      await fireEvent.pointerMove(view.getByTestId('close-todo'), { pointerId: 1, clientX: 380, clientY: 20 });

      expect(view.getByRole('tab', { name: 'To-do' })).not.toHaveAttribute('data-dragging');
    });

    it('treats a press that barely moves as a click', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const calendar = view.getByRole('tab', { name: 'Calendar' });

      await fireEvent.pointerDown(calendar, { pointerId: 1, button: 0, clientX: 150, clientY: 20 });
      await fireEvent.pointerMove(calendar, { pointerId: 1, clientX: 153, clientY: 21 });
      await fireEvent.pointerUp(calendar, { pointerId: 1, button: 0, clientX: 153, clientY: 21 });
      await fireEvent.click(calendar);

      expect(calendar).not.toHaveAttribute('data-dragging');
      expect(get(openViews)).toEqual(['dashboard', 'calendar', 'todo', 'settings']);
      expect(get(activeView)).toBe('calendar');
    });

    it('cancels a drag with Escape', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const settings = view.getByRole('tab', { name: 'Settings' });

      await dragTab(settings, 140);
      await fireEvent.keyDown(window, { key: 'Escape' });
      await fireEvent.pointerUp(settings, { pointerId: 1, button: 0, clientX: 140, clientY: 20 });

      expect(view.queryByTestId('drop-indicator')).not.toBeInTheDocument();
      expect(get(openViews)).toEqual(['dashboard', 'calendar', 'todo', 'settings']);
    });

    it('opens a tab dropped outside the window in a window of its own', async () => {
      desktop.available = true;
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const calendar = view.getByRole('tab', { name: 'Calendar' });

      await dragTab(calendar, 150, -40);
      expect(calendar).toHaveAttribute('data-dragging', 'outside');
      expect(view.queryByTestId('drop-indicator')).not.toBeInTheDocument();
      await fireEvent.pointerUp(calendar, { pointerId: 1, button: 0, clientX: 150, clientY: -40 });

      expect(desktop.requests.detachView).toHaveBeenCalledWith(expect.objectContaining({ view: 'calendar', title: 'Calendar' }));
      await vi.waitFor(() => expect(view.queryByRole('tab', { name: 'Calendar' })).not.toBeInTheDocument());
      expect(get(detachedViews)).toEqual(['calendar']);
    });

    it('only moves tabs outside the desktop app', async () => {
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      const calendar = view.getByRole('tab', { name: 'Calendar' });

      await dragTab(calendar, 1100);
      expect(calendar).toHaveAttribute('data-dragging', 'inside');
      await fireEvent.pointerUp(calendar, { pointerId: 1, button: 0, clientX: 1100, clientY: 20 });

      expect(desktop.requests.detachView).not.toHaveBeenCalled();
      expect(get(openViews)).toEqual(['dashboard', 'todo', 'settings', 'calendar']);
    });

    it('shows where a view window dragged over the tabs would go', async () => {
      const view = render(ViewTabs);

      windowDropTarget.set({ view: 'about', index: 2 });
      expect(await within(view.getByRole('tab', { name: 'To-do' })).findByTestId('drop-indicator')).toBeInTheDocument();

      windowDropTarget.set({ view: 'about', index: 4 });
      expect(await within(view.getByRole('tab', { name: 'Settings' })).findByTestId('drop-indicator')).toBeInTheDocument();

      windowDropTarget.set(null);
      await vi.waitFor(() => expect(view.queryByTestId('drop-indicator')).not.toBeInTheDocument());
    });

    it('tells the backend where the tabs are while views have windows of their own', async () => {
      desktop.available = true;
      const view = render(ViewTabs);
      layOutTabs(view.getAllByRole('tab'));
      vi.spyOn(view.getByRole('tablist'), 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 8, width: 800, height: 38 })
      );
      await fireEvent.pointerMove(view.getByRole('tablist'), { pointerId: 1, clientX: 20, clientY: 20, screenX: 120, screenY: 90 });
      expect(desktop.requests.reportTabStrip).not.toHaveBeenCalled();

      detachedViews.set(['about']);

      await vi.waitFor(() =>
        expect(desktop.requests.reportTabStrip).toHaveBeenCalledWith({
          strip: { x: 0, y: 8, width: 800, height: 38 },
          tabs: [
            { left: 0, right: 100 },
            { left: 104, right: 204 },
            { left: 208, right: 308 },
            { left: 312, right: 412 },
          ],
          firstMovable: 1,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          origin: { x: 100, y: 70 },
        })
      );
    });

    it('moves the focused tab with Control+Shift+PageUp and PageDown', async () => {
      const view = render(ViewTabs);
      const todo = view.getByRole('tab', { name: 'To-do' });

      await fireEvent.keyDown(todo, { key: 'PageUp', ctrlKey: true, shiftKey: true });
      expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar', 'settings']);
      expect(view.getByRole('status')).toHaveTextContent('To-do tab moved to position 2 of 4');
      await vi.waitFor(() => expect(view.getByRole('tab', { name: 'To-do' })).toHaveFocus());

      // Not before the pinned dashboard.
      await fireEvent.keyDown(todo, { key: 'PageUp', ctrlKey: true, shiftKey: true });
      expect(get(openViews)).toEqual(['dashboard', 'todo', 'calendar', 'settings']);

      await fireEvent.keyDown(todo, { key: 'PageDown', ctrlKey: true, shiftKey: true });
      await fireEvent.keyDown(todo, { key: 'PageDown', ctrlKey: true, shiftKey: true });
      await fireEvent.keyDown(todo, { key: 'PageDown', ctrlKey: true, shiftKey: true });
      expect(get(openViews)).toEqual(['dashboard', 'calendar', 'settings', 'todo']);

      // PageUp alone does not move tabs.
      await fireEvent.keyDown(todo, { key: 'PageUp' });
      expect(get(openViews)).toEqual(['dashboard', 'calendar', 'settings', 'todo']);
    });

    it('does not move the tab of a view window', async () => {
      resetViews();
      openViews.set(['calendar']);
      activeView.set('calendar');
      const view = render(ViewTabs, { movable: false });
      const calendar = view.getByRole('tab', { name: 'Calendar' });

      expect(calendar).toHaveAttribute('aria-keyshortcuts', 'Delete');
      await fireEvent.pointerDown(calendar, { pointerId: 1, button: 0, clientX: 50, clientY: 20 });
      await fireEvent.pointerMove(calendar, { pointerId: 1, clientX: 50, clientY: -40 });

      expect(calendar).not.toHaveAttribute('data-dragging');
    });
  });
});
