import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from '../channels.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
const readJson = (...parts: string[]) => JSON.parse(read(...parts));

type Permission = string | { identifier: string; allow?: { url?: string; path?: string }[] };
const capabilitiesDir = join('src-tauri', 'capabilities');
const capabilityFiles = readdirSync(join(ROOT, capabilitiesDir)).filter((file) => file.endsWith('.json'));
const capability = (name: string): { identifier: string; windows: string[]; permissions: Permission[] } =>
  readJson(capabilitiesDir, `${name}.json`);
const identifier = (permission: Permission) => (typeof permission === 'string' ? permission : permission.identifier);

const previewChannels = Object.entries(CHANNELS).filter(([, config]) => config.devPreviewAvailable);

describe('capabilities', () => {
  it('has the window capabilities and one preview capability per channel that offers the preview', () => {
    expect(capabilityFiles.sort()).toEqual(
      ['backend.json', 'main.json', 'storage.json', 'view-window.json', ...previewChannels.map(([channel]) => `dev-preview-${channel}.json`)].sort()
    );
    for (const file of capabilityFiles) {
      expect(capability(file.replace(/\.json$/, '')).identifier).toBe(file.replace(/\.json$/, ''));
    }
  });

  it('gives each kind of window only what it needs', () => {
    expect(capability('backend').windows).toEqual(['main', 'view-*']);
    expect(capability('main').windows).toEqual(['main']);
    expect(capability('view-window').windows).toEqual(['view-*']);
    // The configuration belongs to the main window too. A view window gets its servers from it.
    expect(capability('storage').windows).toEqual(['main']);
    // The developer preview belongs to the main window, so view windows never touch files.
    for (const [channel] of previewChannels) expect(capability(`dev-preview-${channel}`).windows).toEqual(['main']);
  });

  it('lets only the main window create, focus and close windows', () => {
    expect(capability('main').permissions).toEqual([
      'core:webview:allow-create-webview-window',
      'core:window:allow-set-focus',
      'core:window:allow-unminimize',
      'core:window:allow-close',
    ]);
    // A view window is dragged by its header. It cannot open or close windows, or move them around.
    expect(capability('view-window').permissions).toEqual(['core:window:allow-start-dragging']);
  });

  it('lets the webview reach any host and port over http(s), because it is the user server', () => {
    // A pattern without a port only matches the default port, and Redmine often runs on 8080 or 3000.
    const http = capability('backend').permissions.find((p) => identifier(p) === 'http:default');
    expect(http).toEqual({ identifier: 'http:default', allow: [{ url: 'http://*:*' }, { url: 'https://*:*' }] });
  });

  it('opens only web links in the system browser', () => {
    // The opener scope is a glob, not a URL pattern, so `*` already covers any port and path.
    const opener = capability('backend').permissions.filter((p) => identifier(p).startsWith('opener:'));
    expect(opener).toEqual([{ identifier: 'opener:allow-open-url', allow: [{ url: 'http://*' }, { url: 'https://*' }] }]);
  });

  it('lets the main window read and write its database, and nothing else about it', () => {
    // No `sql:default` and no `sql:allow-close`: the plugin closes its pools when the app ends.
    expect(capability('storage').permissions).toEqual(['sql:allow-load', 'sql:allow-select', 'sql:allow-execute']);
    for (const name of ['backend', 'main', 'view-window']) {
      expect(capability(name).permissions.map(identifier).filter((id) => id.startsWith('sql:')), name).toEqual([]);
    }
  });

  it('keeps file access out of the window capabilities', () => {
    for (const name of ['backend', 'main', 'storage', 'view-window']) {
      expect(capability(name).permissions.map(identifier).filter((id) => id.startsWith('fs:')), name).toEqual([]);
    }
  });

  it.each(previewChannels)('limits the %s preview to that channel data folder', (channel, config) => {
    const permissions = capability(`dev-preview-${channel}`).permissions;
    const scope = permissions.find((p) => identifier(p) === 'fs:scope') as Extract<Permission, object>;
    expect(scope.allow).toEqual([
      { path: `$LOCALDATA/${config.dataDirName}` },
      { path: `$LOCALDATA/${config.dataDirName}/**` },
    ]);
    // Explicit file operations only: no `fs:default`, no read-everywhere shortcuts.
    expect(permissions.map(identifier).filter((id) => id !== 'fs:scope')).toEqual([
      'fs:allow-exists',
      'fs:allow-stat',
      'fs:allow-mkdir',
      'fs:allow-read-file',
      'fs:allow-write-file',
      'fs:allow-read-dir',
      'fs:allow-rename',
      'fs:allow-remove',
    ]);
  });

  it('uses no text-file permissions, which Tauri 3 removes', () => {
    for (const file of capabilityFiles) expect(read(capabilitiesDir, file)).not.toContain('text-file');
  });

  it('enables, in the base config, the capabilities of the dev channel and no other', () => {
    expect(readJson('src-tauri', 'tauri.conf.json').app.security.capabilities).toEqual([
      'backend',
      'main',
      'view-window',
      'storage',
      'dev-preview-dev',
    ]);
  });
});

