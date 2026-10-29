# Release and Channel Policy

Gemiredmine ships three release channels for Linux (Flatpak), Windows 11 (MSIX) and Android (APK). Each channel is a
separate application on each platform: it can be installed next to the others, and it keeps its own settings.

## Versions come from one place

`version` in `package.json` is the only version a person edits. Everything else is derived from it
and from the channel, by `scripts/release/channels.mjs`:

| Channel  | Built when                          | Version                          | Example                       |
|----------|-------------------------------------|----------------------------------|-------------------------------|
| Stable   | Stable workflow, started by hand    | `package.json` version (x.y.z)   | `1.0.0`                       |
| Canary   | Canary workflow, started by hand    | `x.y.z-rc.n`, written to `package.json` by the workflow | `1.0.0-rc.1`    |
| Unstable | Every push to `main`                | `<x.y.z>-unstable.<run number>`  | `1.0.0-unstable.42`           |

The version shown in the app's About screen, the Flatpak bundle file name, and the release tag all come
from this derivation.

## Channel rules

**Unstable** contains the last 3 builds of `main`. Each push to `main` builds an unstable Flatpak bundle,
publishes it as a pre-release tagged `unstable-v<version>`, and removes older unstable releases and
their tags.

**Canary** is a release candidate, started manually from any branch. The Canary workflow offers the choices
`next-rc` (the version in `package.json` with the next `rc.n`), `next-patch`, `next-minor` and `next-major`
(the next version up, starting at `rc.1`), and `manual` (a version typed into the form). Its version must be a
pre-release (`x.y.z-rc.n`) and newer than the latest stable release. Before the first stable release
any candidate is allowed. The canary channel only contains versions newer than the latest stable
release: when a stable release is published, older canary releases are removed.

**Stable** is started manually from `main`. Its version must be a plain `x.y.z` that has not been
released yet and is newer than the latest stable. Only the two newest stable releases are kept.
Stable builds never include the developer preview.

Each channel also has a pointer release (`unstable-latest`, `canary-latest`). It always holds the
newest build of that channel under a fixed file name, so a download link stays the same. Pointer
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
Only one package is installed per channel, and one copy of it runs: starting it again brings the open window forward. Settings live under `%LOCALAPPDATA%` in a folder named for
the channel, and the packaged app's data is private to its identity, so channels never share settings.
The app's database (`gemiredmine.db`: the servers the user added, and later the conversation history) is in
that folder, and an upgrade in place keeps it.
The webview keeps its own storage (local storage and caches, not Redmine data) in a folder named for the
package identity, below the same `%LOCALAPPDATA%`.
The API keys of the servers where the user chose "Remember me" are in Windows Credential Manager, named for the channel's identifier, not in
that folder. Uninstalling a channel from Windows Settings removes its package and its data; the Credential Manager entries of the user may stay.

MSIX versions have four numbers, so each build maps onto them in order: stable `1.2.0` becomes
`1.2.0.0`, canary `1.2.0-rc.3` becomes `1.2.0.3`, and unstable `1.2.0-unstable.42` becomes `1.2.0.42`.
Within a channel the version always increases, so every upgrade is accepted.

Windows packages are signed with one of two profiles, chosen by channel:

- **Canary and unstable: self-signed.** One certificate, created once and kept as a secret, so every
  build has the same publisher and upgrades work. Every build's own release (`unstable-v*`, `canary-v*`) and the
  channel's latest-build release (`unstable-latest`, `canary-latest`) attach the public certificate
  (`<app>-self-signed.cer`). Before installing, import it as an administrator into the Trusted People store:
  `Import-Certificate -FilePath <file>.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`.
- **Stable: trusted.** A publicly trusted code-signing certificate, so Windows installs the package without
  any manual step. Stable releases are refused unless they are signed this way.

Local builds are unsigned and cannot be installed. Set `REQUIRE_SIGNING=1` for release builds, which refuses
an unsigned package.

## Installing and updating on Linux

Each channel is a Flatpak bundle with its own application ID, desktop entry and settings folder:

| Channel  | Bundle                                    | Application ID                            |
|----------|-------------------------------------------|-------------------------------------------|
| Stable   | `Gemiredmine-<version>-x86_64.flatpak`    | `com.github.iVegas.Gemiredmine`           |
| Canary   | `Gemiredmine-Canary-<version>-x86_64.flatpak` | `com.github.iVegas.Gemiredmine.Canary` |
| Unstable | `Gemiredmine-Unstable-<version>-x86_64.flatpak` | `com.github.iVegas.Gemiredmine.Unstable` |

Install a bundle with `flatpak install --user ./<file>.flatpak`. Each channel's bundle is built in the Flatpak
environment image (`docker/flatpak/env.Dockerfile`), on the GNOME 51 runtime, with the Rust release that
`rust-toolchain.toml` pins. The sandbox grants the network, the Wayland socket, the GPU and the system keyring, and nothing else.

The app never downloads or replaces itself. To update, install a newer bundle of the same channel over the one you have.
Stable follows the latest stable release; canary and unstable follow their pointer releases (`canary-latest`,
`unstable-latest`), which always name the newest build under a fixed file name.

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
2. **Canary**: run the *Canary* workflow on the branch to build from, and choose the candidate. The workflow
   writes the version into `package.json`, commits and pushes it to that branch, then builds and tags that
   commit. Nothing is built or pushed when the version is refused. The branch must let the GitHub Actions bot
   push; on a protected branch, allow it in the protection rule.
3. **Stable**: set `version` in `package.json` to the release, for example `1.1.0`, merge it to
   `main`, then run the *Stable* workflow on `main`. The workflow creates the `v1.1.0` tag. The
   publish job uses the `stable-release` environment, so configure required reviewers there.

Each workflow validates the version against this policy before it builds anything.

## Host requirements (Windows 11)

Windows 11 (build 22000 or later) on x64. The app uses the WebView2 runtime, which ships with Windows 11. The
executable has the Visual C++ runtime and the WebView2 loader linked in, so no redistributable is needed.

## Host requirements (Linux)

The Flatpak bundles the application and takes its desktop runtime from Flathub (GNOME 51, which includes WebKitGTK 4.1).
No library needs to be installed on the host. A Flatpak installs the runtime on first use.

"Remember me" keeps the API key in the Secret Service (GNOME Keyring, KDE Wallet or another implementation of it), which a desktop session
normally provides. Without one, or when it cannot be reached, the app says so and the user signs in at every start. The Flatpak grants
access to it through the `org.freedesktop.secrets` service only.

The app runs natively on Wayland, and on X11 where that is the session. Wayland is the supported Linux session; X11 is not tested
and is not a target. The Flatpak does not choose between them (it sets no `GDK_BACKEND`), and a user can still set it.

## Not covered yet

- Putting a view window back in the main window: dragging the window's **tab** onto the main window's tabs, and **Move to main
  window**, work on a Wayland compositor (checked on a headless sway only; GNOME, KDE and NVIDIA machines are not checked). Dropping
  the window by its **title bar** needs screen positions, which Wayland does not give; it is for Windows, where it has not been tried.
  On Wayland the desktop decides where a new window opens.
- WebKitGTK can show a blank window on some systems with the proprietary NVIDIA driver. `WEBKIT_DISABLE_DMABUF_RENDERER=1` is the
  usual workaround; it is not set by the Flatpak and has not been tried here.
- "Remember me" has been tried against GNOME Keyring in a headless session on Linux only. Windows Credential Manager (from an installed MSIX
  package), KDE Wallet, and a keyring that asks the user to unlock it have not been tried. The app waits at most 30 seconds for the credential store.
- Task and log entry tabs show Redmine's text as typed: its markup is not rendered. They cannot be dragged into windows of their own.
- Flatpak bundles are not signed, and are not yet on Flathub. Windows packages need signing secrets for their channel (see above).
- The Linux update path has not been tested with a published release yet, and the Windows packages have not been
  installed on a Windows machine by the pipeline (see the verification notes in the pull request).
- Windows on ARM and the Microsoft Store are not covered. winget is a possible next step.
- Updates are verified only against the checksums published with each release.
