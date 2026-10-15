#!/usr/bin/env node
// Packages the Tauri Windows executable of one channel as an MSIX with an App Installer feed.
//
// Inputs:  CHANNEL, GITHUB_RUN_NUMBER (unstable build number), GITHUB_SHA (optional)
//          WINDOWS_SIGNING     none | self-signed | trusted (see windows-signing.mjs)
//          REQUIRE_SIGNING=1   refuse to produce an unsigned package (release builds)
//          the secrets for the chosen profile, WINDOWS_SELF_SIGNED_* or WINDOWS_TRUSTED_*
//          MAKEAPPX, SIGNTOOL  optional paths to the Windows SDK tools
// Outputs: dist/windows/<channel>/ with the MSIX, its fixed-name copy, the App Installer file,
//          the public certificate (self-signed only), SHA256SUMS-windows.txt and release.json.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, deriveBuildInfo } from './channels.mjs';
import { POINTER_TAGS, tagFor } from './policy.mjs';
import { findAppBinary } from './build-output.mjs';
import { releaseMetadata } from './linux-metadata.mjs';
import { resolveSigning } from './windows-signing.mjs';
import {
  appInstallerFileName,
  buildAppInstaller,
  buildAppxManifest,
  feedUrls,
  fixedPackageFileName,
  msixVersion,
  packageFileName,
} from './windows-metadata.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TIMESTAMP_URL = 'http://timestamp.digicert.com';

