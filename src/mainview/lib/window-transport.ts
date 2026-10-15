import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { PreviewRequests, WindowMessages, WindowRequests } from '../../shared/window-contract';

// Every window of the app has its own JavaScript, so the windows talk through Tauri events. A view window asks
// the main window (which owns the window layer and the developer preview) for something and waits for the
// answer; the main window and the layer also send messages to a window without being asked.
//
// A listener has to name the window it listens for. One that does not ("any target") hears every event that is
// sent to any window, so a message for a view window would be handled by the main window and the other way round.

export const MAIN_LABEL = 'main';
const VIEW_LABEL_PREFIX = 'view-';

/** The label of the window that shows `view`: the same view always gets the same window. */
export const viewLabel = (view: string) => `${VIEW_LABEL_PREFIX}${view}`;
export const isViewLabel = (label: string) => /^view-[a-z]+$/.test(label);

export const currentLabel = (): string => getCurrentWindow().label;

/** Requests a view window can make of the main window. */
export type RequestName = keyof WindowRequests | keyof PreviewRequests;

// `satisfies` makes the compiler fail when the contract gains a name that is missing here.
const WINDOW_REQUEST_NAMES = {
  detachView: true,
  focusViewWindow: true,
  reportTabStrip: true,
  attachView: true,
  closeViewWindow: true,
  openInMainWindow: true,
  getSession: true,
  shareSession: true,
} satisfies Record<keyof WindowRequests, true>;

const PREVIEW_REQUEST_NAMES = {
  previewStatus: true,
  previewSetEnabled: true,
  previewRecord: true,
  previewCreateFeedback: true,
} satisfies Record<keyof PreviewRequests, true>;

export const windowRequestNames = Object.keys(WINDOW_REQUEST_NAMES) as (keyof WindowRequests)[];
export const previewRequestNames = Object.keys(PREVIEW_REQUEST_NAMES) as (keyof PreviewRequests)[];

export const MESSAGE_NAMES = {
  sessionChanged: true,
  viewDropTarget: true,
  viewAttached: true,
  viewWindowClosed: true,
  openView: true,
} satisfies Record<keyof WindowMessages, true>;

const REQUEST_EVENT = 'gemi:request';
const RESPONSE_EVENT = 'gemi:response';
const MESSAGE_EVENT = 'gemi:message';

/** How long a view window waits for the main window. Redmine lists take up to 30 s, which a relay would not add to. */
const REQUEST_TIMEOUT_MS = 35_000;

interface RequestEnvelope {
  id: string;
  from: string;
  name: string;
  params: unknown;
}

interface ResponseEnvelope {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let listeningForResponses: Promise<UnlistenFn> | null = null;

function listenForResponses(): Promise<UnlistenFn> {
  listeningForResponses ??= listen<ResponseEnvelope>(
    RESPONSE_EVENT,
    ({ payload }) => {
      const request = pending.get(payload.id);
      if (!request) return;
      pending.delete(payload.id);
      clearTimeout(request.timer);
      if (payload.ok) request.resolve(payload.value);
      else request.reject(new Error(payload.error ?? 'The request failed.'));
    },
    { target: currentLabel() }
  );
  return listeningForResponses;
}

/** A view window asks the main window to do something, and waits for its answer. */
export async function requestMain<T>(name: RequestName, params?: unknown): Promise<T> {
  await listenForResponses();
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The main window did not answer.'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    const envelope: RequestEnvelope = { id, from: currentLabel(), name, params };
    emitTo(MAIN_LABEL, REQUEST_EVENT, envelope).catch((error: unknown) => {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/**
 * The main window answers requests from the view windows. `handle` runs with the label of the window that
 * asked, and its result, or its error, goes back to that window. Returns a function that stops answering.
 */
export async function serveRequests(
  handle: (from: string, name: string, params: unknown) => unknown | Promise<unknown>
): Promise<UnlistenFn> {
  return listen<RequestEnvelope>(
    REQUEST_EVENT,
    async ({ payload }) => {
      // Only the app's own view windows ask; anything else is ignored.
      if (!isViewLabel(payload.from)) return;
      let response: ResponseEnvelope;
      try {
        response = { id: payload.id, ok: true, value: await handle(payload.from, payload.name, payload.params) };
      } catch (error) {
        response = { id: payload.id, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      await emitTo(payload.from, RESPONSE_EVENT, response).catch(() => {});
    },
    { target: MAIN_LABEL }
  );
}

interface MessageEnvelope {
  name: string;
  payload: unknown;
}

/** Sends a message to one window, which handles it with `receiveMessages`. */
export function sendMessage(label: string, name: keyof WindowMessages, payload: unknown): Promise<void> {
  const envelope: MessageEnvelope = { name, payload };
  return emitTo(label, MESSAGE_EVENT, envelope);
}

/** Handles the messages sent to this window. Returns a function that stops handling them. */
export function receiveMessages(listener: (name: keyof WindowMessages, payload: unknown) => void): Promise<UnlistenFn> {
  return listen<MessageEnvelope>(
    MESSAGE_EVENT,
    ({ payload }) => {
      if (payload.name in MESSAGE_NAMES) listener(payload.name as keyof WindowMessages, payload.payload);
    },
    { target: currentLabel() }
  );
}
