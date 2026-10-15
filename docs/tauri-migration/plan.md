# Moving the desktop shell from Electrobun to Tauri 2: plan

This is the plan. What is done and what comes next is in [`progress.md`](./progress.md); read that first.
Change this file only when a decision changes, and say why in the commit.

Facts are dated **2026-10-14**. Versions move quickly: before starting a step, re-check them
(`npm view @tauri-apps/cli dist-tags`, `npm view electrobun dist-tags`, the crates index).
Claims marked *read, not run* come from reading source code and were not exercised.

## Context

gemiredmine is a Svelte 5 + Vite webview in an **Electrobun ^1.18.1** desktop shell with a Bun main
process. Android runs on **Capacitor 8**.

**Why the shell has to change**
- The Electrobun 1.x line is frozen (last release 1.18.4-beta.25, 2026-08-10).
- Electrobun 2.x (2.0.1 on 2026-08-22, 2.0.2 on 09-29, 2.0.3-beta.24 on 10-14) replaces the whole toolchain:
  the Hutch CLI downloads the SDK into `.hutch/devkit`, the npm `electrobun` package is a 46 KB bootstrap whose
  exports throw, the default runtime flipped from Cottontail to Bun between 2.0.2 and the betas, and it is
  desktop-only. Staying would also mean rewriting the build scripts.

**Decisions (made with the project owner)**
1. Move to **Tauri 2**.
2. The backend stays **TypeScript and runs inside the webview**, using the Tauri HTTP and file plugins. Rust stays minimal.
3. **Desktop first** (Linux and Windows reach parity with today). Android on Tauri, retiring Capacitor, is the next phase.

### Decision record

| Option | Evidence | Verdict |
|---|---|---|
| Stay on Electrobun 1.18.1 | No 1.x maintenance line or long-term support statement | Unmaintained; rejected |
| Electrobun 2.x | 7 weeks old, betas almost daily. The SDK comes from a downloaded devkit, so `tsc` and `vitest` need network setup first. Hutch ignores `package-lock.json` by default. One maintainer. Desktop only. *In its favour:* the smallest code diff, and it keeps `views://` and `bin/launcher`. | Rejected |
| Electron 44 | A new major roughly every 8 weeks (41 to 44 between 03-11 and 08-25), bundled Chromium (100 MB and more), no Android | Rejected |
| **Tauri 2** | Stable since 2024-10-02. cli 2.12.3, api 2.12.4, plugin-http 2.8.3, plugin-fs 2.7.1, plugin-opener 2.7.2 (crates tauri 2.12.4, tauri-build 2.7.3; the patch levels PR 2 pinned, one patch above the first assessment of 2026-10-10). Rust MSRV 1.90. The same system webviews as today (WebKitGTK 4.1, WebView2) plus Android. Risk: 3.0 is in alpha. | **Chosen.** Pin exact 2.12.x. Plan a Tauri 3 move within about a year of 3.0 going stable. |

### Electrobun coupling (complete list)

- **App code:** `src/bun/index.ts` (opens the main window through `ViewWindows`); `src/bun/rpc.ts`
  (`BrowserView.defineRPC`, `Utils.openExternal`); `src/shared/rpc.ts` (`RPCSchema` type);
  `src/mainview/lib/bridge.ts` (`Electroview`, the `__electrobun` guard, the message listener).
- **Window layer (added to `main` by `e9f36d1`, after this plan was first written):**
  `src/bun/windows/electrobun-host.ts` (`BrowserWindow`, `Screen`) under the portable `view-windows.ts`; one RPC per
  window (`createRpc`); window requests and messages typed in `src/shared/rpc.ts`; `src/mainview/lib/windows.ts`.
  See "Window layer" under PR 2.
- **Config and stubs:** `electrobun.config.ts`; `src/types/shims.d.ts` (exists only for Electrobun).
- **Scripts:** `scripts/release/build-electrobun.mjs` runs the CLI from `node_modules/electrobun`; `build-output.mjs`
  `findAppBuild` expects `build/<env>-<os>-x64/<App>/bin/launcher[.exe]`; `linux-metadata.mjs` AppRun runs
  `./bin/launcher`; `package-windows.mjs` `ensureLauncher` falls back to `node_modules/electrobun/dist-win-x64`.
