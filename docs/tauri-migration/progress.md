# Tauri 2 migration: progress

**Start here.** This file says what is done, what is next, and how to check it. The reasoning and the full
specification of the remaining work are in [`plan.md`](./plan.md).

*Last updated 2026-10-14, after PR 0 and PR 1.*

**Keep this file current.** Whoever does a step updates this file in the same pull request: the status table, the
commit SHAs, anything that went differently from the plan, and what you learned about the environment. Put a decision
that changes in `plan.md`, with the reason.

## Status

| Step | State | Commits | Notes |
|---|---|---|---|
| PR 0: safety net | **done** | `de4a781` `61c9456` `20d1c9e` `32f90df` | Golden tests, mock Redmine, a PR check workflow |
| PR 1: runtime-neutral backend | **done** | `d3cb9bd` `73539b7` `7422bf2` `9a93f87` | Still ships on Electrobun; no change for users except the timeout message |
| PR 2: Tauri shell | not started | | Next. See `plan.md`, "PR 2" |
| PR 3: end-to-end tests, rename `src/bun` to `src/core` | optional | | Best at the start of the Android phase |
| Android on Tauri, retire Capacitor | not started | | Outline in `plan.md` |

PR 0 and PR 1 were opened together as one pull request on `claude/elegant-fermi-u669ds`. Test suite: 35 files and 233
tests before, 44 files and 356 tests (one skipped) after.

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

## How it was verified

- All suites pass with the default channel and with `CHANNEL=stable`; `tsc` and the webview build are clean.
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

**Not verified**
- Anything on Windows. The Windows build and MSIX packaging were not run in this sandbox.
- The first run of `checks.yml` is on the pull request itself.

## Next: PR 2

Follow `plan.md`, "PR 2". Before the first commit:

1. Branch from `main` once PR 0 and PR 1 have merged. Open PR 2 as a draft; it stays a draft until gates G1 to G6 pass.
2. Re-check the pinned versions (`npm view @tauri-apps/cli dist-tags`, the crates index). The plan's pins date from 2026-10-14.
3. Do a small throwaway spike on Linux first, to retire the claims that were *read, not run*:
   - the `http://*:*` scope reaches a server on a custom port (the mock on 18123)
   - `rustls-tls-native-roots` finds the system certificates
   - the hand-made AppImage around the raw binary starts under `xvfb-run`
   A Rust toolchain can probably be installed in this sandbox (`static.rust-lang.org` and crates.io are reachable) and
   the WebKitGTK libraries come from apt, so Linux builds and `xvfb` smoke tests should be possible. Windows and
   Wayland are not.
4. Things that need a person with hardware: gate G5 (Windows 11, on a clean VM) and the Wayland and NVIDIA part of G4.

**Open questions for the project owner**
- Keep Electrobun's X11-only behaviour on Linux for parity (the plan's default, through `GDK_BACKEND`), or accept
  native Wayland as an intentional change?
- Who runs gates G4 and G5, and when? They block the merge of PR 2.
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

### Smoke-test the real Electrobun app on Linux (headless)

```sh
# once, on Ubuntu 24.04
sudo apt-get install -y libwebkit2gtk-4.1-0 libsoup-3.0-0 libjavascriptcoregtk-4.1-0 libayatana-appindicator3-1 xvfb xdotool scrot

CHANNEL=dev npm run build:electrobun      # the first run downloads Electrobun's core from GitHub releases

WORK=$(mktemp -d)
node scripts/dev/mock-redmine.mjs --port 18123 > "$WORK/mock.log" 2>&1 &
Xvfb :99 -screen 0 1280x900x24 > "$WORK/xvfb.log" 2>&1 &
export DISPLAY=:99
(cd build/dev-linux-x64/Gemiredmine-Dev-dev/bin && GEMIREDMINE_DATA_DIR="$WORK/data" ./launcher > "$WORK/app.log" 2>&1 &)

scrot "$WORK/shot.png"                                  # look at it
xdotool mousemove 512 362 click 1; xdotool type --delay 25 "text"
```

- The window is 1024x768 at the top-left of the display. Layout changes move the coordinates, so take a screenshot first.
- Allow about 3 seconds after a click before taking a screenshot; software rendering repaints slowly.
- Scroll with `xdotool click 5` (down) and `4` (up).
- The developer preview is in the user menu, under **About**; **Manage servers** is where servers are added.
- Stop everything by process ID (`kill $!` when you start each one). `pkill -f` matches its own shell.

### Environment

- **Network from the sandbox.** Reachable: `raw.githubusercontent.com`, `registry.npmjs.org`, `index.crates.io`,
  `static.crates.io`, `static.rust-lang.org`, apt, and GitHub release downloads (Electrobun's core). Blocked: `github.com`
  pages, `api.github.com`, `codeload.github.com`, and documentation sites (`tauri.app`, `docs.rs`, `electrobun.dev`,
  `blackboard.sh`). There is no `gh` CLI; use the GitHub MCP tools (`mcp__github__*`) for pull requests.
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
