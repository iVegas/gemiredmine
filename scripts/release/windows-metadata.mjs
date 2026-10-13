// Pure helpers for the Windows package (MSIX) and its App Installer feed.
// Kept free of I/O so the rules are unit tested: version mapping, identity, manifests and URLs.
import { parseSemver, coreVersion } from './channels.mjs';
import { POINTER_TAGS } from './policy.mjs';

export const WINDOWS_ARCH = 'x64';

/** Windows 11 (build 22000) is the minimum; this is the first build that is actually Windows 11. */
export const WINDOWS_11_MIN_VERSION = '10.0.22000.0';
/** The newest Windows release the package has been checked against. */
export const WINDOWS_MAX_TESTED_VERSION = '10.0.26100.0';

/** How often an installed app checks its App Installer feed when it starts. */
export const UPDATE_CHECK_HOURS = 8;

const MAX_FIELD = 65535;

/**
 * MSIX versions have four numeric parts and must increase within a package identity.
 * Within a channel the pre-release number is the last part, so upgrades always move forward:
 *   stable  1.2.0          -> 1.2.0.0
 *   canary  1.2.0-rc.3     -> 1.2.0.3
 *   unstable 1.2.0-unstable.42 -> 1.2.0.42
 */
export function msixVersion(channel, version) {
  const { major, minor, patch, prerelease } = parseSemver(version);
  const core = coreVersion(version);
  let last = 0;
  if (channel === 'canary' || channel === 'unstable') {
    const number = prerelease[prerelease.length - 1];
    if (!/^\d+$/.test(number ?? '')) throw new Error(`Version "${version}" has no build number for ${channel}.`);
    last = Number(number);
  }
  if (major > MAX_FIELD || minor > MAX_FIELD || patch > MAX_FIELD || last > MAX_FIELD) {
    throw new Error(`Version "${version}" does not fit into an MSIX version.`);
  }
  return `${core}.${last}`;
}

export function packageFileName(appName, version) {
  return `${appName}-${version}-${WINDOWS_ARCH}.msix`;
}

/** The fixed name the App Installer feed points at, so the URL never changes between versions. */
export function fixedPackageFileName(appName) {
  return `${appName}-${WINDOWS_ARCH}.msix`;
}

export function appInstallerFileName(appName) {
  return `${appName}.appinstaller`;
}

/**
 * Where the App Installer file and package come from. Stable uses GitHub's "latest release"
 * address; canary and unstable use their pointer releases, which are never pruned.
 */
export function feedUrls({ channel, owner, repo, appName }) {
  const base = channel === 'stable'
    ? `https://github.com/${owner}/${repo}/releases/latest/download`
    : (() => {
        const pointer = POINTER_TAGS[channel];
        if (!pointer) throw new Error(`Channel "${channel}" has no update feed.`);
        return `https://github.com/${owner}/${repo}/releases/download/${pointer}`;
      })();
  return {
    packageUrl: `${base}/${fixedPackageFileName(appName)}`,
    appInstallerUrl: `${base}/${appInstallerFileName(appName)}`,
  };
}

export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Windows paths in the manifest use backslashes. */
export function windowsPath(...segments) {
  return segments.join('\\');
}

export function buildAppxManifest({
  identityName,
  publisher,
  version,
  displayName,
  publisherDisplayName,
  description,
  executable,
}) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Package',
    '  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"',
    '  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"',
    '  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"',
    '  IgnorableNamespaces="uap rescap">',
    '',
    `  <Identity Name="${xmlEscape(identityName)}" Publisher="${xmlEscape(publisher)}" Version="${version}" ProcessorArchitecture="${WINDOWS_ARCH}" />`,
    '',
    '  <Properties>',
    `    <DisplayName>${xmlEscape(displayName)}</DisplayName>`,
    `    <PublisherDisplayName>${xmlEscape(publisherDisplayName)}</PublisherDisplayName>`,
    `    <Description>${xmlEscape(description)}</Description>`,
    '    <Logo>Assets\\StoreLogo.png</Logo>',
    '  </Properties>',
    '',
    '  <Dependencies>',
    `    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="${WINDOWS_11_MIN_VERSION}" MaxVersionTested="${WINDOWS_MAX_TESTED_VERSION}" />`,
    '  </Dependencies>',
    '',
    '  <Resources>',
    '    <Resource Language="en-us" />',
    '  </Resources>',
    '',
    '  <Applications>',
    `    <Application Id="App" Executable="${xmlEscape(executable)}" EntryPoint="Windows.FullTrustApplication">`,
    '      <uap:VisualElements',
    `        DisplayName="${xmlEscape(displayName)}"`,
    `        Description="${xmlEscape(description)}"`,
    '        BackgroundColor="transparent"',
    '        Square150x150Logo="Assets\\Square150x150Logo.png"',
    '        Square44x44Logo="Assets\\Square44x44Logo.png">',
    '        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" />',
    '      </uap:VisualElements>',
    '    </Application>',
    '  </Applications>',
    '',
    '  <Capabilities>',
    '    <rescap:Capability Name="runFullTrust" />',
    '  </Capabilities>',
    '</Package>',
    '',
  ].join('\n');
}

/** The file a user opens to install the channel and that Windows then keeps up to date. */
export function buildAppInstaller({ identityName, publisher, version, packageUrl, appInstallerUrl }) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2018" Version="${version}" Uri="${xmlEscape(appInstallerUrl)}">`,
    `  <MainPackage Name="${xmlEscape(identityName)}" Publisher="${xmlEscape(publisher)}" Version="${version}" ProcessorArchitecture="${WINDOWS_ARCH}" Uri="${xmlEscape(packageUrl)}" />`,
    '  <UpdateSettings>',
    `    <OnLaunch HoursBetweenUpdateChecks="${UPDATE_CHECK_HOURS}" />`,
    '  </UpdateSettings>',
    '</AppInstaller>',
    '',
  ].join('\n');
}