- **Workflows:** the build steps in `build-linux.yml` and `build-windows.yml`.
- **Docs:** README (mentions at lines 7, 35, 59, 75-77), RELEASE_POLICY (108-110, 145-158), PLAN.md:8, ROADMAP.md:4.
- **Lockfiles:** `bun.lock` is unused.
- **Android today:** every `redmineApi` call throws outside Electrobun, so the Android app cannot reach Redmine.
  Servers and API keys were held in memory only (`src/mainview/lib/store.ts`), so a new webview origin lost no user data.
  *Since 2026-10-15 the servers (not the API keys) are kept in the app's database; see `progress.md`, "Storage".*

## Invariants

These must not change. PR 0's tests pin them.

- **Data folders:** `$XDG_DATA_HOME` or `~/.local/share/<dataDirName>`, and `%LOCALAPPDATA%\<dataDirName>`, plus the
  `GEMIREDMINE_DATA_DIR` override (`src/bun/paths.ts`).
- **Data formats:** `settings.json`, `logs/diagnostics[.N].jsonl`, `feedback/feedback-*.md`. Files 0600, folders 0700.
- **Identifiers:** `com.gemiredmine.app[.canary|.unstable|.dev]`. tauri-cli 2.12.2 only *warns* about an identifier
  ending in `.app` (`build.rs:190`), so the stable MSIX identity stays.
- **MSIX:** Name, Publisher, `msixVersion()` (`scripts/release/windows-metadata.mjs`), `Application Id="App"`,
  runFullTrust, and the `.appinstaller` feed URLs.
- **AppImage:** file and pointer names, the `.desktop` entry, the embedded `gh-releases-zsync` update information,
  release tags and `release.json`.

**Intentional changes** (list them in PR 2):
- AppRun and the MSIX `Executable` start one self-contained binary.
- The webview profile lives in `<LocalData>/<identifier>`.
- Redmine sees `Origin: tauri://localhost` (Linux) or `http://tauri.localhost` (Windows), and a plugin User-Agent.
- The feedback "Runtime" line names the Tauri and webview versions.
- Devtools are on for non-stable channels only.
- (Already shipped in PR 1: a 3xx answer is an explicit error; a request gives up after 30 s with a clear message.)

## Sequence

| Step | What | Ships to users |
|---|---|---|
| PR 0 | Safety net: golden tests and a mock Redmine | no |
| PR 1 | A runtime-neutral backend, still on Electrobun | next unstable build |
| **PR 2** | **The Tauri shell on Linux and Windows, Electrobun removed** (6 commits, draft until gates G1-G6 pass). The window layer is a second PR (PR 2b), decided 2026-10-14; see "Window layer" | unstable on merge, then canary, then stable |
| PR 3 (optional) | `tauri-driver` end-to-end tests; `git mv src/bun src/core` | no |
| Android phase | Tauri Android, retire Capacitor | later |

PR 0 and PR 1 are described in [`progress.md`](./progress.md), including what changed against the first plan.
The rest of this file is what is still ahead.

---

## PR 2: Tauri 2 shell, Electrobun removed

Open it as a draft. Each commit keeps `npm test` green, because the husky pre-commit hook runs it.
Start from `main` once PR 0 and PR 1 are merged.

**Status:** implemented as six commits on `claude/tauri-2-shell`, open as a draft; the window layer (PR 2b) is stacked on it. `progress.md` says what was built, where it
differs from the text below (marked *As built* where it matters), what was verified, and which gates are still open.

### Window layer (new on `main`: `e9f36d1`, "drag view tabs ... into windows of their own")

This landed after the plan was first written and is the largest piece of Electrobun-specific behaviour besides the
backend. Read it before estimating PR 2.

**What it is**
- `src/bun/windows/view-windows.ts`: `ViewWindows`, the window manager. It is plain TypeScript and does not import
  Electrobun. It needs a `ViewWindowsHost` (open a window, read the pointer, read the primary mouse button, find a
  display's work area, run a repeating task) and works with `AppWindow`s (frame, minimized, activate, close, move and
  close events, and `send` for messages to that window's webview). It follows a dragged view window by polling the
  pointer and the mouse button every 40 ms, and puts the view back into a tab when the window is dropped on the main
  window's tab strip. Its spec (`__tests__/view-windows.spec.ts`) runs against a fake host.
- `src/bun/windows/electrobun-host.ts` (removed in PR 2; `src/mainview/lib/tauri-windows.ts` replaces it) was the only Electrobun part: `BrowserWindow`, `Screen.getCursorScreenPoint()`,
  `Screen.getMouseButtons()`, `Screen.getAllDisplays()`.
- `src/bun/rpc.ts` `createRpc(windowRequests)` builds one RPC per window, so a request is answered knowing which window
  sent it. The requests and messages are typed in `src/shared/rpc.ts` (`WindowRequests`, `WindowMessages`).
- `src/mainview/lib/bridge.ts` is the webview's side of the RPC, and `src/mainview/lib/windows.ts` the window feature.
  `canDetachViews()` is true only where `hasDesktopBackend()` is, which today means Electrobun.
- Servers and API keys are held in memory per window, so windows pass them to each other with `shareSession`.

**What Tauri changes** (checked against `@tauri-apps/api` 2.12.3; the Wayland points are *not* verified)
1. **There is no Bun process**, so `ViewWindows` has to run somewhere else: in the main window's webview (TypeScript,
   in line with the decision to keep the backend in the webview) or in Rust. This plan assumes the webview.
