# Release and Channel Policy

Gemiredmine ships three release channels for Linux (AppImage) and Windows 11 (MSIX). Each channel is a
separate application on each platform: it can be installed next to the others, and it keeps its own settings.

## Versions come from one place

`version` in `package.json` is the only version a person edits. Everything else is derived from it
and from the channel, by `scripts/release/channels.mjs`:

| Channel  | Built when                          | Version                          | Example                       |
|----------|-------------------------------------|----------------------------------|-------------------------------|
| Stable   | Stable workflow, started by hand    | `package.json` version (x.y.z)   | `1.0.0`                       |
| Canary   | Canary workflow, started by hand    | `package.json` version (x.y.z-rc.n) | `1.0.0-rc.1`               |
| Unstable | Every push to `main`                | `<x.y.z>-unstable.<run number>`  | `1.0.0-unstable.42`           |

The version shown in the app's About screen, the AppImage file name, and the release tag all come
from this derivation.

## Channel rules

**Unstable** contains the last 3 builds of `main`. Each push to `main` builds an unstable AppImage,
publishes it as a pre-release tagged `unstable-v<version>`, and removes older unstable releases and
their tags.

**Canary** is a release candidate, started manually from any branch. Its version must be a
pre-release (`x.y.z-rc.n`) and newer than the latest stable release. Before the first stable release
any candidate is allowed. The canary channel only contains versions newer than the latest stable
release: when a stable release is published, older canary releases are removed.

**Stable** is started manually from `main`. Its version must be a plain `x.y.z` that has not been
released yet and is newer than the latest stable. Only the two newest stable releases are kept.
Stable builds never include the developer preview.

Each channel also has a pointer release (`unstable-latest`, `canary-latest`). It always holds the
newest build of that channel under a fixed file name, and it is what AppImageUpdate follows. Pointer
releases are never pruned.

## Installing and updating on Windows 11

Each channel is its own MSIX package identity, so the channels install side by side and each one
upgrades in place:

| Channel  | Package identity                  | Install from (App Installer)                                                              |
|----------|-----------------------------------|-------------------------------------------------------------------------------------------|
| Stable   | `com.gemiredmine.app`             | `https://github.com/iVegas/gemiredmine/releases/latest/download/Gemiredmine.appinstaller` |
| Canary   | `com.gemiredmine.app.canary`      | `https://github.com/iVegas/gemiredmine/releases/download/canary-latest/Gemiredmine-Canary.appinstaller` |
| Unstable | `com.gemiredmine.app.unstable`    | `https://github.com/iVegas/gemiredmine/releases/download/unstable-latest/Gemiredmine-Unstable.appinstaller` |

Open the link (or use `ms-appinstaller:?source=<link>`) to install the channel. Windows then checks
the App Installer feed when the app starts, every 8 hours, and upgrades the installed package in place.
Only one package is installed per channel. Settings live under `%LOCALAPPDATA%` in a folder named for
the channel, and the packaged app's data is private to its identity, so channels never share settings.
The webview keeps its own storage (local storage and caches, not Redmine data) in a folder named for the
package identity, below the same `%LOCALAPPDATA%`.
Uninstalling a channel from Windows Settings removes its package and its data.

MSIX versions have four numbers, so each build maps onto them in order: stable `1.2.0` becomes
`1.2.0.0`, canary `1.2.0-rc.3` becomes `1.2.0.3`, and unstable `1.2.0-unstable.42` becomes `1.2.0.42`.
Within a channel the version always increases, so every upgrade is accepted.

Windows packages are signed with one of two profiles, chosen by channel:

- **Canary and unstable: self-signed.** One certificate, created once and kept as a secret, so every
  build has the same publisher and upgrades work. Each release attaches the public certificate
  (`<app>-self-signed.cer`). Before installing, import it as an administrator into the Trusted People store:
  `Import-Certificate -FilePath <file>.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`.
- **Stable: trusted.** A publicly trusted code-signing certificate, so Windows installs the package without
  any manual step. Stable releases are refused unless they are signed this way.

Local builds are unsigned and cannot be installed. Set `REQUIRE_SIGNING=1` for release builds, which refuses
an unsigned package.

## Installing and updating on Linux

Each channel's AppImage has its own file name, application identifier, desktop entry and settings
folder:

| Channel  | AppImage                                         | Settings folder               |
|----------|--------------------------------------------------|-------------------------------|
| Stable   | `Gemiredmine-<version>-x86_64.AppImage`          | `~/.local/share/gemiredmine`  |
| Canary   | `Gemiredmine-Canary-<version>-x86_64.AppImage`   | `~/.local/share/gemiredmine-canary` |
| Unstable | `Gemiredmine-Unstable-<version>-x86_64.AppImage` | `~/.local/share/gemiredmine-unstable` |

