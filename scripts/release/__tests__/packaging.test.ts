import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS, REPOSITORY_URL, deriveBuildInfo } from '../channels.mjs';
import { bundlePackaging, copyrightNotice, CATEGORY, DESCRIPTION, PUBLISHER, SUMMARY } from '../packaging.mjs';
import { metainfoXml } from '../flatpak-metainfo.mjs';
import { buildAppxManifest } from '../windows-metadata.mjs';
import { tauriChannelConfig } from '../tauri-config.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const info = deriveBuildInfo({ packageVersion: '1.0.0', channel: 'unstable', buildNumber: 9, buildDate: '2026-10-27T10:00:00.000Z' });

// The packaging facts are written once, in packaging.mjs. Each platform must show them, so each is checked here.

describe('the packaging facts', () => {
  it('give the developer the same name everywhere it is shown', () => {
    expect(bundlePackaging(info).publisher).toBe(PUBLISHER.name);
    expect(metainfoXml(info, { appId: 'com.example.App', projectLicense: 'ISC' })).toContain(`<name>${PUBLISHER.name}</name>`);
    const manifest = buildAppxManifest({
      identityName: info.identifier,
      publisher: 'CN=Gemiredmine',
      version: '1.0.0.9',
      displayName: info.productName,
      publisherDisplayName: PUBLISHER.name,
      description: `${SUMMARY}, ${info.label} channel`,
      executable: `${info.appName}.exe`,
    });
    expect(manifest).toContain(`<PublisherDisplayName>${PUBLISHER.name}</PublisherDisplayName>`);
  });

  it('say what the app is, and where it is, in the Windows package and the Tauri bundle alike', () => {
    const bundle = tauriChannelConfig(info).bundle;
    expect(bundle).toMatchObject({ shortDescription: SUMMARY, longDescription: DESCRIPTION, homepage: REPOSITORY_URL, category: CATEGORY });
    expect(DESCRIPTION.length).toBeGreaterThan(SUMMARY.length);
  });

  it('carry a copyright notice with the year of the build', () => {
    expect(copyrightNotice('2026-10-27T10:00:00.000Z')).toBe(`Copyright © 2026 ${PUBLISHER.name}`);
    expect(bundlePackaging(info).copyright).toBe(`Copyright © 2026 ${PUBLISHER.name}`);
  });

  it('reach the Tauri bundle of every channel, so the executable carries the publisher', () => {
    for (const channel of Object.keys(CHANNELS)) {
      const other = deriveBuildInfo({ packageVersion: channel === 'canary' ? '1.0.0-rc.3' : '1.0.0', channel, buildNumber: 1, buildDate: '2026-10-27T10:00:00.000Z' });
      expect(tauriChannelConfig(other).bundle, channel).toMatchObject({ publisher: PUBLISHER.name, copyright: expect.stringContaining('Copyright ©') });
    }
  });

  it('leave the signing identity of Windows alone: the publisher display name is not the certificate subject', () => {
    expect(PUBLISHER.name).not.toMatch(/^CN=/);
    expect(read('scripts', 'release', 'windows-signing.mjs')).toContain("'WINDOWS_SELF_SIGNED_PUBLISHER'");
  });
});