// Reads the certificate's public part from the PFX. The password is passed through the environment, not the command line.
// Only .NET calls, no cmdlets: Windows PowerShell started from pwsh 7 (the runner's shell) inherits pwsh's module path
// and cannot load modules such as Microsoft.PowerShell.Security, which holds ConvertTo-SecureString.
const EXPORT_PUBLIC_CERTIFICATE = [
  "$ErrorActionPreference = 'Stop'",
  '$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($env:GEMI_PFX, $env:GEMI_PFX_PASSWORD)',
  "[System.IO.File]::WriteAllBytes($env:GEMI_CER, $certificate.Export('Cert'))",
].join('; ');

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Finds a tool from the Windows SDK. Non-Windows hosts use PATH, which is how tests run the packager. */
export function findWindowsSdkTool(name, { env = process.env, platform = process.platform } = {}) {
  const override = env[name.toUpperCase()];
  if (override) return override;
  if (platform !== 'win32') return name;

  const binRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  const versions = existsSync(binRoot)
    ? readdirSync(binRoot).filter(entry => /^10\.\d+\.\d+\.\d+$/.test(entry)).sort(compareVersionsDesc)
    : [];
  for (const version of versions) {
    const candidate = join(binRoot, version, 'x64', `${name}.exe`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${name}.exe was not found in the Windows SDK. Install the Windows 10/11 SDK or set ${name.toUpperCase()}.`);
}

function compareVersionsDesc(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return right[i] - left[i];
  }
  return 0;
}

function copyAssets(assetDir, targetDir) {
  if (!existsSync(assetDir)) throw new Error(`Missing Windows package images in ${assetDir}.`);
  mkdirSync(targetDir, { recursive: true });
  for (const name of readdirSync(assetDir).filter(file => file.endsWith('.png'))) {
    copyFileSync(join(assetDir, name), join(targetDir, name));
  }
}

/** Writes the certificate's public part (a .cer) so testers can trust a self-signed package. */
export function exportPublicCertificate({ pfx, password, out, run = execFileSync }) {
  run('powershell', ['-NoProfile', '-NonInteractive', '-Command', EXPORT_PUBLIC_CERTIFICATE], {
    stdio: 'inherit',
    env: { ...process.env, GEMI_PFX: pfx, GEMI_PFX_PASSWORD: password, GEMI_CER: out },
  });
  return out;
}

/** Signs the package with the resolved profile. Returns the public certificate's path for self-signed packages. */
function signPackage({ msixPath, signing, outDir, appName, env, run, signtool, exportCertificate }) {
  if (signing.profile === 'none') return null;

  const pfx = join(outDir, 'signing-certificate.pfx');
  writeFileSync(pfx, Buffer.from(signing.pfxBase64, 'base64'), { mode: 0o600 });
  try {
    run(signtool, ['sign', '/fd', 'SHA256', '/f', pfx, '/p', signing.password, '/td', 'SHA256', '/tr', TIMESTAMP_URL, msixPath], {
      stdio: 'inherit',
      env,
    });
    // A self-signed certificate is not trusted on the build machine, so only trusted packages can be verified here.
    if (signing.profile === 'trusted') {
      run(signtool, ['verify', '/pa', '/v', msixPath], { stdio: 'inherit', env });
      return null;
    }
    const certificatePath = join(outDir, `${appName}-self-signed.cer`);
    exportCertificate({ pfx, password: signing.password, out: certificatePath, run });
    return certificatePath;
  } finally {
    rmSync(pfx, { force: true });
  }
}

export function packageWindows({
  env = process.env,
  root = ROOT,
  run = execFileSync,
  makeappx = findWindowsSdkTool('makeappx', { env }),
  signtool = findWindowsSdkTool('signtool', { env }),
  exportCertificate = ({ pfx, password, out, run: runCommand }) => exportPublicCertificate({ pfx, password, out, run: runCommand }),
} = {}) {
  const channel = env.CHANNEL;
  if (!channel) throw new Error('Set CHANNEL to stable, canary or unstable.');

  const signing = resolveSigning({
    channel,
    profile: env.WINDOWS_SIGNING || 'none',
    requireSigning: env.REQUIRE_SIGNING === '1',
    env,
  });

  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const commitSha = env.GITHUB_SHA || tryGit(root, 'HEAD');
  const info = deriveBuildInfo({
    packageVersion: version,
    channel,
    platform: 'windows',
    buildNumber: Number(env.GITHUB_RUN_NUMBER || 0),
    commit: tryGit(root, commitSha, true),
    buildDate: env.BUILD_DATE || new Date().toISOString(),
  });

  const binary = findAppBinary(root, info.appName, 'windows', env);
  const outDir = join(root, 'dist', 'windows', channel);
  const payload = join(outDir, 'payload');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(payload, { recursive: true });

  // One self-contained executable: the web assets are inside it, and the WebView2 loader is linked in.
  const executable = `${info.appName}.exe`;
  copyFileSync(binary, join(payload, executable));
  copyAssets(join(root, 'assets', 'windows', channel), join(payload, 'Assets'));

  const packageVersion = msixVersion(channel, info.version);
  writeFileSync(
    join(payload, 'AppxManifest.xml'),
    buildAppxManifest({
      identityName: info.identifier,
      publisher: signing.publisher,
      version: packageVersion,
      displayName: info.productName,
      publisherDisplayName: 'Gemiredmine',
      description: `Redmine client, ${info.label} channel`,
      executable,
    })
  );

  const versionedPath = join(outDir, packageFileName(info.appName, info.version));
  run(makeappx, ['pack', '/d', payload, '/p', versionedPath, '/o'], { stdio: 'inherit', env });
  const certificatePath = signPackage({ msixPath: versionedPath, signing, outDir, appName: info.appName, env, run, signtool, exportCertificate });

  // The fixed names are what the App Installer feed points at, so the feed URLs never change.
  const feed = feedUrls({ channel, owner: REPOSITORY.owner, repo: REPOSITORY.name, appName: info.appName });
  const fixedPath = join(outDir, fixedPackageFileName(info.appName));
  copyFileSync(versionedPath, fixedPath);
  const installerPath = join(outDir, appInstallerFileName(info.appName));
  writeFileSync(
    installerPath,
    buildAppInstaller({
      identityName: info.identifier,
      publisher: signing.publisher,
      version: packageVersion,
      packageUrl: feed.packageUrl,
      appInstallerUrl: feed.appInstallerUrl,
    })
  );

  const pointerTag = POINTER_TAGS[channel] ?? null;
  const assets = [
    { name: packageFileName(info.appName, info.version), path: versionedPath, pointer: false },
    { name: fixedPackageFileName(info.appName), path: fixedPath, pointer: pointerTag !== null },
    { name: appInstallerFileName(info.appName), path: installerPath, pointer: pointerTag !== null },
  ];
  if (certificatePath) {
    // Testers need the certificate before the package can be installed. It is attached to the build's own release,
    // whose notes name it, and copied to the pointer release, where the App Installer link lives.
    assets.push({ name: `${info.appName}-self-signed.cer`, path: certificatePath, pointer: false, copyToPointer: pointerTag !== null });
  }

  const checksums = assets.map(asset => `${sha256(asset.path)}  ${asset.name}`).join('\n');
  writeFileSync(join(outDir, 'SHA256SUMS-windows.txt'), `${checksums}\n`);
  assets.push({ name: 'SHA256SUMS-windows.txt', path: join(outDir, 'SHA256SUMS-windows.txt'), pointer: false });

  const metadata = releaseMetadata({
    channel,
    platform: 'windows',
    version: info.version,
    commit: info.commit,
    commitSha,
    tag: tagFor(channel, info.version),
    pointerTag,
    assets: assets.map(({ name, pointer, copyToPointer }) => ({ name, pointer, ...(copyToPointer ? { copyToPointer } : {}) })),
  });
  writeFileSync(
    join(outDir, 'release.json'),
    `${JSON.stringify({ ...metadata, signing: signing.profile, publisher: signing.publisher }, null, 2)}\n`
  );

  rmSync(payload, { recursive: true, force: true });
  return { outDir, metadata, signing: signing.profile };
}

/** A GitHub Actions error annotation, so the run summary names the cause instead of only an exit code. */
export function errorAnnotation(message) {
  const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::error title=Windows packaging failed::${escaped}`;
}

function tryGit(root, ref, short = false) {
  try {
    return execFileSync('git', ['rev-parse', ...(short ? ['--short'] : []), ref], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { outDir, metadata, signing } = packageWindows();
    console.log(`packaged ${metadata.version} for ${metadata.channel} (windows, signing: ${signing}) into ${outDir}`);
    for (const asset of metadata.assets) console.log(`  ${asset.name}${asset.pointer ? ' (pointer)' : ''}`);
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(errorAnnotation(error.message));
    throw error;
  }
}
