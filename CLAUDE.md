# gemiredmine

A Redmine client: a Svelte 5 + Vite + Tailwind 4 webview (`src/mainview/`), a TypeScript backend that talks to
Redmine (`src/bun/`, which runs inside the webview), shared types (`src/shared/`), and a Tauri 2 desktop shell
(`src-tauri/`). See `README.md` for the product and `CONTRIBUTING.md` for the workflow.

## Active work: finishing the move to Tauri 2

Read `docs/tauri-migration/progress.md` first. It says what is done, what is next, the open questions, and has
recipes for running the app and a mock Redmine. `docs/tauri-migration/plan.md` has the decisions and the full spec of
the remaining work. When you finish a step, update `progress.md` in the same pull request.

## Commands

- `npm ci` (set `HUSKY=0` if you do not want the git hooks), then `npm test` and `npm run typecheck`.
- `npm test` first regenerates the build info for `$CHANNEL` (`stable`, `canary`, `unstable` or `dev`, default `dev`).
  A plain `npx tsc` or `npx vitest` does not; run `node scripts/release/write-build-info.mjs` if the generated
  `*.generated.ts` files are stale.
- `node scripts/dev/mock-redmine.mjs` starts a fake Redmine (sign in as `alice` / `secret`).
- `npm run tauri dev` runs the desktop app; `CHANNEL=<channel> npm run build:desktop` builds it.
  `cargo test --manifest-path src-tauri/Cargo.toml --lib` tests the Rust crate (system packages: see the README).

## Rules

- Commits follow Conventional Commits and are checked by commitlint (header and body lines up to 100 characters).
- The version lives only in `version` in `package.json`. Do not create release tags by hand (`RELEASE_POLICY.md`).
- The backend files named in `src/bun/__tests__/webview-safe.spec.ts` must not use `node:` imports, `Buffer`,
  `process` or `Bun`, because the backend runs inside a webview. Platform code goes next to `src/mainview/lib/tauri-platform.ts`.
- Two golden snapshots pin what users keep across updates: release identities
  (`scripts/release/__tests__/release-identity.golden.test.ts`) and the developer preview's data folder
  (`src/bun/diagnostics/__tests__/data-dir.golden.spec.ts`). Change a snapshot only when the change is intended.
