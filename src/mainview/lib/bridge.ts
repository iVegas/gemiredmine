import { isTauri } from '@tauri-apps/api/core';
import { createBackend } from '../../bun/backend';
import type { GemiBackend } from '../../shared/backend';
import type { WindowMessages } from '../../shared/window-contract';
import { expireSignIn } from './sign-in';
import { tauriPlatform } from './tauri-platform';
import { remotePreview, remoteWindowApi, startMainLayer, type WindowApi } from './window-layer';
import { MAIN_LABEL, currentLabel, isViewLabel, receiveMessages } from './window-transport';

export type { WindowApi };

/** Whether the webview runs in the desktop app, where the backend runs inside the webview. */
export function hasDesktopBackend(): boolean {
  return isTauri();
}

let desktopBackend: GemiBackend | null = null;

/**
 * The backend, created on first use so that importing this module is safe elsewhere (tests, or the
 * Capacitor Android build, which has no way to reach Redmine yet).
 *
 * Every window has its own backend and its own HTTP client. The developer preview is owned by the main
 * window, so a view window's backend hands its diagnostics over instead of opening one.
 */
export function backend(): GemiBackend {
  if (!hasDesktopBackend()) {
    throw new Error('The desktop backend is not available in this environment.');
  }
  return (desktopBackend ??= createBackend(tauriPlatform(), {
    // A server that rejects an API key signs the user out of it, in whichever window the request was made.
    onUnauthorized: expireSignIn,
    ...(isViewLabel(currentLabel()) ? { preview: remotePreview() } : {}),
  }));
}

/**
 * Whether the webview runs on Android. The WebView says so in its user agent, which can be read synchronously; the
 * environment the shell reports is only available asynchronously.
 */
export function isAndroidWebview(): boolean {
  return typeof navigator !== 'undefined' && /\bAndroid\b/.test(navigator.userAgent);
}

/**
 * Whether view tabs can open in windows of their own: in the desktop app's main window and in those windows.
 * Android has no windows of its own, so the window layer is off there.
 */
export function hasWindowLayer(): boolean {
  if (!hasDesktopBackend() || isAndroidWebview()) return false;
  const label = currentLabel();
  return label === MAIN_LABEL || isViewLabel(label);
}

/** The requests about the app's windows. The main window answers its own; a view window asks the main window. */
export function windowBackend(): WindowApi {
  if (!hasWindowLayer()) throw new Error('Windows of their own are not available in this build.');
  return currentLabel() === MAIN_LABEL ? startMainLayer(backend).api : remoteWindowApi();
}

type MessageListeners = { [K in keyof WindowMessages]?: (payload: WindowMessages[K]) => void };

const messageListeners: MessageListeners = {};
let receiving = false;

/** Handles a message from the window layer. Starts listening, so that no message is missed. */
export function onBackendMessage<K extends keyof WindowMessages>(
  name: K,
  listener: ((payload: WindowMessages[K]) => void) | undefined
) {
  messageListeners[name] = listener as MessageListeners[K];
  if (!hasWindowLayer()) return;
  // The main window starts the layer with its first listener, so that it answers view windows from then on.
  if (currentLabel() === MAIN_LABEL) startMainLayer(backend);
  if (receiving) return;
  receiving = true;
  void receiveMessages((message, payload) => {
    (messageListeners[message] as ((payload: unknown) => void) | undefined)?.(payload);
  });
}
