import { BrowserWindow, Screen } from 'electrobun';
import { containsPoint, viewWindowHash } from '../../shared/windows';
import { createRpc } from '../rpc';
import type { ViewWindowsHost } from './view-windows';

const MAIN_VIEW_URL = 'views://mainview/index.html';

/** Opens app windows with Electrobun, and reads the pointer from the screen. */
export const electrobunHost: ViewWindowsHost = {
  openWindow({ title, view, frame, requests }) {
    // Each window gets its own RPC, so the backend knows which window a request comes from.
    const rpc = createRpc(requests);
    // The window is initialised by its constructor; no separate init call is needed.
    const window = new BrowserWindow({
      title,
      url: view ? `${MAIN_VIEW_URL}${viewWindowHash(view)}` : MAIN_VIEW_URL,
      frame,
      rpc,
    });
    return {
      id: window.id,
      getFrame: () => window.getFrame(),
      isMinimized: () => window.isMinimized(),
      activate: () => window.activate(),
      close: () => window.close(),
      onMove: listener => window.on('move', () => listener()),
      onClose: listener => window.on('close', () => listener()),
      send: rpc.send,
    };
  },

  cursor: () => Screen.getCursorScreenPoint(),

  primaryButtonDown: () => (Screen.getMouseButtons() & 1n) === 1n,

  workAreaAt: point => Screen.getAllDisplays().find(display => containsPoint(display.bounds, point))?.workArea,

  repeat(ms, task) {
    // The first run waits for a timer too, so that it never runs inside a native event callback.
    const first = setTimeout(task, 0);
    const timer = setInterval(task, ms);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  },
};
