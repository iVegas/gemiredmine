import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, createEvent, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ViewTabs from '../ViewTabs.svelte';
import { openViews, activeView, openView, resetViews } from '../lib/views';
import { detachedViews, windowDropTarget } from '../lib/windows';
import { VIEW_DRAG_TYPE } from '../../shared/windows';

const desktop = vi.hoisted(() => ({
  available: false,
  requests: {
    detachView: vi.fn(),
    attachViewWindow: vi.fn(),
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

/**
 * Fires a drag event the way a browser does for a drag from another window: the data cannot be read before the drop.
 * Returns whether the event allowed the drop, and the data transfer the handlers saw.
 */
async function dragEvent(
  type: 'dragStart' | 'dragOver' | 'dragLeave' | 'drop',
  target: Element,
  init: { types?: string[]; data?: string; clientX?: number; relatedTarget?: Element } = {}
) {
  const data: Record<string, string> = init.data === undefined ? {} : { [VIEW_DRAG_TYPE]: init.data };
  const dataTransfer = {
    types: init.types ?? Object.keys(data),
    getData: (type: string) => data[type] ?? '',
    setData: vi.fn((type: string, value: string) => void (data[type] = value)),
    effectAllowed: '',
    dropEffect: '',
  };
  const event = createEvent[type](target, { dataTransfer });
  Object.defineProperty(event, 'clientX', { value: init.clientX ?? 0 });
  if (init.relatedTarget) Object.defineProperty(event, 'relatedTarget', { value: init.relatedTarget });
  return { allowed: !(await fireEvent(target, event)), dataTransfer };
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

      windowDropTarget.set({ index: 2 });
      expect(await within(view.getByRole('tab', { name: 'To-do' })).findByTestId('drop-indicator')).toBeInTheDocument();

      windowDropTarget.set({ index: 4 });
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

    describe('a view window dragged onto the tabs by its tab', () => {
      it('shows where the view would go and allows the drop', async () => {
        desktop.available = true;
        const view = render(ViewTabs);
        layOutTabs(view.getAllByRole('tab'));
        const strip = view.getByRole('tablist');

        // Over the middle of the second tab (to-do): the view would go after it.
        const { allowed, dataTransfer } = await dragEvent('dragOver', strip, { types: [VIEW_DRAG_TYPE], clientX: 160 });

        expect(allowed).toBe(true);
        expect(dataTransfer.dropEffect).toBe('move');
        expect(get(windowDropTarget)).toEqual({ index: 2 });
        expect(await within(view.getByRole('tab', { name: 'To-do' })).findByTestId('drop-indicator')).toBeInTheDocument();
      });

      it('never offers a place before the pinned dashboard', async () => {
        desktop.available = true;
        const view = render(ViewTabs);
        layOutTabs(view.getAllByRole('tab'));

        await dragEvent('dragOver', view.getByRole('tablist'), { types: [VIEW_DRAG_TYPE], clientX: 2 });

        expect(get(windowDropTarget)).toEqual({ index: 1 });
      });

      it('clears the place when the drag leaves the tabs, but not when it moves from one tab to the next', async () => {
        desktop.available = true;
        const view = render(ViewTabs);
        const strip = view.getByRole('tablist');
        windowDropTarget.set({ index: 2 });

        await dragEvent('dragLeave', view.getByRole('tab', { name: 'To-do' }), { relatedTarget: view.getByRole('tab', { name: 'Settings' }) });
        expect(get(windowDropTarget)).toEqual({ index: 2 });

        await dragEvent('dragLeave', strip, { relatedTarget: document.body });
        expect(get(windowDropTarget)).toBeNull();
      });

      it('puts the dropped view where it was dropped', async () => {
        desktop.available = true;
        const view = render(ViewTabs);
        layOutTabs(view.getAllByRole('tab'));

        const { allowed } = await dragEvent('drop', view.getByRole('tablist'), { data: 'about', clientX: 400 });

        expect(allowed).toBe(true);
        expect(desktop.requests.attachViewWindow).toHaveBeenCalledWith({ view: 'about', index: 4 });
        expect(get(windowDropTarget)).toBeNull();
      });

      it('ignores drags that are not a view from this app, and data that is not a closable view', async () => {
        desktop.available = true;
        const view = render(ViewTabs);
        layOutTabs(view.getAllByRole('tab'));
        const strip = view.getByRole('tablist');

        // Text or a file dragged in from elsewhere.
        expect((await dragEvent('dragOver', strip, { types: ['text/plain', 'Files'] })).allowed).toBe(false);
        expect(get(windowDropTarget)).toBeNull();
        expect((await dragEvent('drop', strip, { types: ['text/plain'] })).allowed).toBe(false);

        // The right type, but not a view that can have a window of its own.
        for (const data of ['dashboard', 'nonsense', '../x', 'Todo', '']) {
          await dragEvent('drop', strip, { data, clientX: 400 });
        }
        expect(desktop.requests.attachViewWindow).not.toHaveBeenCalled();
      });

      it('takes no drops outside the desktop app', async () => {
        const view = render(ViewTabs);

        expect((await dragEvent('dragOver', view.getByRole('tablist'), { types: [VIEW_DRAG_TYPE] })).allowed).toBe(false);
        expect(get(windowDropTarget)).toBeNull();
      });

      it('makes the tab of a view window draggable, carrying the view', async () => {
        desktop.available = true;
        resetViews();
        openViews.set(['calendar']);
        activeView.set('calendar');
        const view = render(ViewTabs, { movable: false });
        const calendar = view.getByRole('tab', { name: 'Calendar' });

        expect(calendar).toHaveAttribute('draggable', 'true');
        const { dataTransfer } = await dragEvent('dragStart', calendar);

        expect(dataTransfer.setData).toHaveBeenCalledWith(VIEW_DRAG_TYPE, 'calendar');
        expect(dataTransfer.effectAllowed).toBe('move');
      });

      it('does not make the tabs of the main window draggable this way', async () => {
        desktop.available = true;
        openView('calendar');
        const view = render(ViewTabs);
        const calendar = view.getByRole('tab', { name: 'Calendar' });

        expect(calendar).not.toHaveAttribute('draggable');
        const { dataTransfer } = await dragEvent('dragStart', calendar);
        expect(dataTransfer.setData).not.toHaveBeenCalled();
      });
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
