import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageWindows } from '../package-windows.mjs';

// Stand-ins for makeappx.exe and signtool.exe. They run on Linux, so the packaging flow can be
// tested here. The real tools run on the Windows CI runner.
const FAKE_MAKEAPPX = `#!/bin/sh
[ "$1" = pack ] || exit 2
cp "$3/AppxManifest.xml" "$5"
`;
const FAKE_SIGNTOOL = `#!/bin/sh
echo "$@" >> "$SIGNTOOL_LOG"
exit 0
`;

type Asset = { name: string; pointer: boolean };

describe('packageWindows', () => {
  let root: string;
  let tools: string;
  let log: string;

  const env = (overrides: Record<string, string | undefined> = {}) => {
    const result: Record<string, string> = {
      CHANNEL: 'unstable',
      GITHUB_RUN_NUMBER: '7',
      GITHUB_SHA: 'abc1234567890abcdef1234567890abcdef12345',
      BUILD_DATE: '2026-10-13T00:00:00.000Z',
      MAKEAPPX: join(tools, 'makeappx'),
      SIGNTOOL: join(tools, 'signtool'),
      SIGNTOOL_LOG: log,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete result[key];
      else result[key] = value;
    }
    return result;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gemi-win-'));
    tools = join(root, 'tools');
    mkdirSync(tools);
    log = join(tools, 'signtool.log');
    writeFileSync(join(tools, 'makeappx'), FAKE_MAKEAPPX);
    writeFileSync(join(tools, 'signtool'), FAKE_SIGNTOOL);
    chmodSync(join(tools, 'makeappx'), 0o755);
    chmodSync(join(tools, 'signtool'), 0o755);

    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    // Electrobun names the folder <app>-<env>; the stable app has its own folder name.
    for (const name of ['Gemiredmine-Unstable-dev', 'Gemiredmine-dev']) {
      const app = join(root, 'build', 'dev-win-x64', name);
      mkdirSync(join(app, 'bin'), { recursive: true });
      mkdirSync(join(app, 'Resources'), { recursive: true });
      writeFileSync(join(app, 'bin', 'launcher.exe'), 'MZ');
      writeFileSync(join(app, 'Resources', 'main.js'), '// app');
    }

    for (const channel of ['unstable', 'stable']) {
      const assets = join(root, 'assets', 'windows', channel);
      mkdirSync(assets, { recursive: true });
      for (const tile of ['Square44x44Logo.png', 'Square150x150Logo.png', 'StoreLogo.png', 'Wide310x150Logo.png']) {
        writeFileSync(join(assets, tile), 'png');
      }
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('packages an unsigned unstable build with a pointer feed and a manifest that starts the launcher', () => {
    const { outDir, metadata, signed } = packageWindows({ env: env({ WINDOWS_CERT_PFX_BASE64: undefined }), root });

    expect(signed).toBe(false);
    expect(metadata).toMatchObject({ channel: 'unstable', platform: 'windows', tag: 'unstable-v1.0.0-unstable.7', pointerTag: 'unstable-latest' });

    const manifest = readFileSync(join(outDir, 'Gemiredmine-Unstable-1.0.0-unstable.7-x64.msix'), 'utf8');
    expect(manifest).toContain('Name="com.gemiredmine.app.unstable"');
    expect(manifest).toContain('Version="1.0.0.7"');
    expect(manifest).toContain('Executable="bin\\launcher.exe"');

    const installer = readFileSync(join(outDir, 'Gemiredmine-Unstable.appinstaller'), 'utf8');
    expect(installer).toContain('Version="1.0.0.7"');
    expect(installer).toContain('releases/download/unstable-latest/Gemiredmine-Unstable-x64.msix');

    expect(existsSync(join(outDir, 'Gemiredmine-Unstable-x64.msix'))).toBe(true);
    expect(existsSync(join(outDir, 'SHA256SUMS-windows.txt'))).toBe(true);
    expect(existsSync(join(outDir, 'payload'))).toBe(false);
    expect(metadata.assets.filter((a: Asset) => a.pointer).map((a: Asset) => a.name).sort()).toEqual([
      'Gemiredmine-Unstable-x64.msix',
      'Gemiredmine-Unstable.appinstaller',
    ]);
  });

  it('uses GitHub\'s latest-release address for stable and keeps the fixed names in the release itself', () => {
    const { outDir, metadata } = packageWindows({
      env: env({ CHANNEL: 'stable', GITHUB_RUN_NUMBER: undefined, WINDOWS_CERT_PFX_BASE64: undefined }),
      root,
    });

    expect(metadata).toMatchObject({ channel: 'stable', pointerTag: null, tag: 'v1.0.0' });
    expect(metadata.assets.every((a: Asset) => !a.pointer)).toBe(true);
    const installer = readFileSync(join(outDir, 'Gemiredmine.appinstaller'), 'utf8');
    expect(installer).toContain('releases/latest/download/Gemiredmine-x64.msix');
    expect(installer).toContain('Version="1.0.0.0"');
  });

  it('signs and verifies the package when a certificate is configured, and removes the certificate file afterwards', () => {
    const { outDir, signed } = packageWindows({
      env: env({ WINDOWS_CERT_PFX_BASE64: Buffer.from('pfx-bytes').toString('base64'), WINDOWS_CERT_PASSWORD: 'secret' }),
      root,
    });

    expect(signed).toBe(true);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls[0]).toContain('sign /fd SHA256');
    expect(calls[0]).toContain('/tr http://timestamp.digicert.com');
    expect(calls[1]).toContain('verify /pa /v');
    expect(existsSync(join(outDir, 'signing-certificate.pfx'))).toBe(false);
  });

  it('refuses to produce an unsigned release when signing is required', () => {
    expect(() =>
      packageWindows({ env: env({ WINDOWS_CERT_PFX_BASE64: undefined, REQUIRE_SIGNING: '1' }), root })
    ).toThrow('must be signed');
  });

  it('uses the genuine launcher from the Electrobun Windows core when the build only has the extensionless launcher', () => {
    const app = join(root, 'build', 'dev-win-x64', 'Gemiredmine-Unstable-dev');
    rmSync(join(app, 'bin', 'launcher.exe'));
    writeFileSync(join(app, 'bin', 'launcher'), '#!/bin/sh');
    const core = join(root, 'node_modules', 'electrobun', 'dist-win-x64');
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, 'launcher.exe'), 'GENUINE');

    const { outDir } = packageWindows({ env: env({ WINDOWS_CERT_PFX_BASE64: undefined }), root });

    expect(readFileSync(join(outDir, 'Gemiredmine-Unstable-1.0.0-unstable.7-x64.msix'), 'utf8')).toContain('Executable="bin\\launcher.exe"');
  });
});