2. **A `TauriHost`** implements `ViewWindowsHost` with `WebviewWindow` (created with a label and a URL such as
   `index.html#view=calendar`), `onMoved`, `onCloseRequested`, `isMinimized`, `outerPosition`, `setFocus`,
   `monitorFromPoint` and `cursorPosition()`. All of these exist. Tauri reports **physical pixels**; the Electrobun
   code works in whatever `Screen` reports, so convert with the scale factor.
3. **Window requests and messages become Tauri events** (`emitTo`, `listen`) between windows, with a small
   request and response layer (correlation ids) typed by `WindowRequests` and `WindowMessages`.
4. **There is no Tauri API for the state of the mouse buttons** (only tray events), and `ViewWindows` needs
   `primaryButtonDown()` to tell a drag by the user from a move by the window manager. That takes a small Rust
   command: on Linux through GDK, which Tauri already links; on Windows `GetAsyncKeyState`. It is the one place this
   plan needs more Rust than wiring.
5. **Wayland.** Applications cannot read the global pointer position, learn where their windows are, or place them on
   native Wayland. The feature worked there only because Electrobun forces X11 (through XWayland). *Superseded 2026-10-15:
   the owner made Wayland the first-class Linux target and expects no X11 (see below). The title-bar drop cannot work
   there, so a view's tab is also a drag source that the main window's tab strip accepts (a drag and drop between two
   windows, which the system routes without any position). Everything else was verified on a Wayland compositor.*
6. **Each webview has its own JavaScript context**, so each window would create its own `createBackend`. The developer
   preview must have a single owner, because its aggregation lives in memory and its files are rotated. View windows
   should hand their diagnostics to the main window's preview (an event), or the preview should move to Rust.
7. **Permissions.** The main capability needs window creation, focus, position and size, and event permissions for the
   label pattern of view windows (for example `view-*`), and the view windows need their own capability.
8. **The seam is `bridge.ts`.** It exports `backend()`, `hasDesktopBackend()` and `onBackendMessage()`. On Tauri,
   `redmineApi` becomes `createBackend(tauriPlatform())` directly, `hasDesktopBackend()` becomes `isTauri()`, and the
   window parts move to a Tauri window bridge that `lib/windows.ts` calls. Add `view-windows.ts` and the new
   host to `webview-safe.spec.ts` when `ViewWindows` moves into the webview.

