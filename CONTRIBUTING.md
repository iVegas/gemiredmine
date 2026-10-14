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

`npm run release` (standard-version) updates `CHANGELOG.md` and the version, but it also creates a
local tag. Push the commit only, and let the Stable workflow create the tag.

## Testing and checks

- `npm test` runs the unit tests. It regenerates `src/shared/build-info.generated.ts` first.
- `npm run typecheck` type-checks the whole project, including the release scripts.
- The reusable build workflow runs both before it packages anything.

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
