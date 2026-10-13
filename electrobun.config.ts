import type { ElectrobunConfig } from 'electrobun';
import { readFileSync } from 'node:fs';
import { deriveBuildInfo, hostPlatform } from './scripts/release/channels.mjs';

// Version, name and identifier all come from the same derivation the app uses
// (package.json is the single hand-edited version source).
const { version: packageVersion } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const channel = process.env.CHANNEL || 'dev';
const info = deriveBuildInfo({
  packageVersion,
  channel,
  platform: process.env.TARGET_PLATFORM || hostPlatform(),
  buildNumber: Number(process.env.GITHUB_RUN_NUMBER || 0),
  buildDate: process.env.BUILD_DATE || new Date().toISOString(),
});

export default {
  app: {
    name: info.appName,
    identifier: info.identifier,
    version: info.version,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // The webview is compiled by Vite (Svelte components need its plugin), so the desktop
    // window loads Vite's output. Run `npm run build` first; `build:electrobun` does that.
    copy: {
      "views/mainview": "views/mainview",
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
      icon: `assets/icons/${channel}.png`,
    },
    win: {
      bundleCEF: false,
      icon: `assets/icons/${channel}.ico`,
    },
  },
  // Updates are delivered by the platform (AppImageUpdate, package managers),
  // never by Electrobun's built-in updater, so no release feed is configured.
  release: {
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
