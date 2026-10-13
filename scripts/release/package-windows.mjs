#!/usr/bin/env node
// Packages the Electrobun Windows build of one channel as a signed MSIX with an App Installer feed.
//
// Inputs:  CHANNEL, GITHUB_RUN_NUMBER (unstable build number), GITHUB_SHA (optional)
//          WINDOWS_CERT_PFX_BASE64, WINDOWS_CERT_PASSWORD  code-signing certificate (base64 PFX)
//          WINDOWS_PUBLISHER   must equal the certificate subject (default CN=Gemiredmine)
//          REQUIRE_SIGNING=1   refuse to produce an unsigned package (release builds)
//          MAKEAPPX, SIGNTOOL  optional paths to the Windows SDK tools
// Outputs: dist/windows/<channel>/ with the MSIX, its fixed-name copy, the App Installer file,
//          SHA256SUMS-windows.txt and release.json, which the publish step reads.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, deriveBuildInfo } from './channels.mjs';
import { POINTER_TAGS, tagFor } from './policy.mjs';
import { findAppBuild } from './build-output.mjs';
import { releaseMetadata } from './linux-metadata.mjs';
import {
  appInstallerFileName,
  buildAppInstaller,
  buildAppxManifest,
  feedUrls,
  fixedPackageFileName,
  msixVersion,
  packageFileName,
  windowsPath,
} from './windows-metadata.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_PUBLISHER = 'CN=Gemiredmine';
const TIMESTAMP_URL = 'http://timestamp.digicert.com';

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

/**
 * The manifest must start the app's launcher. Electrobun ships bin/launcher.exe on Windows; if a
 * build only has the extensionless launcher, the genuine launcher.exe from Electrobun's Windows core is used.
 */
export function ensureLauncher(payloadDir, root) {
  const exe = join(payloadDir, 'bin', 'launcher.exe');
  if (existsSync(exe)) return windowsPath('bin', 'launcher.exe');

  const core = join(root, 'node_modules', 'electrobun', 'dist-win-x64', 'launcher.exe');
  if (existsSync(join(payloadDir, 'bin', 'launcher')) && existsSync(core)) {
    copyFileSync(core, exe);
    return windowsPath('bin', 'launcher.exe');
  }
  throw new Error(`No Windows launcher found in ${payloadDir}/bin. Run the Windows Electrobun build first.`);
}

function copyAssets(assetDir, targetDir) {
  if (!existsSync(assetDir)) throw new Error(`Missing Windows package images in ${assetDir}.`);
  mkdirSync(targetDir, { recursive: true });
  for (const name of readdirSync(assetDir).filter(file => file.endsWith('.png'))) {
    copyFileSync(join(assetDir, name), join(targetDir, name));
  }
}

function signPackage({ msixPath, env, run, signtool }) {
  const base64 = env.WINDOWS_CERT_PFX_BASE64;
  if (!base64) {
    if (env.REQUIRE_SIGNING === '1') {
      throw new Error('This release must be signed, but WINDOWS_CERT_PFX_BASE64 is not set.');
    }
    return false;
  }
  const pfx = join(dirname(msixPath), 'signing-certificate.pfx');
  writeFileSync(pfx, Buffer.from(base64, 'base64'), { mode: 0o600 });
  try {
    run(signtool, ['sign', '/fd', 'SHA256', '/f', pfx, '/p', env.WINDOWS_CERT_PASSWORD ?? '', '/td', 'SHA256', '/tr', TIMESTAMP_URL, msixPath], {
      stdio: 'inherit',
      env,
    });
    run(signtool, ['verify', '/pa', '/v', msixPath], { stdio: 'inherit', env });
  } finally {
    rmSync(pfx, { force: true });
  }
  return true;
}

export function packageWindows({
  env = process.env,
  root = ROOT,
  run = execFileSync,
  makeappx = findWindowsSdkTool('makeappx', { env }),
  signtool = findWindowsSdkTool('signtool', { env }),
} = {}) {
  const channel = env.CHANNEL;
  if (!channel) throw new Error('Set CHANNEL to stable, canary or unstable.');

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

  const source = findAppBuild(join(root, 'build'), info.appName);
  const outDir = join(root, 'dist', 'windows', channel);
  const payload = join(outDir, 'payload');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(payload, { recursive: true });

  cpSync(source, payload, { recursive: true });
  const executable = ensureLauncher(payload, root);
  copyAssets(join(root, 'assets', 'windows', channel), join(payload, 'Assets'));

  const publisher = env.WINDOWS_PUBLISHER || DEFAULT_PUBLISHER;
  const packageVersion = msixVersion(channel, info.version);
  writeFileSync(
    join(payload, 'AppxManifest.xml'),
    buildAppxManifest({
      identityName: info.identifier,
      publisher,
      version: packageVersion,
      displayName: info.productName,
      publisherDisplayName: 'Gemiredmine',
      description: `Redmine client, ${info.label} channel`,
      executable,
    })
  );

  const versionedPath = join(outDir, packageFileName(info.appName, info.version));
  run(makeappx, ['pack', '/d', payload, '/p', versionedPath, '/o'], { stdio: 'inherit', env });
  const signed = signPackage({ msixPath: versionedPath, env, run, signtool });

  // The fixed names are what the App Installer feed points at, so the feed URLs never change.
  const feed = feedUrls({ channel, owner: REPOSITORY.owner, repo: REPOSITORY.name, appName: info.appName });
  const fixedPath = join(outDir, fixedPackageFileName(info.appName));
  copyFileSync(versionedPath, fixedPath);
  const installerPath = join(outDir, appInstallerFileName(info.appName));
  writeFileSync(
    installerPath,
    buildAppInstaller({
      identityName: info.identifier,
      publisher,
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
    assets: assets.map(({ name, pointer }) => ({ name, pointer })),
  });
  writeFileSync(join(outDir, 'release.json'), `${JSON.stringify({ ...metadata, signed, publisher }, null, 2)}\n`);

  rmSync(payload, { recursive: true, force: true });
  return { outDir, metadata, signed };
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
  const { outDir, metadata, signed } = packageWindows();
  console.log(`packaged ${metadata.version} for ${metadata.channel} (windows, ${signed ? 'signed' : 'UNSIGNED'}) into ${outDir}`);
  for (const asset of metadata.assets) console.log(`  ${asset.name}${asset.pointer ? ' (pointer)' : ''}`);
}
