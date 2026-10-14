import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorAnnotation, packageWindows } from '../package-windows.mjs';

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
type Exporter = (args: { pfx: string; password: string; out: string }) => string;

const fakeExport: Exporter = ({ out }) => {
  writeFileSync(out, 'CER-BYTES');
  return out;
};

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

  const selfSigned = {
    WINDOWS_SIGNING: 'self-signed',
    WINDOWS_SELF_SIGNED_PFX_BASE64: Buffer.from('pfx-bytes').toString('base64'),
    WINDOWS_SELF_SIGNED_PASSWORD: 'self-secret',
  };
  const trusted = {
    WINDOWS_SIGNING: 'trusted',
    WINDOWS_TRUSTED_PFX_BASE64: Buffer.from('trusted-pfx').toString('base64'),
    WINDOWS_TRUSTED_PASSWORD: 'trusted-secret',
    WINDOWS_TRUSTED_PUBLISHER: 'CN=Acme Ltd',
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

  it('produces an unsigned local package when no signing is configured', () => {
    const { outDir, metadata, signing } = packageWindows({ env: env(), root, exportCertificate: fakeExport });

    expect(signing).toBe('none');
    expect(metadata).toMatchObject({ channel: 'unstable', platform: 'windows', tag: 'unstable-v1.0.0-unstable.7', pointerTag: 'unstable-latest' });
    expect(metadata.assets.map((a: Asset) => a.name)).not.toContain('Gemiredmine-Unstable-self-signed.cer');
    expect(existsSync(log)).toBe(false);

    const manifest = readFileSync(join(outDir, 'Gemiredmine-Unstable-1.0.0-unstable.7-x64.msix'), 'utf8');
    expect(manifest).toContain('Name="com.gemiredmine.app.unstable"');
    expect(manifest).toContain('Version="1.0.0.7"');
    expect(manifest).toContain('Publisher="CN=Gemiredmine"');
    expect(manifest).toContain('Executable="bin\\launcher.exe"');
  });

  it('signs canary and unstable with the self-signed certificate, skips the trust check, and ships the public certificate', () => {
    const { outDir, metadata, signing } = packageWindows({
      env: env({ ...selfSigned, REQUIRE_SIGNING: '1' }),
      root,
      exportCertificate: fakeExport,
    });

    expect(signing).toBe('self-signed');
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('sign /fd SHA256');
    expect(calls[0]).toContain('/tr http://timestamp.digicert.com');
    expect(readFileSync(join(outDir, 'Gemiredmine-Unstable-self-signed.cer'), 'utf8')).toBe('CER-BYTES');
    expect(existsSync(join(outDir, 'signing-certificate.pfx'))).toBe(false);

    const cer = metadata.assets.find((a: Asset) => a.name === 'Gemiredmine-Unstable-self-signed.cer');
    expect(cer).toEqual({ name: 'Gemiredmine-Unstable-self-signed.cer', pointer: true });
    const installer = readFileSync(join(outDir, 'Gemiredmine-Unstable.appinstaller'), 'utf8');
    expect(installer).toContain('Publisher="CN=Gemiredmine"');
    expect(JSON.parse(readFileSync(join(outDir, 'release.json'), 'utf8'))).toMatchObject({ signing: 'self-signed', publisher: 'CN=Gemiredmine' });
  });

  it('signs and verifies stable with the trusted certificate and publishes no certificate', () => {
    const { outDir, metadata, signing } = packageWindows({
      env: env({ ...trusted, CHANNEL: 'stable', GITHUB_RUN_NUMBER: undefined, REQUIRE_SIGNING: '1' }),
      root,
      exportCertificate: fakeExport,
    });

    expect(signing).toBe('trusted');
    expect(metadata).toMatchObject({ channel: 'stable', pointerTag: null, tag: 'v1.0.0' });
    expect(metadata.assets.every((a: Asset) => !a.pointer)).toBe(true);
    expect(metadata.assets.some((a: Asset) => a.name.endsWith('.cer'))).toBe(false);

    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls[0]).toContain('sign /fd SHA256');
    expect(calls[1]).toContain('verify /pa /v');
    expect(readFileSync(join(outDir, 'Gemiredmine.appinstaller'), 'utf8')).toContain('Publisher="CN=Acme Ltd"');
    expect(readFileSync(join(outDir, 'Gemiredmine.appinstaller'), 'utf8')).toContain('releases/latest/download/Gemiredmine-x64.msix');
    expect(JSON.parse(readFileSync(join(outDir, 'release.json'), 'utf8'))).toMatchObject({ signing: 'trusted', publisher: 'CN=Acme Ltd' });
  });

  it('never signs stable with the self-signed certificate', () => {
    expect(() =>
      packageWindows({ env: env({ ...selfSigned, CHANNEL: 'stable', GITHUB_RUN_NUMBER: undefined }), root, exportCertificate: fakeExport })
    ).toThrow('Stable releases must use trusted signing');
  });

  it('refuses an unsigned release build', () => {
    expect(() => packageWindows({ env: env({ REQUIRE_SIGNING: '1' }), root, exportCertificate: fakeExport })).toThrow('must be signed');
  });

  it('names the missing secret when the chosen profile has no certificate', () => {
    expect(() =>
      packageWindows({ env: env({ WINDOWS_SIGNING: 'self-signed', WINDOWS_SELF_SIGNED_PFX_BASE64: undefined }), root, exportCertificate: fakeExport })
    ).toThrow('WINDOWS_SELF_SIGNED_PFX_BASE64');
  });

  it('reports a failure as a single-line GitHub Actions error annotation', () => {
    expect(errorAnnotation('needs the WINDOWS_SELF_SIGNED_PFX_BASE64 secret.\n100% sure')).toBe(
      '::error title=Windows packaging failed::needs the WINDOWS_SELF_SIGNED_PFX_BASE64 secret.%0A100%25 sure'
    );
  });

  it('uses the genuine launcher from the Electrobun Windows core when the build only has the extensionless launcher', () => {
    const app = join(root, 'build', 'dev-win-x64', 'Gemiredmine-Unstable-dev');
    rmSync(join(app, 'bin', 'launcher.exe'));
    writeFileSync(join(app, 'bin', 'launcher'), '#!/bin/sh');
    const core = join(root, 'node_modules', 'electrobun', 'dist-win-x64');
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, 'launcher.exe'), 'GENUINE');

    const { outDir } = packageWindows({ env: env(), root, exportCertificate: fakeExport });

    expect(readFileSync(join(outDir, 'Gemiredmine-Unstable-1.0.0-unstable.7-x64.msix'), 'utf8')).toContain('Executable="bin\\launcher.exe"');
  });
});
