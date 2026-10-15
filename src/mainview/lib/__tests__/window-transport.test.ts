import { describe, it, expect, vi, beforeEach } from 'vitest';

// A bus that stands in for Tauri's events. A listener hears an event when it was sent to the window the listener
// named, or when it named no window at all, which is how Tauri treats a listener with no target. `emitTo` records
// where each event was sent.
type Handler = (event: { payload: unknown }) => void;
const bus = vi.hoisted(() => ({
  label: 'view-calendar',
  listeners: new Map<string, { handler: Handler; target?: string }[]>(),
  sent: [] as { target: string; event: string; payload: unknown }[],
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: Handler, options?: { target?: string }) => {
    const entry = { handler, target: options?.target };
    bus.listeners.set(event, [...(bus.listeners.get(event) ?? []), entry]);
    return () => bus.listeners.set(event, (bus.listeners.get(event) ?? []).filter((candidate) => candidate !== entry));
  }),
  emitTo: vi.fn(async (target: string, event: string, payload: unknown) => {
    bus.sent.push({ target, event, payload });
    // Delivery is asynchronous, like the real thing.
    await Promise.resolve();
    for (const entry of bus.listeners.get(event) ?? []) {
      if (entry.target === undefined || entry.target === target) entry.handler({ payload });
    }
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: bus.label }) }));

import {
  MESSAGE_NAMES,
  isViewLabel,
  previewRequestNames,
  receiveMessages,
  requestMain,
  sendMessage,
  serveRequests,
  viewLabel,
  windowRequestNames,
} from '../window-transport';

describe('labels', () => {
  it('gives each view the same window label, and recognises only those labels', () => {
    expect(viewLabel('calendar')).toBe('view-calendar');
    expect(isViewLabel('view-calendar')).toBe(true);
    for (const other of ['main', 'view-', 'view-Calendar', 'view-a/b', 'viewcalendar', 'settings']) {
      expect(isViewLabel(other), other).toBe(false);
    }
  });

  it('names every request and message of the contract', () => {
    expect(windowRequestNames.sort()).toEqual(
      [
        'attachView',
        'attachViewWindow',
        'closeViewWindow',
        'detachView',
        'focusViewWindow',
        'getSession',
        'openInMainWindow',
        'reportTabStrip',
        'shareSession',
      ].sort()
    );
    expect(previewRequestNames.sort()).toEqual(['previewCreateFeedback', 'previewRecord', 'previewSetEnabled', 'previewStatus']);
    expect(Object.keys(MESSAGE_NAMES).sort()).toEqual(['openView', 'sessionChanged', 'viewAttached', 'viewDropTarget', 'viewWindowClosed']);
  });
});

describe('requests to the main window', () => {
  beforeEach(() => {
    // A window listens for answers once for as long as it lives, so that listener stays between tests.
    bus.listeners.delete('gemi:request');
    bus.sent.length = 0;
    bus.label = 'view-calendar';
  });

  it('are answered with the result, and name the window that asked', async () => {
    const handle = vi.fn(async (_from: string, _name: string, params: unknown) => ({ echoed: params }));
    await serveRequests(handle);

    const result = await requestMain('getSession', { some: 'thing' });

    expect(result).toEqual({ echoed: { some: 'thing' } });
    expect(handle).toHaveBeenCalledWith('view-calendar', 'getSession', { some: 'thing' });
    expect(bus.sent[0]).toMatchObject({ target: 'main', event: 'gemi:request' });
    expect(bus.sent[1]).toMatchObject({ target: 'view-calendar', event: 'gemi:response', payload: { ok: true } });
  });

  it('fail with the message of the error the main window threw', async () => {
    await serveRequests(async () => {
      throw new Error('Only the main window can do this.');
    });

    await expect(requestMain('detachView', {})).rejects.toThrow('Only the main window can do this.');
  });

  it('are matched to their own answers when several are in flight', async () => {
    await serveRequests(async (_from, _name, params) => {
      await new Promise((resolve) => setTimeout(resolve, (params as { delay: number }).delay));
      return params;
    });

    const [slow, fast] = await Promise.all([requestMain('getSession', { delay: 20, id: 'slow' }), requestMain('getSession', { delay: 1, id: 'fast' })]);

    expect(slow).toEqual({ delay: 20, id: 'slow' });
    expect(fast).toEqual({ delay: 1, id: 'fast' });
  });

  it('give up when the main window does not answer', async () => {
    vi.useFakeTimers();
    try {
      const answer = requestMain('getSession');
      const failure = answer.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(35_001);

      expect(((await failure) as Error).message).toBe('The main window did not answer.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('are ignored when they do not come from a view window', async () => {
    const handle = vi.fn();
    await serveRequests(handle);
    bus.label = 'main';

    const request = requestMain('getSession');
    const outcome = await Promise.race([request.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('ignored'), 20))]);

    expect(outcome).toBe('ignored');
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('messages', () => {
  beforeEach(() => {
    bus.listeners.delete('gemi:message');
    bus.sent.length = 0;
  });

  it('go to the window they are sent to and reach its listener with the payload', async () => {
    const listener = vi.fn();
    bus.label = 'view-todo';
    await receiveMessages(listener);

    await sendMessage('view-todo', 'viewAttached', { view: 'todo', index: 2 });

    expect(bus.sent[0]).toEqual({ target: 'view-todo', event: 'gemi:message', payload: { name: 'viewAttached', payload: { view: 'todo', index: 2 } } });
    expect(listener).toHaveBeenCalledWith('viewAttached', { view: 'todo', index: 2 });
  });

  it('are not heard by another window', async () => {
    const heardByCalendar = vi.fn();
    const heardByMain = vi.fn();
    bus.label = 'view-calendar';
    await receiveMessages(heardByCalendar);
    bus.label = 'main';
    await receiveMessages(heardByMain);

    await sendMessage('main', 'openView', { view: 'about' });

    expect(heardByMain).toHaveBeenCalledWith('openView', { view: 'about' });
    expect(heardByCalendar).not.toHaveBeenCalled();
  });

  it('are dropped when their name is not one of the contract', async () => {
    const listener = vi.fn();
    await receiveMessages(listener);

    for (const { handler } of bus.listeners.get('gemi:message') ?? []) handler({ payload: { name: 'somethingElse', payload: 1 } });

    expect(listener).not.toHaveBeenCalled();
  });

  it('stop arriving once the listener is removed', async () => {
    const listener = vi.fn();
    bus.label = 'main';
    const stop = await receiveMessages(listener);

    stop();
    await sendMessage('main', 'openView', { view: 'about' });

    expect(listener).not.toHaveBeenCalled();
  });
});
