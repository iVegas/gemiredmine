import { Electroview } from 'electrobun/view';
import type { GemiRPCSchema, WindowMessages } from '../../shared/rpc';

type MessageListeners = { [K in keyof WindowMessages]?: (payload: WindowMessages[K]) => void };

const messageListeners: MessageListeners = {};

const defineRpc = () =>
  Electroview.defineRPC<GemiRPCSchema>({
    // Redmine lists can be slow on large instances. The backend gives up on a silent server after 30 s
    // with a message saying so, so this limit sits just above it and only catches a lost backend.
    maxRequestTime: 35_000,
    handlers: {
      messages: {
        '*': (name, payload) => (messageListeners[name] as ((payload: unknown) => void) | undefined)?.(payload),
      },
    },
  });

let rpc: ReturnType<typeof defineRpc> | null = null;

/** Whether the webview runs in the desktop app, where the Bun backend is available. */
export function hasDesktopBackend(): boolean {
  return typeof window !== 'undefined' && '__electrobun' in window;
}

/**
 * The Electrobun bridge only exists inside the desktop webview. It is created on first use
 * so that importing this module is safe elsewhere (tests, or the Capacitor Android build).
 */
export function backend() {
  if (!rpc) {
    if (!hasDesktopBackend()) {
      throw new Error('The desktop backend is not available in this environment.');
    }
    rpc = defineRpc();
    new Electroview({ rpc });
  }
  return rpc.request;
}

/** Handles a message from the backend. Connects to the backend, so that no message is missed. */
export function onBackendMessage<K extends keyof WindowMessages>(
  name: K,
  listener: ((payload: WindowMessages[K]) => void) | undefined
) {
  messageListeners[name] = listener as MessageListeners[K];
  backend();
}