/** `name -> version` for the packages of a Cargo.lock. */
function lockedCrates(): Map<string, string> {
  const crates = new Map<string, string>();
  for (const block of read('src-tauri', 'Cargo.lock').split('[[package]]').slice(1)) {
    const name = /^name = "(.+)"$/m.exec(block)?.[1];
    const version = /^version = "(.+)"$/m.exec(block)?.[1];
    if (name && version) crates.set(name, version);
  }
  return crates;
}

const majorMinor = (version: string) => version.split('.').slice(0, 2).join('.');

describe('versions', () => {
  const pkg = readJson('package.json');
  const npm = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  const tauriPackages = Object.keys(npm).filter((name) => name.startsWith('@tauri-apps/'));

  it('pins every Tauri npm package exactly', () => {
    expect(tauriPackages.sort()).toEqual([
      '@tauri-apps/api',
      '@tauri-apps/cli',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-http',
      '@tauri-apps/plugin-opener',
      '@tauri-apps/plugin-sql',
    ]);
    for (const name of tauriPackages) expect(npm[name], name).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps each npm package on the same minor version as its crate', () => {
    // The API, CLI and plugins check each other at build time and fail on a mismatched minor.
    const crates = lockedCrates();
    const pairs: [string, string][] = [
      ['@tauri-apps/api', 'tauri'],
      ['@tauri-apps/cli', 'tauri'],
      ['@tauri-apps/plugin-http', 'tauri-plugin-http'],
      ['@tauri-apps/plugin-fs', 'tauri-plugin-fs'],
      ['@tauri-apps/plugin-opener', 'tauri-plugin-opener'],
      ['@tauri-apps/plugin-sql', 'tauri-plugin-sql'],
    ];
    for (const [npmName, crate] of pairs) {
      expect(crates.has(crate), `${crate} is in Cargo.lock`).toBe(true);
      expect(majorMinor(npm[npmName]), `${npmName} against ${crate}`).toBe(majorMinor(crates.get(crate)!));
    }
  });

  it('locks the CLI binaries of both desktop platforms, so CI can install on either', () => {
    const lock = readJson('package-lock.json');
    expect(Object.keys(lock.packages)).toEqual(
      expect.arrayContaining([
        'node_modules/@tauri-apps/cli-linux-x64-gnu',
        'node_modules/@tauri-apps/cli-win32-x64-msvc',
      ])
    );
  });

  it('builds with a Rust toolchain that satisfies the crate minimum', () => {
    const toolchain = /channel = "(\d+)\.(\d+)\.\d+"/.exec(read('rust-toolchain.toml'));
    const minimum = /^rust-version = "(\d+)\.(\d+)"$/m.exec(read('src-tauri', 'Cargo.toml'));
    expect(toolchain, 'rust-toolchain.toml pins an exact version').not.toBeNull();
    expect(minimum, 'Cargo.toml declares rust-version').not.toBeNull();
    const [toolchainMajor, toolchainMinor, minimumMajor, minimumMinor] = [toolchain![1], toolchain![2], minimum![1], minimum![2]].map(Number);
    expect(toolchainMajor * 1000 + toolchainMinor).toBeGreaterThanOrEqual(minimumMajor * 1000 + minimumMinor);
  });
});

describe('the crate', () => {
  const cargo = read('src-tauri', 'Cargo.toml');

  it('talks to Redmine through rustls with the OS trust store and without a cookie jar', () => {
    const http = /tauri-plugin-http = \{[^}]*\}/s.exec(cargo)?.[0] ?? '';
    expect(http).toContain('default-features = false');
    expect(http).toContain('"rustls-tls-native-roots"');
    expect(http).toContain('"gzip"');
    expect(http).not.toContain('cookies');
  });

  it('keeps its data in SQLite, built into the app, and in no other kind of database', () => {
    const sql = /tauri-plugin-sql = \{[^}]*\}/s.exec(cargo)?.[0] ?? '';
    expect(sql).toContain('features = ["sqlite"]');
    expect(sql).not.toMatch(/mysql|postgres/);
  });

  it('offers developer tools only as an opt-in feature', () => {
    expect(cargo).toMatch(/\[features\]\s+[^\[]*devtools = \["tauri\/devtools"\]/);
    expect(/^tauri = \{[^}]*devtools/m.test(cargo)).toBe(false);
  });

  it('builds the library that the Android project links later', () => {
    expect(cargo).toContain('crate-type = ["staticlib", "cdylib", "rlib"]');
  });
});

