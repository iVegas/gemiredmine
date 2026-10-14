import { isTauri } from '@tauri-apps/api/core';
import { createBackend } from '../../bun/backend';
import type { GemiBackend } from '../../shared/backend';
import type { WindowMessages, WindowRequests } from '../../shared/window-contract';
import { tauriPlatform } from './tauri-platform';

/** Whether the webview runs in the desktop app, where the backend runs inside the webview. */
export function hasDesktopBackend(): boolean {
  return isTauri();
}

let desktopBackend: GemiBackend | null = null;

/**
 * The backend, created on first use so that importing this module is safe elsewhere (tests, or the
 * Capacitor Android build, which has no way to reach Redmine yet).
 */
export function backend(): GemiBackend {
  if (!hasDesktopBackend()) {
    throw new Error('The desktop backend is not available in this environment.');
  }
  return (desktopBackend ??= createBackend(tauriPlatform()));
}

/** The requests about the app's windows, which the window layer answers. */
export type WindowApi = {
  [K in keyof WindowRequests]: (params: WindowRequests[K]['params']) => Promise<WindowRequests[K]['response']>;
};

/**
 * Whether view tabs can open in windows of their own. The Tauri shell has a single window for now,
 * so the tab strip never offers to detach a view and none of the window requests are made.
 */
export function hasWindowLayer(): boolean {
  return false;
}

export function windowBackend(): WindowApi {
  throw new Error('Windows of their own are not available in this build.');
}

/** Handles a message from the window layer. With no window layer there are none to receive. */
export function onBackendMessage<K extends keyof WindowMessages>(
  _name: K,
  _listener: ((payload: WindowMessages[K]) => void) | undefined
) {}
