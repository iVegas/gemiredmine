import { describe, it, expect } from 'vitest';
import {
  appInstallerFileName,
  buildAppInstaller,
  buildAppxManifest,
  feedUrls,
  fixedPackageFileName,
  msixVersion,
  packageFileName,
  windowsPath,
  xmlEscape,
} from '../windows-metadata.mjs';

describe('msixVersion', () => {
  it('maps every channel onto four numeric parts that increase within the channel', () => {
    expect(msixVersion('stable', '1.2.0')).toBe('1.2.0.0');
    expect(msixVersion('dev', '1.2.0')).toBe('1.2.0.0');
    expect(msixVersion('canary', '1.2.0-rc.3')).toBe('1.2.0.3');
    expect(msixVersion('unstable', '1.2.0-unstable.42')).toBe('1.2.0.42');
  });

  it('keeps successive builds ordered, so an installed app is always upgraded', () => {
    const order = ['1.0.0-unstable.9', '1.0.0-unstable.10', '1.0.0-unstable.11'].map(v => msixVersion('unstable', v));
    expect(order).toEqual(['1.0.0.9', '1.0.0.10', '1.0.0.11']);
    expect(msixVersion('unstable', '1.1.0-unstable.1')).toBe('1.1.0.1');
  });

  it('refuses versions that cannot be expressed in an MSIX version', () => {
    expect(() => msixVersion('unstable', '1.0.0-unstable.99999')).toThrow('does not fit');
    expect(() => msixVersion('canary', '1.0.0-rc.beta')).toThrow('no build number');
  });
});

describe('file names and feeds', () => {
  it('names the versioned package and the fixed name the feed points at', () => {
    expect(packageFileName('Gemiredmine-Unstable', '1.0.0-unstable.7')).toBe('Gemiredmine-Unstable-1.0.0-unstable.7-x64.msix');
    expect(fixedPackageFileName('Gemiredmine-Unstable')).toBe('Gemiredmine-Unstable-x64.msix');
    expect(appInstallerFileName('Gemiredmine-Unstable')).toBe('Gemiredmine-Unstable.appinstaller');
  });

  it('stable follows the latest release; pre-release channels follow their pointer', () => {
    expect(feedUrls({ channel: 'stable', owner: 'iVegas', repo: 'gemiredmine', appName: 'Gemiredmine' })).toEqual({
      packageUrl: 'https://github.com/iVegas/gemiredmine/releases/latest/download/Gemiredmine-x64.msix',
      appInstallerUrl: 'https://github.com/iVegas/gemiredmine/releases/latest/download/Gemiredmine.appinstaller',
    });
    expect(feedUrls({ channel: 'unstable', owner: 'iVegas', repo: 'gemiredmine', appName: 'Gemiredmine-Unstable' }).packageUrl).toBe(
      'https://github.com/iVegas/gemiredmine/releases/download/unstable-latest/Gemiredmine-Unstable-x64.msix'
    );
  });
});

describe('manifests', () => {
  const manifest = buildAppxManifest({
    identityName: 'com.gemiredmine.app.canary',
    publisher: 'CN=Gemiredmine & Co',
    version: '1.0.0.3',
    displayName: 'Gemiredmine Canary',
    publisherDisplayName: 'Gemiredmine',
    description: 'Redmine client <canary>',
    executable: windowsPath('bin', 'launcher.exe'),
  });

  it('declares the channel identity, Windows 11 target and the desktop full-trust entry point', () => {
    expect(manifest).toContain('Name="com.gemiredmine.app.canary"');
    expect(manifest).toContain('Version="1.0.0.3"');
    expect(manifest).toContain('ProcessorArchitecture="x64"');
    expect(manifest).toContain('Name="Windows.Desktop" MinVersion="10.0.22000.0"');
    expect(manifest).toContain('Executable="bin\\launcher.exe" EntryPoint="Windows.FullTrustApplication"');
    expect(manifest).toContain('<rescap:Capability Name="runFullTrust" />');
  });

  it('escapes values that would otherwise break the XML', () => {
    expect(manifest).toContain('Publisher="CN=Gemiredmine &amp; Co"');
    expect(manifest).toContain('Redmine client &lt;canary&gt;');
    expect(xmlEscape(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
  });

  it('builds an App Installer that points at the package and checks for updates on launch', () => {
    const installer = buildAppInstaller({
      identityName: 'com.gemiredmine.app.canary',
      publisher: 'CN=Gemiredmine',
      version: '1.0.0.3',
      packageUrl: 'https://example.test/Gemiredmine-Canary-x64.msix',
      appInstallerUrl: 'https://example.test/Gemiredmine-Canary.appinstaller',
    });
    expect(installer).toContain('Uri="https://example.test/Gemiredmine-Canary.appinstaller"');
    expect(installer).toContain('<MainPackage Name="com.gemiredmine.app.canary" Publisher="CN=Gemiredmine" Version="1.0.0.3"');
    expect(installer).toContain('Uri="https://example.test/Gemiredmine-Canary-x64.msix"');
    expect(installer).toContain('<OnLaunch HoursBetweenUpdateChecks="8" />');
  });
});