Only one AppImage per channel is meant to be installed. Installing a newer AppImage of the same
channel replaces the desktop entry of the previous one, because the desktop entry identifier is
fixed per channel.

The app never downloads or replaces itself. Updates come from the platform's own mechanism:

- AppImages embed update information. Install `AppImageUpdate` and run it on the AppImage to update
  in place. Stable follows the latest stable release; canary and unstable follow their pointer
  releases.
- Where a system package manager is available for the application, use that instead.

## Developer preview

The developer preview is opt-in and off by default. It is available in canary, unstable and dev
builds, and it is not part of stable builds. When it is on, the app keeps a small, size-rotated log
of aggregated events (repeated events collapse into a count, and credentials are removed before
anything is written). Feedback creates a prefilled GitHub issue in the browser. Nothing is sent
without the user submitting that issue.

## Dependencies

Dependencies are updated once before the first stable release, and afterwards only before the next
release candidate. Dependency updates go in their own `chore(deps)` commit so they are easy to
review and revert.

Tauri stays on the 2.12 line. The `@tauri-apps/*` npm packages are pinned exactly, and the crates in
`src-tauri/Cargo.lock` move with them: update both in one `chore(deps)` commit, and keep each package on
the same minor version as its crate (`scripts/release/__tests__/tauri-setup.test.ts` fails otherwise).
The Rust toolchain is pinned in `rust-toolchain.toml`; a bump also changes the version in the three
workflows that install it, which the same test checks. Tauri 3 is a separate decision.

## Signing secrets (Windows)

Each profile has its own secrets, so the self-signed certificate can never reach a stable release.

| Secret | Used by | Contents |
|---|---|---|
| `WINDOWS_SELF_SIGNED_PFX_BASE64` | canary, unstable | base64 of the self-signed `.pfx` |
| `WINDOWS_SELF_SIGNED_PASSWORD` | canary, unstable | password of that `.pfx` |
| `WINDOWS_SELF_SIGNED_PUBLISHER` | canary, unstable | certificate subject, for example `CN=Gemiredmine` |
| `WINDOWS_TRUSTED_PFX_BASE64` | stable | base64 of the trusted code-signing `.pfx` |
| `WINDOWS_TRUSTED_PASSWORD` | stable | password of that `.pfx` |
| `WINDOWS_TRUSTED_PUBLISHER` | stable | certificate subject exactly as in the certificate |

Create the self-signed certificate once, with `scripts/release/New-SelfSignedCodeSigningCertificate.ps1` on
Windows or `scripts/release/new-self-signed-code-signing-certificate.sh` on Linux. Both can store the three
secrets with `gh` (`-SetGitHubSecrets`, `--set-github-secrets`). A workflow whose channel has no secrets fails at the
Windows packaging step, and the run summary shows an error naming the missing secret: Unstable and Canary until
the self-signed secrets exist, Stable until the trusted ones do. Nothing is published from a failed run, Linux
included.

## Running a release

1. **Unstable**: merge to `main`. Nothing else to do.
2. **Canary**: set `version` in `package.json` to the candidate, for example `1.1.0-rc.1`, commit
   it, then run the *Canary* workflow on that branch.
3. **Stable**: set `version` in `package.json` to the release, for example `1.1.0`, merge it to
   `main`, then run the *Stable* workflow on `main`. The workflow creates the `v1.1.0` tag. The
   publish job uses the `stable-release` environment, so configure required reviewers there.

Each workflow validates the version against this policy before it builds anything.

## Host requirements (Windows 11)

Windows 11 (build 22000 or later) on x64. The app uses the WebView2 runtime, which ships with Windows 11. The
executable has the Visual C++ runtime and the WebView2 loader linked in, so no redistributable is needed.

## Host requirements (Linux)

The AppImage bundles the application but not the desktop runtime. It needs GTK 3, WebKitGTK 4.1 (2.40 or newer),
libsoup 3 and JavaScriptCore 4.1, and glibc 2.35 or newer (Ubuntu 22.04, Debian 12 and Fedora qualify). No tray
library is needed. For example on Ubuntu 24.04:

```sh
sudo apt install libwebkit2gtk-4.1-0 libsoup-3.0-0 libjavascriptcoregtk-4.1-0
```

The app runs on X11, through XWayland on a Wayland desktop. Set `GDK_BACKEND=wayland` to override.

## Not covered yet

- Android builds are not part of this pipeline.
- Tabs cannot be dragged out into windows of their own yet; the Tauri shell has one window.
- AppImages are not code-signed. Windows packages need signing secrets for their channel (see above).
- The Linux update path has not been tested with a published release yet, and the Windows packages have not been
  installed on a Windows machine by the pipeline (see the verification notes in the pull request).
- Windows on ARM and the Microsoft Store are not covered. winget is a possible next step.
- Updates are verified only against the checksums published with each release.
