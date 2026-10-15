# Tauri 2 migration: progress

**Start here.** This file says what is done, what is next, and how to check it. The reasoning and the full
specification of the remaining work are in [`plan.md`](./plan.md).

*Last updated 2026-10-15, after one instance of the app, remembering the sign-in, and the task and log entry views on `claude/sharp-pascal-qbz3f6`. PR 0 and PR 1 are merged (`648fe5b`), and so are pull requests #21, #22 and #23 (PR 2, PR 2b), as `main` shows (`3baf9a8`); the rows below for them were written before that.*

**Keep this file current.** Whoever does a step updates this file in the same pull request: the status table, the
commit SHAs, anything that went differently from the plan, and what you learned about the environment. Put a decision
that changes in `plan.md`, with the reason.

## Status

| Step | State | Commits | Notes |
|---|---|---|---|
| PR 0: safety net | **done** | `de4a781` `61c9456` `20d1c9e` `32f90df` | Golden tests, mock Redmine, a PR check workflow |
| PR 1: runtime-neutral backend | **done** | `d3cb9bd` `73539b7` `7422bf2` `9a93f87` | Still ships on Electrobun; no change for users except the timeout message |
| Merge of `main` | **done** | `7340021` | `main` gained `e9f36d1` (view tabs in their own windows) while the PR was open; see "Merge with main" |
| PR 2: Tauri shell | **implemented, draft** | `27f8129` `d4be6ac` `7b7e677` `2681143` `63ee18b` and a docs commit | Branch `claude/tauri-2-shell`, pull request #21. One window only. CI gates G1 to G3 passed on the first run. Open: the hardware gates G4 to G6. SHAs are as first pushed |
| PR 2b: window layer on Tauri, and native Wayland | **implemented, draft** | `49df48e` `e1cd3f9` `30ebcf9` `c4eceaa` `4af9cbf` `773f908` `47278ab` `5300d47` and a docs commit | Pull request #22, branch `claude/tauri-window-layer`, stacked on `claude/tauri-2-shell`. Verified on a Wayland compositor (sway, headless) and, for the title-bar drop, on X11 with metacity. Open: GNOME and KDE, an NVIDIA machine, Windows, mixed-DPI monitors. See "PR 2b" below |
| Storage: the app's database, saved servers, certificate asset | **implemented** | `c8d26d9` `3b13a86` `061f2b2` `0fd5a93` and a docs commit | Branch `claude/sharp-pascal-qbz3f6`, from `main` at `3baf9a8`. After the owner's test of Windows unstable build 10. See "Storage" below |
| One instance, remember me, task and log entry views | **implemented** | `7792380` `57b6b66` `f0b593e` `6d676c4` and a docs commit | Same branch, after the owner's request of 2026-10-15. See "Single instance, remembering the sign-in, task and log entry views" below |
| PR 3: end-to-end tests, rename `src/bun` to `src/core` | optional | | Best at the start of the Android phase |
| Android on Tauri, retire Capacitor | not started | | Outline in `plan.md` |

PR 0 and PR 1 were one pull request on `claude/elegant-fermi-u669ds` (pull request #20, merged as `648fe5b`). Test suite: 35 files and 233
tests before, 44 files and 356 tests (one skipped) after PR 1 alone, and 47 files and 426 tests after the merge of
`main`, which brought its own window tests.

## What was built

### PR 0: safety net, no behaviour change

- `scripts/release/__tests__/release-identity.golden.test.ts` and its snapshot pin, for every channel, the build info,
  release tags, AppImage names, update information, desktop entry, MSIX version, manifest, App Installer file and feed
  URLs. **In PR 2 only the `Executable=` line of the manifest may change in this snapshot.**
- `src/bun/diagnostics/__tests__/data-dir.golden.spec.ts` and its snapshot pin the developer preview's data folder:
  layout, file contents, the exact text of `settings.json`, and the modes 0700 and 0600 (skipped on Windows).
- `scripts/dev/mock-redmine.mjs` is a dependency-free stand-in for a Redmine server; see "Recipes" below.
  `scripts/dev/__tests__/mock-redmine.test.ts` runs the real client and sign-in against it over HTTP.
- `.github/workflows/checks.yml` runs the tests, the type check and the webview build on every pull request.

### PR 1: a backend that runs anywhere

*Paths here are as of PR 1. PR 2 removed `src/bun/rpc.ts` and `paths.ts`, and moved `node-data-fs.ts` to `src/bun/diagnostics/__tests__/support/`.*

The backend (`src/bun/`) no longer uses `node:` imports, `Buffer` or `process` in the files that must stay portable, so
PR 2 can run it inside the Tauri webview and the Android phase can reuse it.

- `src/shared/backend.ts`: `GemiBackend`, the interface the user interface calls. `redmineApi` is typed against it.
- `src/bun/backend.ts`: `createBackend(platform, options)` implements it. A `BackendPlatform` supplies everything
  platform specific: `fetch`, a `DataFs`, `dataDir()`, `openUrl()` and `environment()`.
- `src/bun/rpc.ts` is now a thin Electrobun adapter that supplies Bun's `fetch`, `nodeDataFs`, `dataDirFor` and
  `Utils.openExternal`, and maps each RPC request to a backend call.
- `src/bun/diagnostics/fs.ts`: `DataFs`, the async file interface. `src/bun/node-data-fs.ts` implements it on
  `node:fs/promises`. `DiagnosticsStore` and `DevPreview` use it; `DevPreview.open()` replaces the constructor.
- `src/bun/redmine/client.ts`: an injectable `fetch` and abort signal; `RedmineMovedError` for redirects; failed
  responses release their body.
- `src/bun/timeout.ts`: `withTimeout`.
- `src/bun/__tests__/webview-safe.spec.ts` fails when `node:` imports, `Buffer`, `process` or `Bun` appear in
  `backend.ts`, `timeout.ts`, `redmine/` or `diagnostics/`. Code that needs them belongs next to `rpc.ts`.
- `src/bun/diagnostics/__tests__/data-fs.contract.ts` is a test suite any `DataFs` must pass. It runs for `nodeDataFs`
  and for an in-memory fake. **PR 2's file-plugin adapter must run it too.**

**Behaviour changes users can see**
- A Redmine call that gets no answer fails after 30 s with "The Redmine server did not answer within 30 seconds."
  and aborts the request. The webview's RPC limit is 35 s, so this message arrives first.
- A failed write on the developer preview's flush timer no longer escapes as an uncaught error.

### Where it differs from the first plan

- The mock Redmine gained a `/sso` prefix (a redirect to a login page that is not the server), so the "gateway"
  message is tested.
- `RedmineMovedError` is thrown only for 301, 302, 303, 307 and 308. Other 3xx answers stay plain `RedmineApiError`.
  `RedmineApiError` got an optional third `message` parameter for this.
- The serial queue is `src/bun/diagnostics/serial.ts` (inside `diagnostics/`, so the portability test scans it). Turning
  the preview on and off is queued with it as well, so the saved setting always matches the last request.
- An in-memory `DataFs` (`diagnostics/__tests__/support/memory-data-fs.ts`) and the contract suite were added so the
  Tauri adapter can be tested without a real webview.
- The 35 s RPC limit moved from the contract commit to the commit that applies the 30 s timeout.
- `CHANNEL=stable npm run typecheck` now passes. It failed before because `rpc.ts` used the build stub as a type;
  `backend.ts` uses `import type`.
- `CONTRIBUTING.md` got a short "The backend" section.

### Merge with main

While the pull request was open, `main` gained `e9f36d1`, "drag view tabs to reorder them or into windows of their own".
It changed the same three files as PR 1 (`src/bun/rpc.ts`, `src/shared/rpc.ts`, `src/mainview/lib/api.ts`), so `main`
was merged into the branch (`7340021`) and the conflicts were resolved by combining the two changes:

- `src/bun/rpc.ts`: `createRpc(windowRequests)` (one RPC per window, from `main`) is built on the single shared
  `createBackend` adapter, so every window uses the same developer preview and files.
- `src/shared/rpc.ts`: `main`'s window requests and messages stay; the request and response types come from `./backend`.
- `src/mainview/lib/api.ts` and `bridge.ts`: `redmineApi` is typed as `GemiBackend`; the 35 s request limit is applied
  in `bridge.ts`, where `main` moved the Electroview.

**This changes PR 2.** The window layer is more Electrobun-specific behaviour than the plan had counted (a second host
API, a message channel in both directions, global pointer access). `plan.md` has a "Window layer" section with what
carries over and what has to be built.

### PR 2: the Tauri shell (six commits)

1. `build(tauri): add the Tauri 2 shell`: `src-tauri/` (the crate, `tauri.conf.json` as the dev channel, one `main`
   capability and one `dev-preview-<channel>` capability per channel), `rust-toolchain.toml` (1.99.0), exact npm pins,
   `scripts/release/tauri-config.mjs` (the per-channel overlay) and `build-desktop.mjs` (`npm run build:desktop`).
   `tauri-config.test.ts` and `tauri-setup.test.ts` pin the identity, the capabilities and the version agreement.
2. `feat(mainview): run the backend in the webview through Tauri plugins`: `src/mainview/lib/tauri-platform.ts` (fetch,
   `DataFs` on the file plugin, data folder, environment), `bridge.ts` creates the backend, `api.ts` is a delegate.
   `hasWindowLayer()` was false in PR 2, so `canDetachViews()` was false. The `DataFs` contract suite runs against the adapter.
3. `build(release): package the Tauri executable`: `findAppBinary`, `AppRun` (`GDK_BACKEND` defaulted to x11; removed in PR 2b), the
   AppImage from `usr/bin/<app>`, the MSIX from `<app>.exe`. In the identity snapshot only `Executable=` changed.
4. `ci: build the desktop app with Tauri`: both build workflows, `check-linux-binary.mjs`, `check-windows-binary.mjs`,
   smoke tests, a Rust job in `checks.yml`.
5. `chore: remove Electrobun`: the Bun entry point and RPC adapter, config, scripts, `bun.lock`, `paths.ts`, the
   package. The window types moved to `src/shared/window-contract.ts`; `ViewWindows` and its tests stay.
6. `docs: describe the Tauri desktop shell`.

**Where PR 2 differs from the plan**
- Versions are one patch above the plan's: `@tauri-apps/cli 2.12.3`, `api 2.12.4`, `plugin-http 2.8.3`, `plugin-fs 2.7.1`,
  `plugin-opener 2.7.2`; crates `tauri 2.12.4`, `tauri-build 2.7.3`. All five npm packages are `devDependencies`.
- **The opener's scope is a glob, not a URL pattern** (the plan assumed the HTTP plugin's rules). `http://*` and
  `https://*` already cover ports, paths and queries. The HTTP plugin still needs `http://*:*` and `https://*:*`.
