import type { PreviewPort } from '../../bun/backend';
import { ViewWindows } from '../../bun/windows/view-windows';
import type { GemiBackend } from '../../shared/backend';
import { buildInfo } from '../../shared/build-info.generated';
import type { PreviewRequests, WindowRequestHandlers, WindowRequests } from '../../shared/window-contract';
import { TauriHost } from './tauri-windows';
import {
  MAIN_LABEL,
  previewRequestNames,
  requestMain,
  serveRequests,
  windowRequestNames,
} from './window-transport';

/** The requests about the app's windows, as a window's webview makes them. */
export type WindowApi = {
  [K in keyof WindowRequests]: (params: WindowRequests[K]['params']) => Promise<WindowRequests[K]['response']>;
};

/** The size Tauri gives the main window (src-tauri/tauri.conf.json) until the window reports its own. */
const MAIN_FRAME = { x: 0, y: 0, width: 1024, height: 768 };

type PreviewHandlers = { [K in keyof PreviewRequests]: (params: PreviewRequests[K]['params']) => Promise<PreviewRequests[K]['response']> };

export interface MainLayer {
  /** What the main window's own code calls: the window requests, answered without leaving this webview. */
  api: WindowApi;
}

let mainLayer: MainLayer | null = null;

/**
 * Starts the window layer in the main window: ViewWindows, on a Tauri host, and the answers to the requests
 * of the view windows it opens. The layer is made once.
 */
export function startMainLayer(backend: () => GemiBackend): MainLayer {
  if (mainLayer) return mainLayer;

  const host = new TauriHost();
  new ViewWindows(host, buildInfo.productName).openMain(MAIN_FRAME);
  // The first measurements arrive soon; until then the frame is the one the configuration asks for.
  void host.refreshAll().catch(() => {});

  const mainRequests = host.requestsOf(MAIN_LABEL);
  if (!mainRequests) throw new Error('The main window did not start.');

  // The developer preview belongs to this window. A view window's backend hands its diagnostics over.
  const preview: PreviewHandlers = {
    previewStatus: () => backend().getDevPreviewStatus(),
    previewSetEnabled: ({ enabled }) => backend().setDevPreviewEnabled(enabled),
    previewRecord: ({ level, scope, message }) => backend().recordDiagnostic(level, scope, message),
    previewCreateFeedback: (input) => backend().createFeedback(input),
  };

  void serveRequests((from, name, params) => {
    if (previewRequestNames.includes(name as keyof PreviewRequests)) {
      return (preview[name as keyof PreviewRequests] as (params: unknown) => Promise<unknown>)(params);
    }
    // Only the requests of the contract, and only the handlers of the window that asked.
    if (!windowRequestNames.includes(name as keyof WindowRequests)) throw new Error(`Unknown request: ${name}`);
    const handler = host.requestsOf(from)?.[name as keyof WindowRequests] as ((params: unknown) => unknown) | undefined;
    if (!handler) throw new Error(`No window answers for ${from}.`);
    return handler(params);
  });

  mainLayer = { api: localApi(mainRequests) };
  return mainLayer;
}

function localApi(handlers: WindowRequestHandlers): WindowApi {
  return Object.fromEntries(
    windowRequestNames.map((name) => [name, async (params: never) => (handlers[name] as (params: never) => unknown)(params)])
  ) as unknown as WindowApi;
}

/** The window requests, as a view window makes them: the main window answers. */
export function remoteWindowApi(): WindowApi {
  return Object.fromEntries(
    windowRequestNames.map((name) => [name, (params: unknown) => requestMain(name, params)])
  ) as unknown as WindowApi;
}

/** A view window's stand-in for the developer preview: everything goes to the main window's. */
export function remotePreview(): PreviewPort {
  return {
    status: () => requestMain('previewStatus'),
    setEnabled: (enabled) => requestMain('previewSetEnabled', { enabled }),
    record: (event) => {
      // Diagnostics are best effort, and must not slow or break the call being reported.
      void requestMain('previewRecord', event).catch(() => {});
    },
    createFeedback: (input) => requestMain('previewCreateFeedback', input),
  };
}
