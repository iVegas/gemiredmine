import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS, deriveBuildInfo } from '../channels.mjs';
import { androidBuildFeatures, tauriAndroidConfig, tauriBuildArgs, tauriChannelConfig } from '../tauri-config.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const TAURI_DIR = join(ROOT, 'src-tauri');
const baseConfig = JSON.parse(readFileSync(join(TAURI_DIR, 'tauri.conf.json'), 'utf8'));

const VERSIONS: Record<string, string> = { stable: '1.0.0', canary: '1.0.0-rc.3', unstable: '1.0.0', dev: '1.0.0' };

const infoFor = (channel: keyof typeof CHANNELS) =>
  deriveBuildInfo({ packageVersion: VERSIONS[channel], channel, buildNumber: 42, buildDate: '2026-01-02T03:04:05.000Z' });

/** RFC 7386 JSON Merge Patch, which is what `tauri build --config` applies. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result: Record<string, unknown> = { ...(target && typeof target === 'object' && !Array.isArray(target) ? target : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

function containsKey(value: unknown, key: string): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  return Object.entries(value).some(([k, v]) => k === key || containsKey(v, key));
}

const containsNull = (value: unknown): boolean =>
  value === null || (typeof value === 'object' && Object.values(value as object).some(containsNull));

describe.each(Object.entries(CHANNELS))('tauriChannelConfig for %s', (channel, channelConfig) => {
  const info = infoFor(channel as keyof typeof CHANNELS);
  const overlay = tauriChannelConfig(info);

  it('carries the channel identity', () => {
    expect(overlay).toMatchObject({
      productName: channelConfig.productName,
      mainBinaryName: channelConfig.appName,
      identifier: `com.gemiredmine.app${channelConfig.identifierSuffix}`,
      version: info.version,
    });
  });

  it('describes the whole main window, because arrays are replaced whole', () => {
    expect(overlay.app.windows).toEqual([
      { label: 'main', title: channelConfig.productName, width: 1024, height: 768, dragDropEnabled: false },
    ]);
  });

  it('enables the developer preview capability only where the preview exists', () => {
    const windowCapabilities = ['backend', 'main', 'view-window', 'storage'];
    expect(overlay.app.security.capabilities).toEqual(
      channelConfig.devPreviewAvailable ? [...windowCapabilities, `dev-preview-${channel}`] : windowCapabilities
    );
  });

  it('uses the channel icons, which exist', () => {
    expect(overlay.bundle.icon).toEqual([`../assets/icons/${channel}.png`, `../assets/icons/${channel}.ico`]);
    for (const icon of overlay.bundle.icon) expect(existsSync(join(TAURI_DIR, icon)), icon).toBe(true);
  });

  it('never deletes a key or touches the CSP', () => {
    expect(containsNull(overlay)).toBe(false);
    expect(containsKey(overlay, 'csp')).toBe(false);
    expect(containsKey(overlay, 'devCsp')).toBe(false);
  });
});

describe('the base config', () => {
  it('is the dev channel, apart from the version that Tauri reads from package.json', () => {
    const merged = mergePatch(baseConfig, tauriChannelConfig(infoFor('dev')));
    expect(merged).toEqual({ ...baseConfig, version: infoFor('dev').version });
    expect(baseConfig.version).toBe('../package.json');
  });

  it('ships a content security policy that stays closed to the network', () => {
    const csp: string = baseConfig.app.security.csp;
    expect(csp).toContain("default-src 'self'");
    // Redmine requests go through the Rust HTTP plugin, so the webview itself connects to nothing.
    expect(csp).toMatch(/connect-src ipc: http:\/\/ipc\.localhost(;|$)/);
    expect(csp).not.toMatch(/\*|unsafe-eval|https?:\/\/(?!ipc\.localhost)/);
    // The Vite dev server needs inline scripts and a websocket, so only the dev CSP is open.
    expect(baseConfig.app.security.devCsp).toBeNull();
  });

  it('builds the web assets and loads them from the folder Vite writes', () => {
    expect(baseConfig.build).toMatchObject({ frontendDist: '../views/mainview', beforeBuildCommand: 'npm run build' });
    expect(baseConfig.bundle.active).toBe(false);
  });
});

describe('tauriBuildArgs', () => {
  const paths = { cli: '/cli/tauri.js', overlayPath: '/build/tauri.x.conf.json' };

  it.each(Object.keys(CHANNELS))('builds the bare executable with the %s overlay and a locked Cargo.lock', (channel) => {
    const args = tauriBuildArgs(infoFor(channel as keyof typeof CHANNELS), paths);
    expect(args.slice(0, 5)).toEqual(['/cli/tauri.js', 'build', '--no-bundle', '--config', '/build/tauri.x.conf.json']);
    expect(args.slice(-2)).toEqual(['--', '--locked']);
  });

  it('enables developer tools in every channel but stable', () => {
    for (const channel of Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]) {
      const args = tauriBuildArgs(infoFor(channel), paths);
      expect(args.includes('--features'), channel).toBe(channel !== 'stable');
      if (channel !== 'stable') expect(args[args.indexOf('--features') + 1]).toBe('devtools');
    }
  });
});

describe.each(Object.entries(CHANNELS))('tauriAndroidConfig for %s', (channel) => {
  const info = infoFor(channel as keyof typeof CHANNELS);
  const config = tauriAndroidConfig(info);

  it('uses the channel identifier, name and version, as the desktop build does', () => {
    expect(config.identifier).toBe(info.identifier);
    expect(config.productName).toBe(info.productName);
    expect(config.version).toBe(info.version);
  });

  it('grants the same capabilities as the desktop build of the channel', () => {
    expect(config.app.security.capabilities).toEqual(tauriChannelConfig(info).app.security.capabilities);
  });
});

describe('the Android identifiers', () => {
  it('keep stable on the identifier users already have, and give each other channel its own', () => {
    expect(infoFor('stable').identifier).toBe('com.gemiredmine.app');
    expect(infoFor('canary').identifier).toBe('com.gemiredmine.app.canary');
    expect(infoFor('unstable').identifier).toBe('com.gemiredmine.app.unstable');
  });

  it('builds the developer tools only into the channels that have the developer preview', () => {
    expect(androidBuildFeatures(infoFor('dev'))).toEqual(['devtools']);
    expect(androidBuildFeatures(infoFor('stable'))).toEqual([]);
  });
});