- CI caches with first-party `actions/cache@v6`, one cache per channel, not a SHA-pinned `Swatinem/rust-cache`: a
  third-party commit SHA could not be looked up from the sandbox.
- The glibc, library and Windows DLL checks are scripts with unit tests (`check-linux-binary.mjs`,
  `check-windows-binary.mjs`) instead of inline `grep` and `dumpbin` in the YAML.
- `checks.yml` gained a `rust` job (rustfmt, clippy, `cargo test --lib`) that the plan did not list.
- The Windows smoke test only requires the process to be alive after 20 s. A window-title check was left out, because
  a runner's desktop session may not report it.
- `tauriFetch` turns the plugin's string rejections into `Error`s, as `fetch` does.
- Tauri's `build.windows.staticVCRuntime` defaults to true, so no `.cargo/config.toml` with `+crt-static` is needed. The
  Windows check proves it on CI; it has not run yet.
- `bridge.ts` now has `hasDesktopBackend()` (the backend exists) and `hasWindowLayer()` (false until PR 2b). `windows.ts`
  and `ViewTabs` use the second. *PR 2b made it true in the main window and in view windows.*
- The two `electrobun-webkit-app-region-*` CSS classes in `App.svelte` and `ViewTabs.svelte` remain. They mark the drag
  region of a view window, which does not exist yet; PR 2b replaced them (`data-tauri-drag-region` on the header of a
  view window, and nothing on the button, which a drag region does not capture).
- **A mistake caught late:** the `tauri` and `build:desktop` scripts were missing from `package.json` until the CI commit
  was written, so the new workflows would have failed. They were folded into commit 1, and `tauri-setup.test.ts` now
  fails when a workflow runs an npm script that `package.json` does not define.

### PR 2b: the window layer on Tauri (stacked on PR 2)

