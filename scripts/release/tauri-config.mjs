// The per-channel part of the Tauri configuration.
//
// src-tauri/tauri.conf.json holds the dev channel and everything shared. This returns the JSON Merge
// Patch that `tauri build --config` lays over it for one channel, so the identity (name, identifier,
// version, icons, capabilities) comes from channels.mjs and nowhere else. Pure, so a test can check it.
//
// The overlay never contains `null` (a merge patch deletes the key then) and never the CSP, which
// every channel shares from the base file. Arrays are replaced whole, so `windows` is complete.

/**
 * The size of the main window, as before the move to Tauri. The app takes no files dropped on it, and Tauri's
 * handling of them would stop a view's tab being dragged into this window from another one (on Windows).
 */
const MAIN_WINDOW = Object.freeze({ label: 'main', width: 1024, height: 768, dragDropEnabled: false });

/**
 * The capabilities of every channel: the backend in each window, the main window's own, the view windows', and the
 * main window's access to the app's database.
 */
const WINDOW_CAPABILITIES = Object.freeze(['backend', 'main', 'view-window', 'storage']);

/**
 * @param {ReturnType<typeof import('./channels.mjs').deriveBuildInfo>} info
 */
export function tauriChannelConfig(info) {
  const capabilities = info.devPreviewAvailable ? [...WINDOW_CAPABILITIES, `dev-preview-${info.channel}`] : [...WINDOW_CAPABILITIES];
  return {
    productName: info.productName,
    mainBinaryName: info.appName,
    version: info.version,
    identifier: info.identifier,
    app: {
      windows: [{ ...MAIN_WINDOW, title: info.productName }],
      security: { capabilities },
    },
    bundle: {
      icon: [`../assets/icons/${info.channel}.png`, `../assets/icons/${info.channel}.ico`],
    },
  };
}

/**
 * The arguments for the Tauri CLI. Developer tools exist only where the developer preview does,
 * never in stable. Everything after `--` goes to cargo, and `--locked` makes the build fail when
 * Cargo.lock needs an update instead of silently changing it.
 *
 * @param {ReturnType<typeof import('./channels.mjs').deriveBuildInfo>} info
 * @param {{ cli: string, overlayPath: string }} paths the CLI script and the file `tauriChannelConfig` was written to
 */
export function tauriBuildArgs(info, { cli, overlayPath }) {
  return [
    cli,
    'build',
    '--no-bundle',
    '--config',
    overlayPath,
    ...(info.devPreviewAvailable ? ['--features', 'devtools'] : []),
    '--',
    '--locked',
  ];
}
