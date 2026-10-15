# Contributing Guidelines

Thank you for contributing to `gemiredmine`!

## Git Workflow

We use a strict Git workflow to ensure code quality and automated release tracking.

### 1. Conventional Commits
All commits to this repository **must** follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

Examples of valid commit messages:
*   `feat: add multiple server connection manager`
*   `fix(auth): prevent token leakage in logs`
*   `docs: update readme with setup instructions`
*   `chore(deps): update dependency react to v18`

This is enforced via a `commit-msg` git hook using `commitlint`.

### 2. Pre-Commit Hooks
Before a commit is allowed, automated tests and checks will run via a `pre-commit` hook.
You must ensure your code passes all tests locally before committing. The hook will execute tests automatically to prevent breaking changes from being committed.

### 3. Versions and releases
The version lives only in `version` in `package.json`. Do not edit versions anywhere else.

Releases are made with the workflows in `.github/workflows` (Unstable, Canary, Stable). Do not
create release tags by hand. See [`RELEASE_POLICY.md`](./RELEASE_POLICY.md) for the channel rules
and the steps to publish each channel.

`npm run release` (commit-and-tag-version) updates `CHANGELOG.md` and the version, but it also creates a
local tag. Push the commit only, and let the Stable workflow create the tag.

## Ongoing work

The desktop shell moved from Electrobun to Tauri 2. What is left (tabs in windows of their own, Android on Tauri) and
how the move went are in [`docs/tauri-migration/`](./docs/tauri-migration/progress.md).

## Testing and checks

