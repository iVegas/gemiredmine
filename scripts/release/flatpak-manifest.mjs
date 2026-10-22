#!/usr/bin/env node
// Writes the Flatpak manifest of one release channel as JSON, which flatpak-builder reads. The app is built inside the
// sandbox from the sources the generators list (cargo-sources.json, node-sources.json), so the build needs no network.
//
// Reads CHANNEL (default dev), GITHUB_RUN_NUMBER and GITHUB_SHA, as build-desktop.mjs does. Prints the manifest.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveBuildInfo } from './channels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Rust is not in the Flathub runtimes, so the manifest installs the release that rust-toolchain.toml pins. */
export const RUST = Object.freeze({
  version: '1.99.0',
  url: 'https://static.rust-lang.org/dist/rust-1.99.0-x86_64-unknown-linux-gnu.tar.xz',
  sha256: '891c6366d7100feda0bca4c03ce63f3c9ac827cbebbc283e7433061d42c6a376',
});

/** The Flathub branches: GNOME 51 and its freedesktop base 26.08, which provides Node 24. */
export const RUNTIME = Object.freeze({ platform: 'org.gnome.Platform', sdk: 'org.gnome.Sdk', version: '51' });
export const NODE_EXTENSION = 'org.freedesktop.Sdk.Extension.node24';

/** The app ID of a channel. Stable is the base ID; the other channels add a suffix, as their identifiers do. */
export function flatpakAppId(info) {
  const suffix = { stable: '', canary: '.Canary', unstable: '.Unstable', dev: '.Dev' }[info.channel];
  if (suffix === undefined) throw new Error(`No Flatpak app ID for channel "${info.channel}".`);
  return `com.github.iVegas.Gemiredmine${suffix}`;
}

/** The finish-args: the sandbox grants only what the app uses. Wayland is the target; X11 is not supported. */
export const FINISH_ARGS = Object.freeze([
  '--share=network', // Redmine servers
  '--share=ipc',
  '--socket=wayland',
  '--device=dri', // GPU rendering in WebKitGTK
  '--talk-name=org.freedesktop.secrets', // the sign-in is kept in the system keyring
]);

export function flatpakManifest(info, { env = process.env } = {}) {
  const appId = flatpakAppId(info);
  const appName = info.appName;
  const desktop = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${info.productName}`,
    `GenericName=Redmine client (${info.label} channel)`,
    `Comment=Redmine client, ${info.channel} channel`,
    `Exec=${appName}`,
    `Icon=${appId}`,
    'Terminal=false',
    'Categories=Development;',
    '',
  ].join('\n');

  return {
    'app-id': appId,
    runtime: RUNTIME.platform,
    'runtime-version': RUNTIME.version,
    sdk: RUNTIME.sdk,
    'sdk-extensions': [NODE_EXTENSION],
    command: appName,
    'finish-args': FINISH_ARGS,
    'build-options': {
      strip: false,
      'no-debuginfo': true,
      'append-path': '/usr/lib/sdk/node24/bin',
      env: {
        CHANNEL: info.channel,
        CARGO_NET_OFFLINE: 'true',
        GITHUB_RUN_NUMBER: env.GITHUB_RUN_NUMBER || '0',
        GITHUB_SHA: env.GITHUB_SHA || 'unknown',
      },
    },
    modules: [
      {
        name: 'rust',
        buildsystem: 'simple',
        'build-commands': ['./install.sh --prefix=/app --disable-ldconfig'],
        sources: [{ type: 'archive', url: RUST.url, sha256: RUST.sha256, 'strip-components': 1 }],
      },
      {
        name: appName,
        buildsystem: 'simple',
        'build-commands': [
          // The crates the generator vendored in cargo/vendor; Cargo is pointed at them, and may not use the network.
          'sh scripts/release/flatpak-vendor.sh',
          // The npm packages in flatpak-node/, installed without network.
          'npm ci --offline --ignore-scripts --cache "$PWD/flatpak-node/npm-cache"',
          'node scripts/release/build-desktop.mjs',
          `install -Dm755 src-tauri/target/release/${appName} /app/bin/${appName}`,
          `install -Dm644 assets/icons/${info.channel}.png /app/share/icons/hicolor/512x512/apps/${appId}.png`,
          `install -Dm644 ${appId}.desktop /app/share/applications/${appId}.desktop`,
        ],
        sources: [
          { type: 'dir', path: 'src' },
          // Each generator writes a list of sources: the entries are added to the build, not copied as a file.
          'cargo-sources.json',
          'node-sources.json',
          { type: 'inline', contents: desktop, 'dest-filename': `${appId}.desktop` },
        ],
      },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const info = deriveBuildInfo({
    packageVersion: version,
    channel: process.env.CHANNEL || 'dev',
    platform: 'linux',
    buildNumber: Number(process.env.GITHUB_RUN_NUMBER || 0),
    buildDate: process.env.BUILD_DATE || new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify(flatpakManifest(info), null, 2)}\n`);
}