Commits, in order: `49df48e` docs (the owner's answer), `e1cd3f9` `feat(shell): report whether the primary mouse button is
down`, `30ebcf9` `refactor(backend): let a second window use the preview that another window owns`, `c4eceaa`
`fix(windows): compare shared sessions regardless of key order`, `4af9cbf` `feat(mainview): open tabs in their own windows
on Tauri`, and a docs commit. A tab can be dragged out of the main window into a view window, and dragged back by that
window's title bar, as it could on Electrobun.

- **`ViewWindows` is unchanged.** `src/bun/windows/view-windows.ts` runs in the main window's webview. It needs a
  synchronous host, and Tauri answers asynchronously, so `src/mainview/lib/tauri-windows.ts` (`TauriHost`) keeps the latest
  answers (window frames, minimized state, scale factor, the pointer, the work areas) and refreshes them before they are
  needed: when a view is detached, when the tab strip is reported, and on each step of a drag.
  All coordinates are CSS pixels (Tauri's physical pixels divided by the main window's scale factor).
- **Messages between windows** are Tauri events (`src/mainview/lib/window-transport.ts`): a request and response layer
  with correlation ids for the window requests of `src/shared/window-contract.ts`, plus the messages to a window.
  `window-layer.ts` starts the layer in the main window and gives a view window its stand-ins. `bridge.ts` chooses.
- **The developer preview has one owner, the main window.** `createBackend` takes a `preview` option, a `PreviewPort`
  (`status`, `setEnabled`, `record`, `createFeedback`). A view window's backend gets a port that sends each call to the
  main window (`PreviewRequests`), so there is one aggregation and one set of rotated files. Each window has its own
  `createBackend` and HTTP client otherwise.
- **A Rust command, `primary_button_down`** (`src-tauri/src/pointer.rs`), reads the primary mouse button, which no Tauri API
  does: on Linux through GDK (meaningful on X11 only), on Windows `GetAsyncKeyState` with the swapped-buttons setting. It is the only logic
  in the crate besides wiring. `lib.rs` also ends the app when the main window is destroyed.
- **Capabilities are split by what a window needs:** `backend.json` (windows `main` and `view-*`: `core:default`, http,
  opener), `main.json` (create a window, focus, unminimize, close) and `view-window.json` (start dragging). The preview
  folder permissions stay in `dev-preview-<channel>.json` for the main window only. `tauri-config.mjs` lists
  `backend`, `main`, `view-window`, plus `dev-preview-<channel>` where the preview exists.
- `stableJson` (`src/shared/windows.ts`) compares sessions without looking at key order (see the next list).
- `webview-safe.spec.ts` also scans `view-windows.ts`; tests for the host, the transport and the capability files were added.

**Findings that cost time, and that the next person should know**
- **A listener without a target hears every event in its webview**, whatever label the sender used with `emitTo`. Every listener
  in `window-transport.ts` passes `{ target: <its own label> }`. The test bus models this, and a mutation test shows
  that the suite fails without it.
- **Events re-serialise their payload with the keys of each object sorted.** Two windows that kept a session as JSON text and
  compared it with what they received saw their own copy as different and sent it back, forever: the Rust process reached
  2.9 GB. Found by disabling features one at a time. `stableJson` fixes it, with a regression test (a session that arrives
  with its keys reordered must not be sent back).
- **`Window.onCloseRequested` calls `destroy()` after the handler**, which needs `core:window:allow-destroy`. Without it
  the window never closes, and the X button and Alt+F4 do nothing. There is no handler now; the Rust `on_window_event` ends
  the app when the main window is destroyed.
- **Window events cross webviews.** `tauri://move` and `tauri://destroyed` reach a listener in another webview that names the
  window's label, which is how the main window follows its view windows.
- **Which window manager matters when testing the title-bar drop on X11.** openbox sends no move notifications while a window
  is dragged, so dropping a view window on the tab strip never fires (the button still works); xfwm4 needs xfconf;
  **metacity**, like GNOME's mutter, works. X11 is no longer a target (see "Wayland first").
- A click at the top edge of a window can hit the invisible resize border of another window's frame, which looked like
  "the main window will not close" in one test. Click lower in the title bar.

### Wayland first (added to PR 2b on 2026-10-15)

The owner's instruction: "For linux we need support wayland first, no x11 support expected." The first version of PR 2b needed
X11: it forced `GDK_BACKEND=x11` and followed a view window by the pointer and window positions on the screen, which
Wayland does not give an application. What was found by running the app on a Wayland compositor, and what changed:

| On native Wayland | Before | Now |
|---|---|---|
| The app starts, renders and signs in | works | works (nothing to change) |
| Drag a tab out of the strip: a view window opens | works | works; the compositor places the window (the app cannot), so it may open over the main window |
| Drag the new window by its header | did nothing | works: the drag attribute (`data-tauri-drag-region`) was on the header, which the tab strip fills, and Tauri applies it only to the element that carries it. It is on the strip now. The same should hold on X11 and Windows |
| Drop the window on the main window's tab strip by its title bar | does nothing: no screen positions, no move events | still does nothing, and cannot work. The window layer never sees the drag, so nothing attaches by mistake |
| **Drag the window's tab onto the main window's tab strip** | did not exist | **new**: a drag and drop between two windows of the app, which the system routes. The strip shows where the view would go; a drop closes the view window and puts the tab there |
| **Move to main window** | works | works |
| Closing the main window with a view window open ends the app | works | works |

What changed in the code: `AppRun` no longer sets `GDK_BACKEND`; the view window's tab carries the view id
(`application/x-gemiredmine-view`) and the main window's strip accepts only that type (ids of views that can have a window
only) and asks the window layer (`attachViewWindow`) to close that window and show the view at the dropped place; windows
are created with `dragDropEnabled` off, because Tauri's file-drop handling stops a drag between windows on Windows; and the
Linux build starts the packaged AppImage on a headless Wayland compositor (`scripts/release/smoke-test-wayland.sh`, weston, no
X server to fall back to). That script passes only when the app asks for a toplevel window itself (`xdg_toplevel.set_app_id`
in the `WAYLAND_DEBUG` log) and keeps running. The title-bar drop remains for X11 and Windows, where positions exist.
If one mechanism is preferred, the geometry path (`ViewWindows` polling, `pointer.rs`, the capabilities for it) can be
deleted later, because the tab drop needs none of it.

Notes for the next person:
- `dragover` fires on every pointer move over the strip on Wayland, with the coordinates of the target window (measured with a temporary on-screen counter).
- In the sandbox the drop indicator painted about a second after the pointer moved (software rendering); it does render.
- Native Wayland has no NVIDIA problem here (no GPU in the sandbox). WebKitGTK can show a blank window with the proprietary NVIDIA
  driver (reported for several WebKitGTK versions); `WEBKIT_DISABLE_DMABUF_RENDERER=1` is the workaround people use. It is **not** set, because it is unverified here. G4 decides.

### Storage: the app's database (2026-10-15, after the move)

The owner tested the Windows unstable build 10 and reported that **multiple windows work well**, and that the one problem was that
**nothing is kept for the next launch**. The history of the conversations with the language model will need a store too, so the owner
asked for a storage for the application now, for the configuration and for that later use.

**What was built**
- One SQLite database per channel, `gemiredmine.db`, in the channel's data folder (the folder the developer preview already uses:
  `$XDG_DATA_HOME/gemiredmine-<channel>`, `%LOCALAPPDATA%\gemiredmine-<channel>`, or `GEMIREDMINE_DATA_DIR`). Channels never share it.
- `src/bun/storage/` (portable; `webview-safe.spec.ts` scans it): `SqlDatabase` (`execute`, `select`), `migrations.ts` (a list of
  versioned steps), `app-storage.ts` (`AppStorage`: the servers, and a `settings` table for configuration as JSON).
  The conversation history will be new tables in a new migration. No tables for it exist yet, because its shape is not known.
- `GemiBackend.loadSavedServers` and `saveServers`. `src/mainview/lib/persistence.ts` loads the servers when the main window starts
  (the app shows "Loading…" until then, so a returning user does not see the welcome screen) and saves them when they change.
- Tauri: `tauri-plugin-sql` 2.5.0 with only the `sqlite` feature (bundled SQLite), `@tauri-apps/plugin-sql` 2.5.0, the `storage`
  capability (windows: `main` only; `sql:allow-load`, `-select`, `-execute`), and one Rust command, `prepare_storage_dir(name)`, that makes
  the channel's folder (0700) and returns its path. The plugin does not create folders, and a stable build has no file permissions.
