import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUST_BUILD_ONLY, flatpakManifest } from '../flatpak-manifest.mjs';
import { deriveBuildInfo } from '../channels.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const info = deriveBuildInfo({ packageVersion: '1.0.0', channel: 'unstable', buildNumber: 17, buildDate: '2026-10-23T00:00:00.000Z' });
const modules = (flatpakManifest(info, { env: {} }) as { modules: Array<Record<string, unknown>> }).modules;

describe('the Flatpak manifest', () => {
  it('builds Rust first, and removes the compiler from the finished app', () => {
    const [rust, app] = modules;
    expect(rust.name).toBe('rust');
    expect(rust.cleanup).toEqual([...RUST_BUILD_ONLY]);
    expect(RUST_BUILD_ONLY).toEqual(expect.arrayContaining(['/bin/rust*', '/bin/cargo*', '/lib/rustlib']));
    // The app itself has no cleanup: it is what is shipped.
    expect(app.cleanup).toBeUndefined();
  });

  it('never removes the app binary or its desktop entry', () => {
    const binary = `/bin/${info.appName}`;
    const matches = (pattern: string, path: string) =>
      new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(path);
    for (const pattern of RUST_BUILD_ONLY) {
      expect(matches(pattern, binary), pattern).toBe(false);
      expect(matches(pattern, `/share/applications/${info.appName}.desktop`), pattern).toBe(false);
    }
  });
});

describe('flatpak-build.sh', () => {
  it('gives the bundle back to the owner of the checkout, after the bundle is written', () => {
    const script = read('scripts', 'release', 'flatpak-build.sh');
    const bundle = script.indexOf('flatpak build-bundle');
    const chown = script.indexOf('chown -R "$(stat -c \'%u:%g\' /work)" /work/dist');
    expect(chown).toBeGreaterThan(bundle);
    expect(bundle).toBeGreaterThan(-1);
  });

  it('runs the installed app under its own D-Bus session, which the icon loader needs', () => {
    const script = read('scripts', 'release', 'smoke-test-flatpak.sh');
    expect(script).toContain('dbus-run-session -- flatpak run');
    expect(script).toContain('command -v dbus-run-session');
  });

  it('finds the app window in both libwayland log formats and under both app IDs', () => {
    const script = read('scripts', 'release', 'smoke-test-wayland.sh');
    expect(script).toContain('xdg_toplevel[@#][0-9]*\\.set_app_id("[^"]*Gemiredmine');
    // The same pattern, as a JavaScript regex, against lines of the log.
    const match = new RegExp('xdg_toplevel[@#][0-9]*\\.set_app_id\\("[^"]*Gemiredmine');
    expect(match.test('xdg_toplevel#14.set_app_id("com.github.iVegas.Gemiredmine.Unstable")')).toBe(true);
    expect(match.test('xdg_toplevel@3.set_app_id("Gemiredmine-Unstable")')).toBe(true);
    expect(match.test('xdg_toplevel#14.set_min_size(122, 37)')).toBe(false);
  });
});
