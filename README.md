# gemiredmine

[![Version](https://img.shields.io/github/package-json/v/iVegas/gemiredmine)](https://github.com/iVegas/gemiredmine)
[![License](https://img.shields.io/github/license/iVegas/gemiredmine)](https://github.com/iVegas/gemiredmine)
[![Tests](https://github.com/iVegas/gemiredmine/actions/workflows/weekly-tests.yml/badge.svg)](https://github.com/iVegas/gemiredmine/actions/workflows/weekly-tests.yml)

**gemiredmine** is a cross-platform (Ubuntu & Android) client for Redmine, built with Svelte, Tailwind CSS v4, and Electrobun. It features a modern, accessibility-first design and integrates seamlessly with Google's Gemini AI to enhance your workflow.

## 🚀 Download

The latest client builds for Ubuntu (Linux tar.gz) and Android (APK) are automatically built via GitHub Actions and are available on the GitHub Releases page:

**[Download gemiredmine on GitHub Releases](https://github.com/iVegas/gemiredmine/releases)**

*(Note: Our release policy limits downloads to the 5 most recent versions: 3 patch versions including the latest, 1 previous minor version, and 1 previous major version.)*

## ✨ Features

- **Cross-Platform Support:** Native-feeling applications for Ubuntu (via Electrobun) and Android (via Capacitor).
- **Multi-Server Management:** Easily connect to and switch between multiple independent Redmine backend servers.
- **Deep Gemini AI Integration:** A cloud-first, configurable integration with Gemini to manage routines such as time logging, reminders, task updates, and wiki editing.
- **Accessibility-First UI:** A beautiful, responsive interface built with Svelte and Tailwind CSS v4, prioritizing accessibility for all users.
- **Secure Authentication:** Uses password login to securely retrieve API tokens, ensuring passwords aren't stored by default. KeePass authentication is also supported as an option for secure credential management.
- **In-App Feedback:** Integrated flow to seamlessly create feature requests directly on the project's repository.

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

1. **Install Bun:** The project relies on Bun for package management and Electrobun builds.
2. **Install Dependencies:** Run `bun install` to set up the development environment.
3. **Run Tests:** Use `npm test` or `npx vitest run` to run unit tests. *(Note: `bun test` is incompatible with some Vitest mocking features used in this project)*.
4. **Run Development Server:** `npm run dev` to start the Vite frontend.
5. **Build Application:**
   - Frontend: `npm run build`
   - Linux (Electrobun): `npm run build:electrobun`
   - Android (Capacitor): `npx cap sync android`

## 📄 License

This project is licensed under the [ISC License](./package.json).