- The certificate: the `.cer` of canary and unstable is now attached to the build's own release (`unstable-v*`, `canary-v*`) as well as to
  `unstable-latest` and `canary-latest`. It had been marked pointer-only, so only the latter had it, although the notes of the former named it.

**Decided without the owner (change them if you disagree)**
- **The API key was not saved, nor the password.** *(Superseded the same day: the owner asked for it, see the next section.)* What the database
  holds is the server's name and address, the order, which server is active, whether the user chose to be remembered, and who signed in last
  (id, login, names), so the sign-in form starts with the user name. `ROADMAP.md` says passwords are not stored by default and PLAN.md says
  connections are stored "securely"; a key in a plain file next to the database would not be secure, which is why the key goes in the system's
  credential store and never in the database.
- **Migrations live in TypeScript, not in the plugin.** The plugin's own migrations are keyed by the exact connection string, which here
  holds a path that depends on the channel and the user. Each step must be safe to run twice, and a test runs every step twice.
- **Only the main window has the permission.** The plugin takes any path from the webview, so the permission stays off the other windows. A
  view window gets its servers from the main window, as before. The LLM history will need a decision about who owns it.
- A database from a newer app is refused (`StorageTooNewError`) and left as it is; the app runs without saving and says so on the welcome
  screen and in Settings. When the saved servers cannot be read, nothing is saved in that run, so that the empty stores do not erase them.

**Findings that cost time, and that the next person should know**
- **The plugin binds every JS number as a 64-bit float** (`as_f64`), and a JS boolean as JSON text. Whole numbers must go in INTEGER columns
  (SQLite then stores them as integers), and flags as 0 and 1. `node:sqlite`, which the tests use, binds numbers as floats as well, so the tests see what the plugin does.
- **There is no transaction across calls**: the plugin works through a pool of up to 10 connections. A manual `BEGIN` that fails would leave a
  connection in a transaction, so none is used; every step is a single statement, and `AppStorage` runs its saves one at a time.
- sqlx does not create the folder around the file. sqlx reads `?` in a connection string as the start of options and decodes `%` escapes, so
  `sqliteUrl` escapes both; checked in the real app with a folder called `we?ird%20dir`.
