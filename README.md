# gemiredmine

[![Version](https://img.shields.io/github/package-json/v/iVegas/gemiredmine)](https://github.com/iVegas/gemiredmine)
[![License](https://img.shields.io/github/license/iVegas/gemiredmine)](https://github.com/iVegas/gemiredmine)
[![Tests](https://github.com/iVegas/gemiredmine/actions/workflows/weekly-tests.yml/badge.svg)](https://github.com/iVegas/gemiredmine/actions/workflows/weekly-tests.yml)

**gemiredmine** is a cross-platform (Ubuntu & Android) client for Redmine, built with Svelte, Tailwind CSS v4, and Tauri 2. It features a modern, accessibility-first design and integrates seamlessly with Google's Gemini AI to enhance your workflow.

## 🚀 Download

Gemiredmine ships as a Flatpak for Linux and as an APK for Android, in three release channels. Each channel can be
installed next to the others.

| Channel  | Who it is for                                  | Where to get it |
|----------|------------------------------------------------|-----------------|
| Stable   | Everyday use                                   | [Releases](https://github.com/iVegas/gemiredmine/releases) (marked *Latest*) |
| Canary   | Testing the next stable release (release candidates) | [Releases](https://github.com/iVegas/gemiredmine/releases) (`canary-v*`) |
| Unstable | Following `main`, built on every change        | [Releases](https://github.com/iVegas/gemiredmine/releases) (`unstable-v*`) |

**Linux:** install the bundle with `flatpak install --user ./<file>.flatpak` and run it. Updates are not downloaded by
the app itself; install a newer bundle of the same channel, or use the release page, to get a newer version.

**Windows 11:** canary and unstable packages are signed with a self-signed certificate. First import the
public certificate attached to the release, as an administrator:
`Import-Certificate -FilePath <file>.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`.
Then open the App Installer link for the channel you want. Windows keeps the channel up to date from that link.
The links are listed in [`RELEASE_POLICY.md`](./RELEASE_POLICY.md). Channels install side by side, one package per channel.

See [`RELEASE_POLICY.md`](./RELEASE_POLICY.md) for the channel rules and host requirements.

Android builds are not part of the current release pipeline.

## ✨ Features

- **Cross-Platform Support:** Native-feeling applications for Ubuntu and Windows (via Tauri 2) and Android (via Capacitor).
- **Multi-Server Management:** Easily connect to and switch between multiple independent Redmine backend servers. The servers you add are kept for the next start, in a database in the settings folder. Passwords are never kept. With **Remember me on this computer** (checked by default, and chosen per server) only the API key is kept, in the system's credential store (Windows Credential Manager, or the Secret Service of GNOME Keyring and KDE Wallet), so you are signed in at the next start; without it, or where there is no credential store, you sign in again, and the form starts with the user name you used last time.
- **Dashboard and View Tabs:** The dashboard is pinned as the first tab and previews your calendar and to-do list. Select a preview to open the full view in its own tab; every tab except the dashboard can be closed.
- **Movable Tabs and View Windows:** Drag a tab to put it in another place, or press Ctrl+Shift+Page Up or Ctrl+Shift+Page Down. In the desktop app, drag a tab out of the window to open the view in a window of its own. To put it back, drag the tab in that window onto the main window's tabs and release it where the tab should go, or select **Move to main window**. Where the desktop reports window positions (Windows), you can also drag the window itself by its title bar onto the tabs. On Wayland your desktop decides where the new window opens, and the tab and the button are the ways back.
- **Calendar:** Time you logged and open tasks due, by day, for any month.
- **To-do List:** Every open task assigned to you across all projects, grouped by priority, with overdue tasks highlighted.
- **Task and Log Entry Details:** Select a task (in the to-do list, the dashboard or the calendar) or a time entry (in the calendar) to open it in a tab: the task's facts, description, subtasks, relations, files, the time logged on it and its history, or the entry's time, day, activity, task and comment. A tab stays with the server it was opened on.
- **One Window per App:** Starting the app a second time brings the open one forward instead of opening another.
- **Deep Gemini AI Integration:** A cloud-first, configurable integration with Gemini to manage routines such as time logging, reminders, task updates, and wiki editing.
- **Accessibility-First UI:** A beautiful, responsive interface built with Svelte and Tailwind CSS v4, prioritizing accessibility for all users.
- **Secure Authentication:** Uses password login to securely retrieve API tokens, ensuring passwords aren't stored by default. KeePass authentication is also supported as an option for secure credential management.
- **In-App Feedback:** Integrated flow to seamlessly create feature requests directly on the project's repository.
- **Developer Preview (canary, unstable and dev builds):** Opt-in, off by default. Keeps a small rotated log of aggregated events, with credentials removed, and turns feedback into a prefilled GitHub issue. Stable builds do not include it.
- **About Screen:** Shows the version, channel, commit, build date and settings folder. Each channel keeps its own settings.

## 🛠️ Setup & Post-Installation

Once you have downloaded and installed **gemiredmine**, follow these steps to get started:

1. **Add Your Redmine Server:** On first start the app welcomes you and asks for your Redmine server. Add more servers, switch between them, sign out or remove them in **Settings**. Every view of the app — Dashboard, Calendar, To-do, Assistant and Settings — is one click away in the navigation bar at the top left; the user menu in the top right shows the current server, lets you switch the server context and opens the About screen.
2. **Authenticate:** Enter your Redmine login and password. The app will use this to retrieve your API token and never stores your password. The API token is kept in your system's credential store only if **Remember me on this computer** is checked (it is by default). (Alternatively, you can use the KeePass integration).
3. **Configure Gemini AI:** Open **Settings** and look at **AI assistant**. It first says what this computer already offers: a model this device can run itself, a local server such as Ollama, LM Studio or Lemonade that is running, and any API key the computer is already set up with. One click uses what it found. Otherwise choose a service, where a link takes you straight to the page that hands out a key. See [`docs/ai-assistant.md`](./docs/ai-assistant.md).
4. **Start Working:** You are all set! You can now manage your Redmine tasks, log time with Gemini's assistance, and switch servers as needed.

## 🏗️ Architecture

- **Frontend:** Svelte (built with Vite) and Tailwind CSS v4. Source code is located in `src/mainview/` and builds to `views/mainview/`.
- **Backend:** TypeScript that talks to Redmine. Source code is located in `src/bun/` (the folder name is historical). It runs inside the webview.
- **Desktop wrapper:** Tauri 2. The Rust crate in `src-tauri/` only wires up Tauri's HTTP, file, opener, SQL and single-instance plugins and the system's credential store; the app is not written in Rust.
- **Storage:** A SQLite database (`gemiredmine.db`) in each channel's settings folder, with versioned migrations, in `src/bun/storage/`. It holds the configuration now and will hold the history of the Gemini conversations.
- **Mobile wrapper:** Capacitor for Android synchronization.
- **Testing:** Vitest and `@testing-library/svelte` for unit tests, Playwright for UI/E2E testing.

## 🤝 Contributing

We welcome contributions! Please review our [`CONTRIBUTING.md`](./CONTRIBUTING.md) for detailed guidelines.

### Development Setup

1. **Install Node.js 24** and run `npm ci` to install dependencies. `package-lock.json` is the lockfile.
2. **Run tests:** `npm test`. It regenerates the build metadata first.
3. **Type check:** `npm run typecheck`.
4. **Run the webview in a browser:** `npm run dev` (Vite). Redmine calls need the desktop app, so use the next step for real data.
5. **Install what the desktop app needs:**
   - Rust: install [rustup](https://rustup.rs). It installs the version pinned in `rust-toolchain.toml` by itself.
   - Ubuntu or Debian: `sudo apt install libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.
   - Windows 11: the Visual Studio C++ build tools. WebView2 ships with Windows.
6. **Run the desktop app:** `npm run tauri dev`. It starts Vite and the app, which reloads with the page. To try it without a Redmine server, run `node scripts/dev/mock-redmine.mjs` and sign in as `alice` with the password `secret`.
7. **Build:**
   - Webview: `npm run build`
   - Desktop app: `npm run build:desktop`. Set `CHANNEL=stable|canary|unstable|dev` to build a channel. The default is `dev`. The executable is `src-tauri/target/release/<app name>`.
   - Linux Flatpak, in isolation: `docker build -f docker/flatpak/env.Dockerfile -t gemiredmine-flatpak-env .`, then `docker run --rm --privileged -v "$PWD:/work" -e CHANNEL=<channel> gemiredmine-flatpak-env scripts/release/flatpak-build.sh`, then `CHANNEL=<channel> node scripts/release/package-flatpak.mjs`. The host needs only Docker.
   - Windows 11 MSIX (on Windows): `set TARGET_PLATFORM=windows` (PowerShell: `$env:TARGET_PLATFORM='windows'`), then `CHANNEL=<channel>` with `npm run build:desktop` and `node scripts/release/package-windows.mjs`. It needs the Windows SDK tools; without `WINDOWS_SIGNING` the package is unsigned.
   - Android (Capacitor): `npx cap sync android`

On Linux the app runs natively on Wayland, and on X11 where that is the session, though X11 is not a target. The state of the Tauri migration is in [`docs/tauri-migration/`](./docs/tauri-migration/progress.md).

The version is set only in `version` in `package.json`. The app's name, identifier, settings folder and
version are derived from it at build time (see `scripts/release/channels.mjs`).

## 📄 License

This project is licensed under the [ISC License](./package.json).