**As built (PR 2b):** points 1 to 8 held, with these differences. The preview owner is the main window, and a view window's
backend hands its diagnostics over through a `PreviewPort` (`createBackend`'s `preview` option). Messages are Tauri events
with a request and response layer. The label pattern is `view-<view>`, so the same view always gets the same window.
Capabilities: `backend.json` (the main and view windows), `main.json` (window management) and `view-window.json`
(`start-dragging`). `core:window:allow-destroy` is not granted: there is no `onCloseRequested` handler, because its wrapper
calls `destroy()`, and a Rust `on_window_event` ends the app when the main window is destroyed instead. The Windows branch of the pointer command is written but was not run. See `progress.md`,
"PR 2b", for the findings (event targets, key order, close handling, window managers).

**Decided by the project owner, 2026-10-14: split** ("I allow a regression, the goal is to migrate"). PR 2 swaps the
shell with one window, and `canDetachViews()` is false on Tauri. A follow-up, **PR 2b**, ports the window layer as
described above. The feature is already on `main`, so Unstable users lose dragging tabs into windows between the two.
- **Answered 2026-10-15:** it does not matter whether Canary and Stable ship between PR 2 and PR 2b ("It does not matter to
  ship in mid pr or not"). So the channels are not held back: merge as soon as the gates the owner cares about have run.
- ~~**X11 only on Linux** for as long as the feature depends on global pointer access.~~ **Reversed 2026-10-15: Wayland
  first, no X11 expected** ("For linux we need support wayland first, no x11 support expected"). AppRun no longer sets
  `GDK_BACKEND`; the window layer does not need a screen position to put a view back (drag and drop of the tab), and
  places no window itself on Wayland (the compositor does). The title-bar drop remains where positions exist.

### Commit 1: `build(tauri): add the Tauri 2 shell`

- **`package.json`, exact pins:**
  - `@tauri-apps/api 2.12.4`, `@tauri-apps/plugin-http 2.8.3`, `@tauri-apps/plugin-fs 2.7.1`,
    `@tauri-apps/plugin-opener 2.7.2`, `@tauri-apps/cli 2.12.3`. *As built:* all five are `devDependencies`, like the
    other build-time packages: Vite bundles them into the webview.
  - scripts `"tauri": "tauri"` and `"build:desktop": "node scripts/release/build-desktop.mjs"`
  - never install the `next` tag (3.0 alphas)
- **Lockfile:** regenerate from a clean `node_modules`, so that both `@tauri-apps/cli-linux-x64-gnu` and
  `@tauri-apps/cli-win32-x64-msvc` are in `package-lock.json`.
- **`rust-toolchain.toml`:** `channel = "1.99.0"` (current stable, and at least the MSRV 1.90), `profile = "minimal"`.
  Bump it only in a `chore(deps)` commit.
- **`src-tauri/Cargo.toml`:**
  - `edition = "2024"`, `rust-version = "1.90"`, `publish = false`
  - library `crate-type = ["staticlib", "cdylib", "rlib"]`, which Android needs later
  - `tauri ~2.12.4`, `tauri-build ~2.7.3`, `tauri-plugin-fs ~2.7.1`, `tauri-plugin-opener ~2.7.2`
  - `tauri-plugin-http = { version = "~2.8.3", default-features = false, features = ["rustls-tls-native-roots", "http2", "charset", "system-proxy", "gzip"] }`:
    no cookie jar, the OS trust store (so servers behind an internal CA work), and gzip. Each feature exists in the
    crate's `[features]`.
  - `[features] devtools = ["tauri/devtools"]`
  - commit `Cargo.lock`
- **`src-tauri/src/lib.rs`** is the only Rust:
  - a `Builder` with the http, fs and opener plugins
  - in `setup`: when `GEMIREDMINE_DATA_DIR` is set, `app.fs_scope().allow_directory(dir, true)`
  - one command, `app_environment() -> { dataDirOverride, tauri: tauri::VERSION, webview: tauri::webview_version(), os, arch }`
  - `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`
  - `main.rs` uses `windows_subsystem = "windows"` in release builds; plus `build.rs` and a `.gitignore`
    (`/target/`, `/gen/schemas`)
- **`src-tauri/tauri.conf.json`** is the base config, set up as the dev channel:
  - `productName`, `mainBinaryName: "Gemiredmine-Dev"`, `identifier: "com.gemiredmine.app.dev"`, `version: "../package.json"`
  - `build.frontendDist: "../views/mainview"`, `devUrl: "http://localhost:5173"`, `beforeDevCommand: "npm run dev"`,
    `beforeBuildCommand: "npm run build"` (its `prebuild` writes the build info for the current `CHANNEL`)
  - one window `main`, 1024x768
  - `bundle.active: false`, `bundle.icon: ["../assets/icons/dev.png", "../assets/icons/dev.ico"]`
  - `app.security.capabilities: ["main", "dev-preview-dev"]`
  - **a content security policy from the start:**
    `"csp": "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'"`,
    with `devCsp: null` so Vite's hot reload keeps working. Whether Svelte or Tailwind output needs more sources is
    not yet known.
- **`src-tauri/capabilities/main.json`**, used by every channel:
  - `core:default`
  - `{"identifier": "http:default", "allow": [{"url": "http://*:*"}, {"url": "https://*:*"}]}`. A URL pattern with a
    host but no port gets an *empty* port, so `http://*` alone would refuse a Redmine on a custom port. *Verified in PR 2:*
    the mock on port 18123 signs in.
  - `{"identifier": "opener:allow-open-url", "allow": [{"url": "http://*"}, {"url": "https://*"}]}`. The user's own
    server is linked from `UserMenu.svelte`. The "issues/new only" rule stays in TypeScript. *Correction found in PR 2:*
    the opener's scope is a glob (`glob::Pattern`), not a URL pattern like the HTTP plugin's, so `*` already covers any
    port, path and query. Verified: a server link with a port and the prefilled issue link both opened.
- **`src-tauri/capabilities/dev-preview-{canary,unstable,dev}.json`**, one file per channel so channels stay isolated:
  - `fs:allow-exists`, `-stat`, `-mkdir`, `-read-file`, `-write-file`, `-read-dir`, `-rename`, `-remove`
  - `fs:scope` limited to `$LOCALDATA/<that channel's dataDirName>` and `/**`. Use explicit names, not globs, so Tauri
    resolves the real path.
  - stable gets no file permissions at all
  - no `*-text-file` permission: Tauri 3 removes them
- **`scripts/release/tauri-config.mjs`** (pure): `tauriChannelConfig(info)` returns the JSON Merge Patch overlay for
  `tauri build --config`:
  - `productName`, `mainBinaryName: info.appName`, `version`, `identifier`
  - the full `windows[0]` object with its `title` (arrays are replaced whole)
  - `security.capabilities: devPreviewAvailable ? ['main', 'dev-preview-' + channel] : ['main']`
  - per-channel `bundle.icon`
  - never `csp`, never `null` (it would delete a key)
- **`scripts/release/build-desktop.mjs`** replaces `build-electrobun.mjs`: derive `info` the way `electrobun.config.ts`
  does, write `build/tauri.<channel>.conf.json`, then
  `execFileSync(process.execPath, [<cli bin>, 'build', '--no-bundle', '--config', overlay, ...(devPreviewAvailable ? ['--features', 'devtools'] : []), '--', '--locked'])`.
- `tsconfig.json` excludes `src-tauri`; `vitest.config.ts` excludes `src-tauri/**`.
- **Tests:**
  - `tauri-config.test.ts`: identity, version, binary name, window and icons for every channel; capabilities; no
    `null` and no `csp` in the overlay; a non-null base CSP containing `default-src 'self'`; the base config equals
    the dev overlay.
  - `tauri-setup.test.ts`: the http and opener allow lists are exact; file permissions appear only in the
    `dev-preview-<channel>` files, each listing exactly `CHANNELS[channel].dataDirName`; no `text-file` permission;
    npm and `Cargo.lock` agree on major.minor; both CLI platform packages are in the lockfile; stable never gets
    `devtools`; `build-desktop` passes `-- --locked`.

### Commit 2: `feat(mainview): run the backend in the webview through Tauri plugins`

- **`src/mainview/lib/tauri-platform.ts`** builds a `BackendPlatform` (see `src/bun/backend.ts`):
  - `fetch`: `(url, init) => rustFetch(url, { ...init, maxRedirections: 0, connectTimeout: 10_000 })`. reqwest would
    forward `X-Redmine-API-Key` to a new host on a redirect, so redirects are not followed; the client reports them
    as `RedmineMovedError`.
  - `fs`: a `DataFs` on the file plugin: `writeFile(..., { append, mode: 0o600 })`, `mkdir({ recursive: true, mode: 0o700 })`,
    `readDir`, `rename`, `remove`, `stat`.
  - `dataDir()`: `dataDirOverride ?? join(await localDataDir(), buildInfo.dataDirName)`. The same folder as today on
    Linux and Windows.
  - `environment()`: maps `x86_64` to `x64` and `windows` to `win32`, and the runtime to
    `tauri X (WebKitGTK|WebView2 Y)`.
- **`src/mainview/lib/bridge.ts` and `api.ts`:** if `isTauri()` is false, throw today's message ("The desktop backend
  is not available in this environment."), so Capacitor behaves as before. Otherwise build
  `createBackend(tauriPlatform())` lazily. In PR 2, `canDetachViews()` returns false on Tauri and the window requests
  and messages that `bridge.ts` also carries are not wired; PR 2b does that (see "Window layer"). Keep the window
  tests (`view-windows.spec.ts`, `windows.test.ts`) green: they do not depend on Electrobun.
- **`vite.config.ts`:** `clearScreen: false`, `server: { port: 5173, strictPort: true }`; reword the `views://` comment.
- **Tests:**
  - `tauri-platform.test.ts` with `vi.mock` of the `@tauri-apps/*` modules: the fetch options, the DataFs contract
    (`src/bun/diagnostics/__tests__/data-fs.contract.ts`) against an in-memory fake of the plugin, `dataDir` with
    and without the override (this replaces `paths.spec.ts`), and the environment mapping.
  - `api.test.ts`: the `isTauri` guard and the routing.

### Commit 3: `build(release): package the Tauri executable`

- **`scripts/release/build-output.mjs`:** `findAppBinary(root, appName, platform, env)` returns
  `<CARGO_TARGET_DIR or src-tauri/target>/release/<appName>[.exe]`. Pass the injected `env` at the call sites.
- **`linux-metadata.mjs` `appRunScript(binPath)`:** `HERE=...`, then `exec "$HERE/usr/bin/<App>" "$@"`. No `cd`.
  *As first built it also exported `GDK_BACKEND="${GDK_BACKEND:-x11}"`, for parity with Electrobun 1.18.1, which forces
  X11. Removed 2026-10-15 (Wayland first): GTK now picks the session's display server.*
- **`package-linux.mjs`:** `findAppBinary(..., 'linux', env)`; copy the binary to `usr/bin/<App>` with mode 0755
  instead of `cp -a` into `usr/lib`; add an injectable `appimagetool` path (like `makeappx` in `package-windows.mjs`).
  Unchanged: the pinned, checksum-verified appimagetool, the `-u` update information, zsyncmake, checksums and `release.json`.
- **`package-windows.mjs`:** delete `ensureLauncher`, including its `node_modules/electrobun` fallback;
  `findAppBinary(..., 'windows', env)`; copy `<App>.exe` into `payload/`; `Executable="<App>.exe"`. The rest is
  unchanged. An MSVC build links the VC runtime and the WebView2 loader statically.
- **Tests:** rewrite `build-output.test.ts`; update `linux-metadata.test.ts`, the fixture and expectations in
  `package-windows.test.ts` (and delete the `ensureLauncher` tests) and `windows-metadata.test.ts`; add
  `package-linux.test.ts` with a fake appimagetool that snapshots the AppDir. In PR 0's golden snapshot only the
  `Executable=` attribute may change.

### Commit 4: `ci: build the desktop app with Tauri`

- **`build-linux.yml`:**
  - `runs-on: ubuntu-22.04`, which sets the glibc floor.
  - `apt-get install libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev zsync xvfb`.
  - `rustup toolchain install 1.99.0 --profile minimal` (the version in `rust-toolchain.toml`).
  - *As built:* `actions/cache@v6` on the cargo registry and `src-tauri/target`, one cache per channel (the channels
    build different feature sets). The plan said `Swatinem/rust-cache` pinned to a commit SHA, but a third-party SHA
    could not be looked up from the sandbox, and a first-party action needs no pin. Switch if cache size becomes a problem.
  - `npm run build:desktop`, then a check of the runtime libraries and the glibc floor. *As built:*
    `scripts/release/check-linux-binary.mjs` (unit tested) instead of inline `grep`: it fails on `not found`, on an
    AppIndicator library, and on a GLIBC symbol newer than 2.35.
  - The existing package step, then a smoke test: `timeout 20 xvfb-run -a <AppImage> --appimage-extract-and-run`
    must still be running after 20 s.
- **`build-windows.yml`:** the same `rustup` and cache steps, then `npm run build:desktop`; `dumpbin /DEPENDENTS`
  (through `scripts/release/check-windows-binary.mjs`) must show no `VCRUNTIME*.dll` and no `WebView2Loader.dll`.
  Tauri's `build.windows.staticVCRuntime` defaults to true, so no `.cargo/config.toml` is needed; launch the exe with
  `GEMIREDMINE_DATA_DIR=$RUNNER_TEMP\smoke` and require it to be alive after 20 s. Keep `windows-latest` and `TARGET_PLATFORM`.
- **Unchanged:** `unstable.yml`, `canary.yml`, `stable.yml`, `weekly-tests.yml`, `publish.mjs`. Record clean and cached
  build times against the 60 and 75 minute timeouts.
- `tauri-setup.test.ts` gains, in this commit and not earlier: the workflow's `rustup` version equals
  `rust-toolchain.toml`, and no `run:` line starts with `! `.

### Commit 5: `chore: remove Electrobun`

- Delete `src/bun/index.ts`, `src/bun/rpc.ts`, `src/bun/paths.ts`, `src/bun/__tests__/paths.spec.ts`,
  `src/shared/rpc.ts`, `electrobun.config.ts`, `scripts/release/build-electrobun.mjs`, `src/types/shims.d.ts` and `bun.lock`.
- Remove the `build:electrobun` and `prebuild:electrobun` scripts.
- Run `npm uninstall electrobun` from a clean `node_modules` and commit `package-lock.json` (this also drops `@types/bun`).
- Move `src/bun/node-data-fs.ts` into `src/bun/diagnostics/__tests__/support/`.
- Reword `scripts/release/channels.mjs:6` and `scripts/release/write-build-info.mjs`.
- `grep -ri electrobun --exclude-dir=node_modules .` must find nothing outside history.

### Commit 6: `docs: describe the Tauri desktop shell`

- **README:** the mentions at lines 7 and 35; the architecture section; the development setup (rustup through
  `rust-toolchain.toml`, the apt list, the Visual Studio C++ build tools, `npm run tauri dev`, `build:desktop`).
- **RELEASE_POLICY:** the Dependencies paragraph (Tauri 2.12.x; the npm packages and crates move together in one
  `chore(deps)` commit and stay on matching major.minor; Tauri 3 is a separate decision); the Linux host requirements
  (GTK 3, WebKitGTK 4.1 at least 2.40; Wayland or X11, no XWayland needed; AppIndicator is no longer needed); the data-folder paragraph (webview
  storage lives under `<LocalData>/<identifier>`); the "not covered yet" list once gate G5 has run.
- **CONTRIBUTING:** a "Desktop shell" section: capabilities need review, Rust stays wiring, channel identity comes
  only from `tauri-config.mjs`.
- **`PLAN.md:8`, `ROADMAP.md:4`:** "Electrobun" becomes "Tauri 2".
- **This folder:** update `progress.md`, and move this plan's finished parts into a short history.

### Merge gates

All run on the PR branch. Workflow-dispatch runs publish nothing.

| Gate | Check |
|---|---|
| G1 | `npm test && npm run typecheck`, with `CHANNEL` unset and with `CHANNEL=stable` |
| G2 | Dispatch the Linux build (unstable): build, ldd and glibc check, packaging and the xvfb smoke test are green |
| G3 | Dispatch the Windows build (unstable, self-signed): the `cli-win32-x64-msvc` package installs, the `dumpbin` and launch smoke checks pass, the MSIX is signed |
| G4 | The Linux checklist below on Ubuntu 22.04 (updated) and 24.04 **on Wayland (GNOME, and one NVIDIA machine; KDE if available)**, including the window layer: drag a tab out, drag the new window's tab back onto the main window's tabs, **Move to main window**; launch and sign-in on Debian 12 and Fedora. X11 is not a target and needs no run. |
| G5 | Windows 11, on a **clean VM** or with the published unstable uninstalled first: install the Electrobun build, enable the preview, upgrade in place to the Tauri build, run the checklist, record where the preview files really land under MSIX, and check that there is no console window. Repeat the upgrade through the real `.appinstaller` feed on the first unstable build after merge. |
| G6 | Data continuity: a folder from the Electrobun era (preview on, rotated logs, ten or more reports) is read by the Tauri build; `logBytes` matches and rotation continues |

### Manual checklist

Run it against `node scripts/dev/mock-redmine.mjs`, and once against a real Redmine.

1. The title, a 1024x768 window and the channel icon. `xprop WM_CLASS` should match `StartupWMClass=<appName>`.
2. Sign in at `http://<LAN-IP>:8123`. This proves the `*:*` scope, plain http, Basic auth then the API key, paging, and
   `crypto.randomUUID` in the Tauri origin.
3. Add a server with an API key. A wrong password shows the right message.
4. HTTPS: a public CA works, a private CA trusted by the OS works, a self-signed certificate gives a certificate error
   and not "url not allowed".
5. `/moved` and `/slow` show their messages. An unreachable host fails in about 10 s.
6. All four `target="_blank"` links open the system browser (the opener plugin's init script handles them).
7. Developer preview: the files are under `<LocalData>/gemiredmine-<channel>` with modes 0700 and 0600; the setting
   survives a restart; a link that is not the issue page is refused; devtools open.
8. `GEMIREDMINE_DATA_DIR=/tmp/x` is honoured.
9. A stable build has no preview panel and no devtools. Canary and unstable run side by side.
10. The content security policy blocks nothing: no violations in the console.

**After merge:** soak five or more unstable builds (or one week), then one canary `x.y.z-rc.N` that testers reach
from the Electrobun canary, then stable. Do not run Stable from a Tauri `main` before the canary has soaked.

## Risk register

| Risk | Mitigation | Fallback |
|---|---|---|
| The `*:*` URL-pattern scope. *Verified on Linux in PR 2* (custom port); not yet on Windows | Checklist 2 and 4 (G5) | Add origins at run time from Rust when a server is added |
| MSIX file virtualization against the file plugin's real-path scope check | G5 records the real path | Canonicalize in Rust, then `allow_directory` |
| A hand-made AppImage around the raw binary is not a layout Tauri documents | xvfb smoke test, distro matrix | `WEBKIT_DISABLE_DMABUF_RENDERER=1` in AppRun |
| WebKitGTK at least 2.40, and the glibc floor | `ubuntu-22.04` runner, CI glibc check, policy text | A container base image when that runner retires |
| Wayland and NVIDIA rendering (WebKitGTK can show a blank window with the proprietary driver), `app_id` against the desktop entry | Native Wayland is the default; a headless-compositor smoke test in CI; G4 on one NVIDIA machine | `WEBKIT_DISABLE_DMABUF_RENDERER=1` in AppRun (not added: unverified); adjust `desktopEntry`, or `enableGTKAppId` |
| `tauri.localhost` as a secure context (`randomUUID`) on Windows | Checklist 2 on Windows | `useHttpsScheme: true` on the window |
| A larger webview attack surface (http to any host) | CSP in PR 2, no `{@html}` or `innerHTML` today, TypeScript guards, a per-channel file scope | none |
| Rust build time against the job timeouts | A per-channel cache; record the times (locally: 4m23s for a cold release build of the crate and its dependencies, 1m42s for one more channel; on the runners, cold: 7m32s on Linux and 12m01s on Windows) | Raise the timeout |
| Dragging a view window by its title bar needs global pointer position and button state (no mouse-button API in Tauri; unavailable on native Wayland) | A small Rust command where positions exist; **on Wayland the tab is dragged instead (drag and drop between windows, no positions)**; G4 | The "Move to main window" button always works. *PR 2b: built; the tab drop, detach, header drag and the button were verified on a Wayland compositor (sway); the title-bar drop on X11 with metacity; Windows and GNOME/KDE not run* |
| Several windows each own a backend, so several developer previews | One owner for the preview, in the main window | Move the preview to Rust |
| Tauri 3 | Exact pins, no `text-file` permissions | A planned migration |

## Rollback

- **PR 0 and PR 1:** `git revert`. The data formats are byte-identical.
- **PR 2 after merge:** revert the merge commit. Unstable then rebuilds on Electrobun with higher version numbers, so
  App Installer and the AppImage `.zsync` move users forward. The data folders are the same in both directions. Every
  rollback build needs a higher version than the one it replaces: unstable run numbers grow, canary goes to `rc.N+1`,
  stable goes to `x.y.(z+1)`.

## Next phase (outline): Android on Tauri, retiring Capacitor

1. `tauri android init` generates `src-tauri/gen/android`. `lib.rs` already has `mobile_entry_point`. The webview
   backend runs unchanged, so the app can reach Redmine on Android for the first time.
2. Choose the identity model: one Android identifier, or a per-channel `init` in CI with a tested patch script.
   `capacitor.config.ts` uses `com.gemiredmine.app` and was never distributed.
3. Add `'android'` to `PLATFORMS` (`channels.mjs`), `BuildInfo.platform` and `AboutView.svelte`. Add an
   `androidVersionCode()` that is monotonic across rc and unstable builds, and pass `bundle.android.versionCode` in the overlay.
4. Network: a `network_security_config.xml` that permits cleartext traffic (users' servers are arbitrary). Spike TLS
   roots on Android: the native roots may be empty, so use target-specific webpki roots or a platform verifier.
5. Report "Android System WebView" in `toEnvironment`. Run `tauri icon assets/icons/<channel>.png` per channel. Add the
   Rust Android targets to the toolchain.
6. A new `build-android.yml`: Temurin JDK, the Android SDK and NDK, `rustup target add aarch64-linux-android`,
   `tauri android build --apk --config <overlay>`, keystore secrets handled like the Windows PFX secrets, and
   `publish.mjs` support.
7. Keep `canDetachViews()` false on Android (no windows there).
8. Retire Capacitor: delete `android/`, `capacitor.config.ts` and the `@capacitor/*` packages; update README and
   RELEASE_POLICY. Do the optional `src/bun` to `src/core` rename here.

## Verifying PR 2

- Every PR: `npm test && npm run typecheck && npm run build`, on pre-commit and in CI.
- PR 2 as well: `cargo test --manifest-path src-tauri/Cargo.toml --lib`; `npm run tauri dev` against the mock
  server; `CHANNEL=<channel> npm run build:desktop`, then `node scripts/release/package-linux.mjs` (or
  `package-windows.mjs`); gates G1 to G6 written into the PR description, with the SHA of the last Electrobun commit.