- The database is in WAL mode (sqlx's default), so there are `-wal` and `-shm` files next to it, and a killed app loses nothing. The files are
  created 0644 by the plugin; the folder is 0700, which is what keeps them private on Linux.
- `Cargo.lock` gained 57 crates. It lists `sqlx-mysql`, `sqlx-postgres` and `rsa` too, which are **not compiled** (only `sqlite` is enabled),
  but a scanner of the lock file will see them. No existing crate changed version.
- The unstable binary grew from 12.5 MB to 15.4 MB. A cold `CHANNEL=unstable npm run build:desktop` took 5m18s here (a second channel 2m17s);
  `cargo test --lib` 2m34s cold.
- `check-linux-binary.mjs` fails in this sandbox (Ubuntu 24.04, glibc 2.39). That is the sandbox: CI builds on ubuntu-22.04.

**Checked in the real app** (Xvfb, unstable and stable builds, mock Redmine, a private `XDG_DATA_HOME`)
- First start: the folder is 0700, the database has `user_version` 1, both tables and WAL mode. The welcome screen shows.
- Adding a server with sign-in writes one row (user id as an integer) and the active server; **no API key or password is in the database,
  the WAL or anywhere else under the data folder** (grepped for the key and the password).
- After a `SIGKILL` and a start: the dashboard asks to sign in to the server, with `alice` already in the user name field. Signing in works.
  A second server, switching the active one, and removing a server are each written, and a clean restart brings back the same order and the active one.
- A database marked `user_version` 99: the welcome screen explains that the saved data is from a newer version; adding a server in that
  state leaves the database untouched (still 99, still the old server).
- A data folder named `we?ird%20dir` through `GEMIREDMINE_DATA_DIR`: created, used, and the right folder.
- The stable build (no file permissions, no developer preview) does all of this in `gemiredmine/`.
- Tests: 59 files, 663 tests (one skipped) with the default channel and with `CHANNEL=stable`; `tsc`, `cargo fmt --check`, `cargo clippy -D warnings`
  and `cargo test --lib` (8 tests) are clean. Mutations turned tests red: a failed save no longer forcing the next save (found a test that did not
  catch it; fixed), no comparison with the newest saved state, a load applied after stopping, the old pointer-only flag of the certificate.

**CI on `0fd5a93`** (dispatched on the branch, unstable channel, build only), both green: **Build Linux AppImage** (ubuntu-22.04, 9m35s: the
glibc and library check with the bundled SQLite, the X11 and the Wayland smoke tests) and **Build Windows package** (7m48s: SQLite compiles and links
under MSVC, the dependency check, the process still alive after 20 s, the MSIX built and signed). The smoke tests only prove that the app starts, so
they do not prove that the database works on Windows.

**Not verified**
- **The database on Windows.** Whether it opens and keeps the servers, whether it survives an MSIX in-place upgrade, and where the packaged
  app's `%LOCALAPPDATA%` writes go, have to be looked at on a Windows 11 machine. Please check, after installing the next unstable build, that
  the servers are there after closing and opening the app, and after the next update.
- *(Two copies of the same channel at once, which the last save won: solved by the single instance below.)*
- A view window never opens the database (it has no permission). The real app was not driven with a view window open after this change; the window code itself is unchanged.

### Single instance, remembering the sign-in, task and log entry views (2026-10-15)

The owner's request: "We should not allow to run multiple instances of main window. Optionally we should allow multiple servers at once context
then, which is currently out of scope. Add credentials management. So if user selected to remember him (checked by default at initial server login
screen). This choice has to be respected per server creds set on login. We need to store only the user token which need to be fetched in case of
username/pass login flow. Add task details view, and log entry view."

**Single instance**
- `tauri-plugin-single-instance` 2.5.4, registered first. A second start of the same channel brings the first copy's main window forward
  (unminimise, show, focus) and ends with exit code 0. The lock is the channel's identifier (a D-Bus name on Linux, a named mutex on Windows), so
  channels still run side by side. Without a D-Bus session the plugin lets the app start normally. Nothing else changed for view windows.
- **Multiple servers at once is not done** (the owner: out of scope). The tabs of a task and a log entry are bound to the server they were opened
  on, so this part does not stand in its way.

**Remember me, and the credential store**
- A **"Remember me on this computer"** box, checked by default, is on the form that adds the first server and any later one, and on the sign-in
  form of a server. The choice is kept per server (the `remember` column, migration 2) and is the starting value of that server's form next time.
  Settings has the same box for each server, which keeps or forgets the key at once.
- **Only the API key is kept**, in the system's credential store through `keyring-core` and one store crate per system: Windows Credential
  Manager (`windows-native-keyring-store`) and the Secret Service on Linux (`zbus-secret-service-keyring-store`, pure Rust, no library to install).
  Service name = the channel's identifier, user = `server:<server id>`, so channels and servers never share an entry. It is the key that signing in
  with a user name and password fetched, or the one typed into the form. **The password is never kept**, and the key is not in the database (grepped).
- Three Rust commands (`credential_save`, `credential_load`, `credential_delete`, `src-tauri/src/credentials.rs`), run on a thread of their own
  because a locked keyring waits for the user. They are open to every window, like the other commands, because every window already holds the keys in
  memory (sessions are shared); Tauri can restrict custom commands only by gating all of them, which would have bought nothing here.
- `src/mainview/lib/credentials.ts` follows the servers and keeps the store in line: the key is kept when a remembered server is signed in to, and
  forgotten on sign-out, when the choice is turned off, when the server is removed and when the server rejects it. A key read at the start signs the
  server in before the form would show ("Reading your saved sign-ins…").
- **A server that answers 401 to a key signs the user out of it**, with a notice at the sign-in form (`onUnauthorized` in the backend, `expireSignIn`):
  a key that was reset is not a dead end, and the dead key is removed from the store.
- **When the store cannot be used** the app carries on: a banner above the tabs says why and can be dismissed. Reading gives up after 30 seconds
  (the form appears, the banner says the store is slow, and the keys are used if they arrive after all); keeping or forgetting a key counts as failed
  after 30 seconds. Nothing is deleted from the store unless it is known to be there.

**Task details and log entry views**
- Selecting a task (to-do list, dashboard top tasks, calendar's Tasks) or a time entry (calendar's Logs) opens it in a tab. The task shows its facts,
  description, subtasks and relations, files, the time logged on it and its history; the log entry shows the time, day, user, activity, project, the
  task and the comment. Both link to Redmine in the browser.
- **A tab belongs to its server**: the view id is `task:<server id>:<number>` or `log:<server id>:<number>` (`lib/views.ts`), so the tab keeps working
  when another server is in use, asks for the sign-in of its own server, and closes when that server is removed. The tab's title is the task's number
  and subject once it has loaded. **These tabs cannot be dragged into a window of their own** (`canDetach`), which keeps the window layer unchanged.
- Descriptions and comments are shown **as typed**: Redmine's markup (Textile or Markdown) is not rendered and nothing in it runs. Rendering it
  safely is a separate piece of work.
- Redmine's API gives the old and new status, priority and tracker of a change as ids; the backend fetches the lists the history needs, and only
  those. Other ids (the assignee, version, category) cannot be told, so the line says "Assignee changed". The time logged is fetched on its own
  because a user may see a task and not the time others logged on it.

**Findings that cost time, and that the next person should know**
- **The dashboard card has a full-card `::after` layer** (`DashboardCard`, z-10) that makes a click anywhere open the list. A button inside the card
  is under it and never gets the click, which jsdom cannot show. The top-task buttons are `relative z-20`, with a test of the classes.
- **`secret-tool` prints to stderr.** `secret-tool search ... 2>/dev/null` shows nothing, and a script that parses it stores a key under a wrong name.
- **In a D-Bus session where the Secret Service is only "activatable" (its service file is installed, nothing answers), every call hangs.** That is
  why the timeouts exist. A session with no bus at all fails at once with "Failed to connect to address", which the banner shows.
- `pgrep -x` cannot match a name of more than 15 characters (`Gemiredmine-Unstable` has 20): use an anchored `pgrep -f '^/path/to/binary$'`.
- Tauri applies its permission check to every custom command as soon as the app defines an ACL manifest, so restricting one command means listing all.
- `libdbus` was already linked (by the window library); the credential crates added 18 crates and no system library. The unstable binary is
  16.5 MB (15.4 MB before this round, 12.5 MB before the database).

**Checked in the real app** (Linux, Xvfb, metacity for the window state, a private D-Bus session with an unlocked GNOME Keyring, the mock Redmine,
the unstable build; `docs/tauri-migration/keyring-rig/rig.sh`)
- A second start ends in 0.13 s with exit code 0; one copy is left; a minimised window is Iconic before and Normal after.
- A new server with a password sign-in: the key is in the keyring (service = identifier, user = `server:<id>`, the label `keyring:server:<id>@<identifier>`),
  the database has `remember = 1`, and the key is in no file of the data folder. After a `SIGKILL` and a start the dashboard shows at once, signed in.
- Sign out empties the keyring entry, and a task tab then asks for the sign-in of its own server. Signing in with the box unchecked leaves the keyring
  empty and `remember = 0`; after a restart the form has the box unchecked and the user name filled. The Settings box stores the key at once when
  turned on and removes it when turned off.
- A wrong key put in the keyring (as if the server had reset it): the first request gets 401, the server is signed out with the notice, the entry is removed.
- No session bus: the app starts, one copy, the banner shows "could not be reached: ... Failed to connect to address". A Secret Service that hangs:
  "Reading your saved sign-ins…" for 30 s, then the form and the banner; signing in works at once and, 30 s later, the banner says the sign-in could
  not be remembered.
- Task and log entry views from the dashboard's top task, a relation link, the calendar's log entry and its task link: facts, the overdue date in red,
  history with the names of the statuses and priorities, time logged, files, and markup shown as text.
- Tests: 67 files, 863 tests (one skipped) with the default channel and with `CHANNEL=stable`; `tsc`, `cargo fmt --check`, `cargo clippy -D warnings`
  and `cargo test --lib` (16 tests) are clean. Mutations turned tests red in `credentials.ts` (deleting what is not known to be there, overwriting a key
  that was signed in with, ignoring the choice, not forgetting a removed server) and in the plugin order (the single-instance plugin not first).

**CI on `6d676c4`** (dispatched on the branch, unstable channel, build only): **Build Linux AppImage** passed (ubuntu-22.04, 6m31s: the glibc and library
check with the new crates, the X11 and the Wayland smoke tests). **Build Windows package**: every step through the upload passed (the build 7m23s, so
`windows-native-keyring-store` and the single-instance plugin compile and link under MSVC; the executable check; the process still alive after 20 s
with nothing installed; the MSIX built and signed); only the saving of the build cache was still running when I looked. As before, the smoke tests
prove only that the app starts.

**Not verified**
- **Windows**: Credential Manager and the single-instance mutex have not run on a Windows machine, and whether the packaged (MSIX) app may use
  Credential Manager as an unpackaged one does is expected but not seen. Please check on the next unstable build: sign in with the box checked,
  close the app, open it (you should be signed in), start it twice (the second start brings the first forward), and sign out in Settings.
- **GNOME and KDE sessions**: only GNOME Keyring in a headless session was used. KDE Wallet's Secret Service, and the prompt of a locked keyring,
  were not seen. With a prompt that nobody answers, the app waits the 30 seconds and carries on.
- Wayland: the single-instance focus request is `set_focus`, which a compositor may turn into a notification instead of raising the window.
- The windows of the window layer after this change were not driven: a view window never reads or writes a credential, but a 401 seen there signs the
  server out through the shared session, which the unit tests cover and the real app did not.

## How it was verified

- All suites pass with the default channel and with `CHANNEL=stable`; `tsc` and the webview build are clean. This was
  re-run after the merge of `main`: 47 files, 426 tests.
- PR 0's golden snapshots were not touched by PR 1: the data folder comes out byte-identical through the async port.
- Every new guard test was checked by **mutation**: break the behaviour, see the test go red, restore. This found one
  test of mine with wrong arithmetic.
- **A real-app smoke test on Linux.** The Electrobun app, built from the final PR 1 commit, was run under a virtual
  display against the mock server and driven with `xdotool`:
  - sign-in as "Alice Example"; the dashboard showed 48 h logged, 117 tasks due in October and 130 assigned tasks
  - the developer preview wrote `settings.json` as `{"devPreviewEnabled": true}`, folders 0700, files 0600
  - feedback wrote its report with `token=[REDACTED]` and `Runtime: bun 1.3.13`; the prefilled issue URL reached
    `Utils.openExternal` (the sandbox has no `xdg-open`, so nothing opened)
  - signing in to the `/slow` server showed the 30-second message, and the preview log recorded it under scope
    `signIn` exactly 30.0 s after the request began
  - no errors or unhandled rejections in the app log
- **Again after the merge of `main`**, with the app built from `7340021`: the main window, now opened by `ViewWindows`,
  rendered, and signing in over `createRpc` and the backend adapter showed the same dashboard (48 h, 117 tasks due, 130
  assigned). Dragging a tab out into its own window was **not** exercised; `main`'s own tests cover it against a fake host.

**Not verified (PR 0 and PR 1)**
- Anything on Windows. The Windows build and MSIX packaging were not run in this sandbox.
- The first run of `checks.yml` is on the pull request itself.

### PR 2, in this sandbox (Ubuntu 24.04, WebKitGTK 2.52.6, Xvfb, the mock Redmine)

Built with `CHANNEL=unstable npm run build:desktop` (cold: 4m23s; one more channel afterwards: 1m42s; binary 12.5 MB; the
AppImage 5.0 MB) and driven with `xdotool`:

- Sign-in at `http://127.0.0.1:18123` shows the dashboard (48 h, 117 tasks due, 130 assigned). **This retires "the `*:*`
  scope was read, not run": a custom port works.** The window is 1024x768, titled "Gemiredmine Unstable", and
  `WM_CLASS` is `Gemiredmine-Unstable`, which matches `StartupWMClass`.
- `/moved` and `/sso` show their two messages, so `maxRedirections: 0` reaches the Redmine client. `/slow` shows the
  30-second message.
- TLS: a private CA works (through `SSL_CERT_FILE`, which only the native-roots loader reads), and an untrusted or
  self-signed certificate is refused. The message is only "error sending request for url (...)": it does not mention
  the certificate. A friendlier message is a follow-up. This retires "`rustls-tls-native-roots` finds the system certificates".
- Developer preview: with the default data folder (`$XDG_DATA_HOME/gemiredmine-unstable`, which did not exist yet) and
  with `GEMIREDMINE_DATA_DIR`, the folder is 0700 and `settings.json`, `logs/diagnostics.jsonl` and the feedback report
  are 0600. The log held the `/moved` error without the password. This retires the file scope claims.
- Feedback reports "Runtime: tauri 2.12.4 (WebKitGTK 2.52.6)". Both `target="_blank"` links (the releases page, the
  server link with a port) and the prefilled issue link reached `xdg-open` (a fake one logged them).
- The webview profile lives in `<LocalData>/com.gemiredmine.app.unstable`.
- A stable build, made after the unstable one in the same `target` folder, embeds `com.gemiredmine.app` and no
  `dev-preview-*` capability, has no preview panel, and (before the app's database, see "Storage") created no data folder. So a shared build cache does not carry one
  channel's identity into another.
- `package-linux.mjs` with the real, pinned `appimagetool` made a working AppImage; run with
  `--appimage-extract-and-run` it signed in to the mock (AppRun still set `GDK_BACKEND=x11` then).
- `rust-toolchain.toml` made rustup install 1.99.0 by itself. rustfmt and clippy (`-D warnings`) pass; `cargo test --lib` has 3 tests.
- Tests: 53 files and 540 tests (one skipped) with the default channel and with `CHANNEL=stable`; `tsc` and the webview
  build are clean. Mutations of the adapter (file modes, redirect limit, recursive `mkdir`, remove error handling), the
  HTTP scope and the workflow Rust version each turn a test red.

**Not verified**
- On Windows: installing the MSIX, the in-place upgrade from the Electrobun build, and a working window (CI only shows the process lives).
- Wayland, NVIDIA, other distributions, and whether the content security policy logs violations (nothing looked broken, but
  the console was not read).

### PR 2b, first pass, in this sandbox (Xvfb :98, metacity, GDK_BACKEND=x11, the mock Redmine; before the move to Wayland first)

The unstable build of the final tree, driven with `xdotool`:

- Dragging the To-do tab out of the strip opens a view window under the pointer. It is titled "To-do - Gemiredmine Unstable",
  loaded its 130 tasks (so it has its own working backend and received the session), and has the **Move to main window** button.
- Dropping the view window by its title bar on the main window's tab strip puts the tab back at the pointer's place and makes
  it active, and closes the view window. Detaching again afterwards works.
- **Move to main window** works. Closing a view window with its X works, and the same view can be opened again.
- The main window's X button and Alt+F4 end the app, with and without a view window open (the process is gone).
- From a view window, turning the developer preview on reached the main window's backend and wrote `settings.json`
  (folder 0700, file 0600).
- Idle CPU is 0 once `stableJson` is in; before it, two windows ping-ponged the session.
- Tests: 55 files, 575 tests (one skipped), `tsc` clean, `cargo test --lib` 4 tests. Removing the event targets from the
  transport, or comparing sessions with plain `JSON.stringify` again, each turns a test red.

### PR 2b, on a Wayland compositor in this sandbox

Headless sway 1.9 (wlroots, software rendering) with a virtual pointer and `wtype`, `DISPLAY` unset, the unstable build run
without `GDK_BACKEND` (`docs/tauri-migration/wayland-rig/`, see "Recipes"). Verified: the app starts natively (`app_id`
`Gemiredmine-Unstable`), signs in and shows the dashboard; dragging the To-do tab out opens its window; dragging that window
by the empty part of its tab strip moves it; dragging the window's tab onto the main window's strip shows the drop indicator,
closes the view window and puts the tab back where it was dropped; **Move to main window** works; and closing the main window
with a view window open ends the app. `scripts/release/smoke-test-wayland.sh` passes against the built app (the window opens
after about a second) and fails, as it should, for a command that exits at once, one that opens no window, and the app on X11
with no X server. Unit tests: the drop target, the accepted data, the `attachViewWindow` request and the config; three mutations
(no `preventDefault` on `dragover`, no check of the dropped view id, no check of the drag type) each turn a test red.

**CI on `731f4fd` (pull request #22), all green:** Checks (including the `rust` job), **Build Linux AppImage** (unstable, on
`ubuntu-22.04`) and **Build Windows package** (unstable, self-signed). In the Linux job the new step "Smoke test the AppImage on
Wayland" ran `smoke-test-wayland.sh` against the packaged AppImage with weston 9: "The app opened a window after about 1 seconds",
then "The app is still running", so the weston 9 options (`--backend=headless-backend.so`, `--use-pixman`) work. The Linux job took
5 minutes and the Windows job 4 with a warm cache.

**Not verified (PR 2b)**
- **Windows**: the pointer command (`GetAsyncKeyState`), window creation, dragging and dropping there, and the tab drop (WebView2
  with `dragDropEnabled` off). The Windows build workflow on `773f908` compiled the pointer command, passed the launch smoke
  test and signed the MSIX, so it builds; it has not been run by a person.
- **GNOME and KDE Wayland sessions, and an NVIDIA machine.** sway is not mutter: GTK draws its own title bar on GNOME, and
  placement of new windows differs. G4 covers them.
- **Monitors with different scale factors**: placement uses the main window's scale factor for every window.
- Several view windows open at once, and the feedback form from a view window, were not exercised in the real app.

### PR 2, first CI run (pull request #21, head `9acc3c5`)

All green on the first attempt:

- **Checks** (the pull request run): the original job and the new `rust` job (rustfmt, clippy, `cargo test --lib`; the lint
  step took 2.5 minutes and the tests 3 minutes on a cold cache).
- **Build Linux AppImage**, unstable, dispatched on the branch (gate G2): tests, type check, `check-linux-binary.mjs` (so the
  executable needs no glibc newer than 2.35 on the `ubuntu-22.04` runner, finds all its libraries and links no tray library),
  packaging, and the `xvfb` smoke test (the AppImage was still running at 20 s). Cold build step 7m32s, whole job 10m08s;
  the cache saved is 503 MB for one channel.
- **Build Windows package**, unstable, self-signed, dispatched on the branch (gate G3): `npm ci` installed the Windows CLI
  package, `check-windows-binary.mjs` found `dumpbin` and no VC runtime or WebView2 loader DLL among the dependencies,
  the executable was still running after 20 s on the runner, and the MSIX was built and signed. Cold build step 12m01s, and
  the whole job 14m36s. Both are far below the 60 and 75 minute limits.
- The **Unstable run #8** that the merge of pull request #20 triggered (`648fe5b`, the first Windows build of PR 0 and PR 1) succeeded.

This does **not** show that the MSIX installs, upgrades in place from the Electrobun build, or opens a window that works on a
clean Windows 11. That is gate G5. A runner has WebView2 and a desktop session, and it shows only that the process lives.

**Things noticed, not changed**
- Developer preview events wait up to 60 s for the flush timer, and nothing flushes on exit (`dispose()` has no caller),
  so the last minute of events is lost when the app closes. This was already true on Electrobun.
- A connection error reads "error sending request for url (...)", which names neither the cause nor the certificate.

## Next: land PR 2, then PR 2b

1. ~~Check the Unstable run that the merge of PR 0 and PR 1 triggered.~~ It succeeded (run #8).
2. ~~Open the draft pull request and dispatch the two build workflows.~~ Done: pull request #21; gates G1 to G3 passed.
3. ~~PR 2b: the window layer.~~ Implemented on `claude/tauri-window-layer`, stacked on PR 2 (see "PR 2b" above).
   Dispatch the Linux and Windows build workflows on it. The Windows one compiles the pointer command for the first time.
4. Hardware gates G4 (Linux checklist **on Wayland: GNOME, an NVIDIA machine, KDE if available; X11 is not a target**), G5
   (Windows 11 on a clean VM, upgrade in place from the Electrobun build) and G6 (data continuity) need a person; see `plan.md`.
   Record the SHA of the last Electrobun commit (`648fe5b`) in the pull request. **G4 and G5 now also cover the window layer:**
   drag a tab out, drag the new window's **tab** back onto the main window's tabs (G5 also by its title bar), use **Move to
   main window**, close the main window with a view window open, and turn the preview on from a view window.
5. **Merge order.** Merge #21 (PR 2) first, with a merge commit, because this file names commits by SHA. The owner allows
   shipping between PR 2 and PR 2b, so #21 does not have to wait for PR 2b, but then Unstable users lose dragging tabs into
   windows until PR 2b merges. Merge PR 2b second, with a merge commit too. Its base is `claude/tauri-2-shell`; GitHub
   retargets it to `main` when that branch is deleted on merge, otherwise change the base by hand first. After both: soak unstable, then one canary, then stable (`plan.md`, "After merge").
6. Then the optional PR 3 (end-to-end tests, rename `src/bun` to `src/core`) and the Android phase.

**Decided by the project owner**
- **2026-10-15, one instance, and servers.** "We should not allow to run multiple instances of main window." Multiple servers at once is optional
  and out of scope for now. Remember me is checked by default at the initial server login, the choice is per server, and only the user token is stored.
- **2026-10-15, Linux: Wayland first, no X11 expected** ("For linux we need support wayland first, no x11 support expected").
  `AppRun` does not force X11; X11 is neither tested nor supported; the window layer must not need screen positions.
- **2026-10-15, shipping between PR 2 and PR 2b: allowed for every channel** ("It does not matter to ship in mid pr or not").
- **2026-10-14, the window layer: split.** "I allow a regression, the goal is to migrate." PR 2 swaps the shell with one
  window and turns dragging tabs into windows off on Tauri; PR 2b ports it. Unstable users lose the feature between the two.

**Open questions for the project owner**
- Should task and log entry tabs be draggable into windows of their own, like the other views? They are not now. It needs the window layer to
  carry a server with the view (the id has it already) and the hash and drag checks to accept the longer id.
- Should Redmine's markup (Textile, Markdown) be rendered in descriptions and comments? They are shown as typed now. Rendering needs a parser and a
  sanitiser; it is the one place where the app would put server text into HTML.
- Where Linux has no Secret Service, "Remember me" cannot work. Should the app offer an encrypted file protected by a password instead, or leave it?
- What will the history of the language model conversations be keyed by (server, user, project)? It decides the first tables, and whether view
  windows need the `storage` permission.
- Who runs gates G4 to G6, and when? They block taking pull request #21 out of draft. G4 and G5 now also cover the window layer
  (on Wayland, and on Windows 11).
- Keep the title-bar drop on Windows? It needs the pointer command and the polling code. The tab drop (new) works on every
  platform without them; deleting the geometry path would remove the one piece of Rust that is more than wiring. Windows
  users would lose dropping a window by its title bar, and keep dragging its tab.
- How long should the unstable and canary soak last before stable? The plan says five or more unstable builds or one week.

## Recipes

### Run the mock Redmine

```sh
node scripts/dev/mock-redmine.mjs --port 8123 [--host 0.0.0.0] [--delay-ms 31000]
```

Sign in as `alice` with the password `secret`, or add the server with the API key
`0123456789abcdef0123456789abcdef01234567`. It sends no CORS headers, like a real Redmine. Base URLs select the
behaviour: `http://127.0.0.1:8123/moved` answers 301, `/sso` answers 302 to a login page, and `/slow` answers after
`--delay-ms`. It serves 130 open issues and about 60 days of time entries.

### Smoke-test the real Tauri app on Linux (headless)

```sh
# once, on Ubuntu 24.04
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev xvfb xdotool scrot x11-utils zsync squashfs-tools

CHANNEL=unstable npm run build:desktop    # cold about 4.5 minutes; rustup installs the pinned Rust by itself

WORK=$(mktemp -d)
node scripts/dev/mock-redmine.mjs --port 18123 > "$WORK/mock.log" 2>&1 &
Xvfb :99 -screen 0 1280x900x24 > "$WORK/xvfb.log" 2>&1 &
export DISPLAY=:99
XDG_DATA_HOME="$WORK/xdg" src-tauri/target/release/Gemiredmine-Unstable > "$WORK/app.log" 2>&1 &

scrot "$WORK/shot.png"                                  # look at it
xdotool mousemove 512 362 click 1; xdotool type --delay 25 "text"
```

- The window is 1024x768 at the top-left of the display. Layout changes move the coordinates, so take a screenshot first.
  On the empty start screen: server name (512, 362), URL (512, 440), user name (408, 585), password (616, 585) and
  "Add Server" (657, 764). Once signed in: the user menu (916, 32), then "About" (736, 318).
- Servers are kept in `<data folder>/gemiredmine.db` (below `$XDG_DATA_HOME/gemiredmine-unstable`, or `GEMIREDMINE_DATA_DIR`); API keys are
  in the system's credential store, for the servers where the user chose to be remembered. Without a key a launch starts at a sign-in form for the
  active server, with the user name filled in. For a clean start use a new `XDG_DATA_HOME`, and remove the keyring entries (`secret-tool clear
  service <identifier> username server:<id>`).
- **A real credential store on Linux: `docs/tauri-migration/keyring-rig/rig.sh`** (a private D-Bus session with an unlocked GNOME Keyring, a virtual
  display, the mock Redmine). `rig.sh start`, `rig.sh app`, drive it with `xdotool`, look at the keys with `rig.sh keys`, try a second start with
  `rig.sh second`, a store that hangs with `rig.sh appbare` and no bus with `rig.sh app DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent`. With
  metacity on the display (`metacity --replace --sm-disable &`) a window can be minimised with `xdotool windowminimize`.
  To look at the data: `python3 -c "import sqlite3; ..."` on a copy, or on the file with the app stopped (`mode=ro` works while it runs).
- Allow about 3 seconds after a click before taking a screenshot; software rendering repaints slowly.
- Scroll with `xdotool click 5` (down) and `4` (up). The developer preview is at the bottom of About.
- `GEMIREDMINE_DATA_DIR=<dir>` moves the preview's data; otherwise it is `$XDG_DATA_HOME/gemiredmine-unstable`. The
  webview's own storage is `$XDG_DATA_HOME/com.gemiredmine.app.unstable`.
- To see what the app asks the browser to open, put a script called `xdg-open` that appends its arguments to a file in
  front of `PATH`.
- A private CA: start an HTTPS server with a certificate from your own CA and run the app with `SSL_CERT_FILE=<ca.pem>`.
  Only the native-roots loader reads that variable, so a successful sign-in proves the system certificates are used.
- The AppImage: `CHANNEL=unstable node scripts/release/package-linux.mjs`, then run the file with
  `--appimage-extract-and-run` (the sandbox has no FUSE). `xprop -id <window> WM_CLASS` should print the app name.
- **Testing on Wayland: `docs/tauri-migration/wayland-rig/rig.sh`.** `apt install sway grim wtype libwayland-dev libwayland-bin
  gcc curl`, then `rig.sh start` (a headless sway of 1280x900 and a virtual pointer), `rig.sh app`, and drive it with
  `rig.sh click X Y`, `rig.sh type "text"`, `rig.sh ptr "move 310 109" "wait 150" down "move 900 300" up`, `rig.sh shot f.png`
  and `rig.sh windows`. Run `node scripts/dev/mock-redmine.mjs --port 18123` first. The webview starts at about (128, 91);
  sway's title bar is 25 px. Sign in (field centres 640,428 / 640,506 / 536,652 / 744,652, button 785,828), click "Open to-do
  list" (1045,267), press on the To-do tab (310,109) and move out of the window in steps of 100 ms to detach it. sway opens the
  new window exactly over the main one, so drag it aside by sway's title bar first (press at the title, move, release) to see
  the main window's tab strip; then press on the view window's tab, move to the strip (300,110) in steps of 200 ms, and release.
  Paint is slow without a GPU: wait a second before a screenshot. The virtual keyboard loses its first key, which `rig.sh type` works around.
- To test the title-bar drop on X11 (not a target any more): Xvfb, `dbus-run-session -- metacity --replace --sm-disable &`, and
  `GDK_BACKEND=x11`. openbox and xfwm4 do not work for this (see "PR 2b").
- Stop everything by process ID (`kill $!` when you start each one). `pkill -f` matches its own shell, and so does a command line that contains the pattern. When you restart
  the app between scenarios, check with `pgrep -a Gemiredmine` that the old one is gone.
- A background command that ends in `&` inside `run_in_background` returns at once; wait for a file instead.

### Environment

- **Network from the sandbox.** Reachable: `raw.githubusercontent.com` (also the way to check that an action's tag exists),
  `registry.npmjs.org`, `index.crates.io`, `static.crates.io`, `static.rust-lang.org`, apt, and GitHub release downloads
  (the pinned `appimagetool`). Blocked: `github.com`
  pages, `api.github.com`, `codeload.github.com`, and documentation sites (`tauri.app`, `docs.rs`, `electrobun.dev`,
  `blackboard.sh`). There is no `gh` CLI; use the GitHub MCP tools (`mcp__github__*`) for pull requests.
- **`main` moves while a PR is open.** Run `git fetch origin main` and `git log HEAD..origin/main` before starting a
  step, and again before opening a pull request. The file lists in `plan.md` were checked on 2026-10-14 and can be out of date.
- **Commits.** Conventional Commits are enforced by commitlint. The sandbox installs without husky
  (`HUSKY=0 npm ci`), so the hooks do not run: run `npm test` yourself and lint the message with
  `npx --no -- commitlint < message.txt`. Commit bodies are limited to 100 characters per line.
- **Generated files.** `npm test` first runs `scripts/release/write-build-info.mjs`, which writes
  `src/shared/build-info.generated.ts` and the two `dev-preview.generated.ts` files for `$CHANNEL` (default `dev`).
  After `CHANNEL=stable npm test` those files are the stable stubs, and a plain `npx tsc` or `npx vitest` sees them.
  Run `node scripts/release/write-build-info.mjs` to reset them.
- **Test environments.** Tests run in jsdom. Tests that need real HTTP, real files, or Node's `URL` start with
  `// @vitest-environment node`.
- **Snapshots.** Do not run vitest with `-u` unless a snapshot change is intended. With `CI=true`, vitest refuses to
  write new snapshots, which is what CI does.
- **Shell traps.** `A=x && command &` puts the assignment in the background too, so `$A` is empty afterwards; set the
  variable on its own line. A removal under `/` is stopped by a safety check, and it must not be worked around.
