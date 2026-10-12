# gemiredmine

[![Version](https://img.shields.io/github/package-json/v/iVegas/gemiredmine)](https://github.com/iVegas/gemiredmine)
[![License](https://img.shields.io/github/license/iVegas/gemiredmine)](https://github.com/iVegas/gemiredmine)
[![Tests](https://github.com/iVegas/gemiredmine/actions/workflows/weekly-tests.yml/badge.svg)](https://github.com/iVegas/gemiredmine/actions/workflows/weekly-tests.yml)

**gemiredmine** is a cross-platform (Ubuntu & Android) client for Redmine, built with Svelte, Tailwind CSS v4, and Electrobun. It features a modern, accessibility-first design and integrates seamlessly with Google's Gemini AI to enhance your workflow.

## 🚀 Download

Gemiredmine ships as an AppImage for Linux, in three release channels. Each channel can be
installed next to the others.

| Channel  | Who it is for                                  | Where to get it |
|----------|------------------------------------------------|-----------------|
| Stable   | Everyday use                                   | [Releases](https://github.com/iVegas/gemiredmine/releases) (marked *Latest*) |
| Canary   | Testing the next stable release (release candidates) | [Releases](https://github.com/iVegas/gemiredmine/releases) (`canary-v*`) |
| Unstable | Following `main`, built on every change        | [Releases](https://github.com/iVegas/gemiredmine/releases) (`unstable-v*`) |

Make the AppImage executable and run it. Updates are not downloaded by the app itself; use
`AppImageUpdate`, or the release page, to get a newer version. See
[`RELEASE_POLICY.md`](./RELEASE_POLICY.md) for the channel rules and host requirements.

Android builds are not part of the current release pipeline.

## ✨ Features

- **Cross-Platform Support:** Native-feeling applications for Ubuntu (via Electrobun) and Android (via Capacitor).
- **Multi-Server Management:** Easily connect to and switch between multiple independent Redmine backend servers.
- **Deep Gemini AI Integration:** A cloud-first, configurable integration with Gemini to manage routines such as time logging, reminders, task updates, and wiki editing.
- **Accessibility-First UI:** A beautiful, responsive interface built with Svelte and Tailwind CSS v4, prioritizing accessibility for all users.
- **Secure Authentication:** Uses password login to securely retrieve API tokens, ensuring passwords aren't stored by default. KeePass authentication is also supported as an option for secure credential management.
- **In-App Feedback:** Integrated flow to seamlessly create feature requests directly on the project's repository.
- **Developer Preview (canary, unstable and dev builds):** Opt-in, off by default. Keeps a small rotated log of aggregated events, with credentials removed, and turns feedback into a prefilled GitHub issue. Stable builds do not include it.
- **About Screen:** Shows the version, channel, commit, build date and settings folder. Each channel keeps its own settings.

## 🛠️ Setup & Post-Installation

Once you have downloaded and installed **gemiredmine**, follow these steps to get started:

1. **Add Your Redmine Server:** Open the app and add the URL of your Redmine server. You can manage multiple server connections and easily switch between them.
2. **Authenticate:** Enter your Redmine login and password. The app will use this to retrieve your API token and will not store your password by default. (Alternatively, you can use the KeePass integration).
3. **Configure Gemini AI:** To utilize the AI features, navigate to the settings and configure your Gemini API integration. This will enable smart time logging, reminders, and context-aware task assistance.
4. **Start Working:** You are all set! You can now manage your Redmine tasks, log time with Gemini's assistance, and switch servers as needed.

## 🏗️ Architecture

- **Frontend:** Svelte (built with Vite) and Tailwind CSS v4. Source code is located in `src/mainview/` and builds to `views/mainview/`.
- **Backend/Desktop wrapper:** Electrobun via Bun. Source code is located in `src/bun/`.
- **Mobile wrapper:** Capacitor for Android synchronization.
- **Testing:** Vitest and `@testing-library/svelte` for unit tests, Playwright for UI/E2E testing.

## 🤝 Contributing

We welcome contributions! Please review our [`CONTRIBUTING.md`](./CONTRIBUTING.md) for detailed guidelines.

### Development Setup

1. **Install Node.js 24** and run `npm ci` to install dependencies. `package-lock.json` is the lockfile.
2. **Run tests:** `npm test`. It regenerates the build metadata first.
3. **Type check:** `npm run typecheck`.
4. **Run the webview in a browser:** `npm run dev` (Vite).
5. **Build:**
   - Webview: `npm run build`
   - Desktop app (Electrobun): `npm run build:electrobun`. Set `CHANNEL=stable|canary|unstable|dev` to build a channel. The default is `dev`.
   - Linux AppImage: `CHANNEL=<channel> npm run build:electrobun && CHANNEL=<channel> node scripts/release/package-linux.mjs`. Packaging needs `zsync` installed and downloads a pinned `appimagetool`.
   - Android (Capacitor): `npx cap sync android`

The version is set only in `version` in `package.json`. The app's name, identifier, settings folder and
version are derived from it at build time (see `scripts/release/channels.mjs`).

## 📄 License

This project is licensed under the [ISC License](./package.json).