- `npm test` runs the unit tests. It regenerates `src/shared/build-info.generated.ts` first.
- `npm run typecheck` type-checks the whole project, including the release scripts.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` check the Rust crate. Pull
  requests run them in CI; the crate needs the packages listed in the README's development setup.
- The reusable build workflows run the unit tests and the type check before they package anything.

## Windows packages and signing

`scripts/release/package-windows.mjs` builds the MSIX for a channel. It needs the Windows 10/11 SDK tools
(`makeappx.exe` and `signtool.exe`), which the GitHub Windows runner provides. To run it locally on Windows,
set `CHANNEL` and optionally `MAKEAPPX` and `SIGNTOOL` to the tool paths. Without `WINDOWS_SIGNING` the package
is unsigned and cannot be installed.

To create the self-signed certificate used by canary and unstable, run one of these once. On Windows:

```powershell
.\scripts\release\New-SelfSignedCodeSigningCertificate.ps1 -SetGitHubSecrets
```

On Linux (Ubuntu and Kubuntu have the OpenSSL it needs; `--set-github-secrets` also needs `gh`, logged in):

```sh
./scripts/release/new-self-signed-code-signing-certificate.sh --set-github-secrets
```

Without `--set-github-secrets` the Linux script writes each secret's value to a file in
`~/gemiredmine-signing/secrets`, to paste into the repository's Actions secrets.

The release workflows read the secrets listed in [`RELEASE_POLICY.md`](./RELEASE_POLICY.md#signing-secrets-windows).

## Developer preview

Canary, unstable and dev builds offer an opt-in developer preview in the About screen (off by
default). Stable builds do not include it. The implementation lives in `src/bun/diagnostics/`, and
the webview panel in `src/mainview/components/DeveloperPreview.svelte`.

## The backend

`src/bun/` holds the code that talks to Redmine and writes the developer preview's files. Its
requests and responses are described by `GemiBackend` in `src/shared/backend.ts`, and
`createBackend` in `src/bun/backend.ts` implements it.

`createBackend` uses no Node or Bun API, so that it can also run inside a webview. It gets what
it needs from the platform it is given: an HTTP client, the file operations of `DataFs`, a way to
open a link, and the machine's description. The desktop shell supplies them from Tauri's HTTP, file and opener
plugins (`src/mainview/lib/tauri-platform.ts`), and `src/mainview/lib/bridge.ts` creates the backend. Tests that need
a real folder use `src/bun/diagnostics/__tests__/support/node-data-fs.ts`. A test
(`src/bun/__tests__/webview-safe.spec.ts`) fails when `node:` imports, `Buffer`, `process` or `Bun`
appear in the files that have to stay portable. Put code that needs them next to `tauri-platform.ts`.

## Storage

What the app keeps between runs lives in one SQLite database, `gemiredmine.db`, in the channel's data folder (the
folder the About screen names; `GEMIREDMINE_DATA_DIR` moves it). Today that is the settings and the Redmine servers
the user added. It never holds an API key or a password: the user signs in again after a start. The history of the
conversations with the language model goes in the same file, as new tables.

- `src/bun/storage/` is portable like the rest of the backend. It needs only a `SqlDatabase` (`execute` and `select`).
  The desktop shell supplies one from Tauri's SQL plugin (`openDatabase` in `src/mainview/lib/tauri-platform.ts`) and the
  tests from `node:sqlite` (`src/bun/storage/__tests__/support/node-sql-database.ts`).
- **A change to the schema is a new entry in `MIGRATIONS`** (`src/bun/storage/migrations.ts`), never an edit to one that
  was released. Write each step so that it is harmless when it runs twice (`CREATE TABLE IF NOT EXISTS`): the database
  has no transaction across calls, so an app that is closed in the middle of a migration starts it again. A test runs
  every step twice. `ALTER TABLE ... ADD COLUMN` is not safe to run twice, so use `addColumn`, which looks first. The data of a newer version is refused (`StorageTooNewError`), and the app carries on without saving.
- The plugin binds every number as a float, so declare whole numbers INTEGER, and bind 0 and 1, not booleans. A change
  that must be all or nothing has to be one statement; `AppStorage` runs its saves one at a time for the same reason.
- Only the main window opens the database (`src-tauri/capabilities/storage.json`). A view window gets what it shows from
  the main window. `src/mainview/lib/persistence.ts` loads the servers when the app starts and saves them when they change.
- The webview picks the database's path (the plugin takes a connection string), so keep the permission off the other windows.

## Credentials and the sign-in

The API key of a server is the only secret the app keeps, and only when the user chose to be remembered at that server (the box is
checked by default and kept per server). It goes in the system's credential store, never in the database and never in a file, and the
password is never kept. The Rust side (`src-tauri/src/credentials.rs`) reaches Windows Credential Manager and the Secret Service through
`keyring-core` and one store crate per system; the webview asks by server id.

- `src/mainview/lib/credentials.ts` keeps the store in line with the servers by following them, so no code that signs in, signs out or
  removes a server has to call the store: it sets `apiToken` and `remember`, and the rest follows. Keep it that way.
- A server that rejects a key (401) is signed out by `expireSignIn` through the backend's `onUnauthorized`. Add a Redmine call by wrapping it in
  `authorized(access, ...)` in `src/bun/backend.ts`, which is what tells the app.
- Every call to the store may wait, or hang (a locked keyring, a Secret Service that never answers), so nothing waits for it without a limit, and
  a failure is told in the banner, never thrown at the user. Nothing is deleted from the store that is not known to be there.
- `docs/tauri-migration/keyring-rig/rig.sh` runs the app against a real keyring on Linux.

## Views of a task and of a log entry

Their tab ids carry the server (`task:<server id>:<number>`, `log:<server id>:<number>`, `src/mainview/lib/views.ts`), so a tab stays with the
server it was opened on, and `RecordPanel` finds that server for the tab. Open one with `openTask` or `openLogEntry`. They are not draggable into
windows of their own (`canDetach`). Text that comes from Redmine (descriptions, comments, names) is shown as text, never as HTML: keep it so.

## The desktop shell

The shell is Tauri 2: the webview plus a small Rust crate in `src-tauri/` that does nothing but wire up plugins.
Keep it that way; logic belongs in TypeScript, where the tests and the Android build reach it.

- **Capabilities need review.** `src-tauri/capabilities/` says what the webview may do. `backend.json` lets the main window and
  the view windows (`view-*`) talk to any host over http(s) (the server is the user's own) and open web links. `main.json`
  lets the main window open, focus and close view windows, `view-window.json` lets a view window be dragged, and
  `storage.json` lets the main window read and write the app's database. The commands of `lib.rs` (`prepare_storage_dir`, the three credential
  commands) are open to every window: Tauri restricts custom commands only when all of them are listed, and every window holds the API keys in
  memory anyway. Each
  `dev-preview-<channel>.json` gives that channel's developer preview file access to its own data folder, for the main
  window only (a view window hands its diagnostics to the main window), and stable gets none. A new permission is
  a security change: say why in the pull request.
- **Identity comes from one place.** The name, identifier, version, icons and capabilities of a channel come from
  `scripts/release/channels.mjs` through `scripts/release/tauri-config.mjs`. Do not edit them in
  `src-tauri/tauri.conf.json`, which is the dev channel and what every channel shares (the content security policy).
- **Wayland first on Linux.** Nothing may need X11 or a position on the screen: Wayland does not tell an application where its
  windows or the pointer are, and does not let it place a window. `AppRun` sets no `GDK_BACKEND`, and the Linux build starts the
  AppImage on a headless compositor to prove it. A feature that moves things between windows uses drag and drop or a request
  between windows, as dropping a view's tab onto the main window's tabs does. `docs/tauri-migration/wayland-rig/` is a rig to
  try it (a headless sway with a virtual pointer).
- **One copy per channel.** `tauri-plugin-single-instance` has to stay the first plugin (a test checks it), so that a second start ends before it
  opens anything. It brings the main window forward. Channels have their own identifiers and still run side by side.
- **Run it:** `npm run tauri dev`. Build a channel with `CHANNEL=<channel> npm run build:desktop`.
- **Tauri and its plugins** are updated as described in `RELEASE_POLICY.md`, in a `chore(deps)` commit.

To try the app without a Redmine server, run `node scripts/dev/mock-redmine.mjs` and sign in as
`alice` with the password `secret`.
