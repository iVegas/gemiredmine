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

## The desktop shell

The shell is Tauri 2: the webview plus a small Rust crate in `src-tauri/` that does nothing but wire up plugins.
Keep it that way; logic belongs in TypeScript, where the tests and the Android build reach it.

- **Capabilities need review.** `src-tauri/capabilities/` says what the webview may do. `main.json` lets it talk to
  any host over http(s) (the server is the user's own) and open web links. Each `dev-preview-<channel>.json` gives
  that channel's developer preview file access to its own data folder only, and stable gets none. A new permission is
  a security change: say why in the pull request.
- **Identity comes from one place.** The name, identifier, version, icons and capabilities of a channel come from
  `scripts/release/channels.mjs` through `scripts/release/tauri-config.mjs`. Do not edit them in
  `src-tauri/tauri.conf.json`, which is the dev channel and what every channel shares (the content security policy).
- **Run it:** `npm run tauri dev`. Build a channel with `CHANNEL=<channel> npm run build:desktop`.
- **Tauri and its plugins** are updated as described in `RELEASE_POLICY.md`, in a `chore(deps)` commit.

To try the app without a Redmine server, run `node scripts/dev/mock-redmine.mjs` and sign in as
`alice` with the password `secret`.