describe('the build workflows', () => {
  const workflows = { linux: read('.github', 'workflows', 'build-linux.yml'), windows: read('.github', 'workflows', 'build-windows.yml') };

  it.each(Object.entries(workflows))('%s installs the Rust version that rust-toolchain.toml pins', (_name, workflow) => {
    const pinned = /channel = "([\d.]+)"/.exec(read('rust-toolchain.toml'))?.[1];

    expect(pinned).toBeDefined();
    expect([...workflow.matchAll(/rustup toolchain install (\S+)/g)].map((match) => match[1])).toEqual([pinned]);
  });

  it.each(Object.entries(workflows))('%s builds with the desktop build script and checks the executable', (name, workflow) => {
    expect(workflow).toContain('run: npm run build:desktop');
    expect(workflow).toContain(`scripts/release/check-${name}-binary.mjs`);
    expect(workflow.toLowerCase()).not.toContain('electrobun');
  });

  it('smoke-tests the AppImage on a Wayland compositor as well as on X11', () => {
    const smoke = read('scripts', 'release', 'smoke-test-wayland.sh');

    expect(workflows.linux).toContain('weston');
    expect(workflows.linux).toContain('xvfb-run');
    expect(workflows.linux).toContain('scripts/release/smoke-test-wayland.sh "dist/linux/${CHANNEL}/${name}" --appimage-extract-and-run');
    // No X server to fall back to, and the app's own request for a toplevel window is what proves a Wayland client.
    expect(smoke).toContain('env -u DISPLAY');
    expect(smoke).toContain('WAYLAND_DEBUG=1');
    expect(smoke).toContain('xdg_toplevel@[0-9]*\\.set_app_id("Gemiredmine');
  });

  it('runs the Wayland smoke test script as a command and refuses to run without one', () => {
    const script = join(ROOT, 'scripts', 'release', 'smoke-test-wayland.sh');

    expect(statSync(script).mode & 0o111, 'the script is executable').not.toBe(0);
    const result = spawnSync('sh', [script], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });

  it.each(Object.entries(workflows))('%s keeps each channel in its own Rust cache', (_name, workflow) => {
    expect(workflow).toContain('key: rust-${{ runner.os }}-${{ inputs.channel }}-${{ hashFiles(\'rust-toolchain.toml\', \'src-tauri/Cargo.lock\') }}');
    expect(workflow).toContain('rust-${{ runner.os }}-${{ inputs.channel }}-\n');
  });

  it('only runs npm scripts that package.json defines', () => {
    const scripts = Object.keys(readJson('package.json').scripts);
    const checks = read('.github', 'workflows', 'checks.yml');

    for (const [name, workflow] of [...Object.entries(workflows), ['checks', checks]]) {
      const used = [...workflow.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]);
      expect(used.length, name).toBeGreaterThan(0);
      for (const script of used) expect(scripts, `${name} runs npm run ${script}`).toContain(script);
    }
    expect(scripts).toEqual(expect.arrayContaining(['tauri', 'build:desktop']));
  });

  it('checks pull requests with the same Rust version', () => {
    const pinned = /channel = "([\d.]+)"/.exec(read('rust-toolchain.toml'))?.[1];
    const checks = read('.github', 'workflows', 'checks.yml');

    expect([...checks.matchAll(/rustup toolchain install (\S+)/g)].map((match) => match[1])).toEqual([pinned]);
    expect(checks).toContain('cargo test --manifest-path src-tauri/Cargo.toml --locked --lib');
  });

  it('builds Linux on the oldest supported system, which sets the glibc floor', () => {
    expect(workflows.linux).toContain('runs-on: ubuntu-22.04');
    expect(read('scripts', 'release', 'check-linux-binary.mjs')).toContain("MAX_GLIBC = '2.35'");
  });

  it('never negates a command with a leading "!", which bash -e does not treat as a failure', () => {
    for (const workflow of Object.values(workflows)) expect(workflow).not.toMatch(/^\s+(?:run: |- )?!\s/m);
  });
});
