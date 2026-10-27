import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { flatpakManifest, packageLicense } from '../flatpak-manifest.mjs';
import { metainfoXml } from '../flatpak-metainfo.mjs';
import { deriveBuildInfo } from '../channels.mjs';

// The software centres read the version, developer and licence of a Flatpak app from its AppStream file. A missing or
// broken file shows the branch name (master) in place of the version, so these checks guard the file's contents.

const info = deriveBuildInfo({ packageVersion: '1.0.0', channel: 'unstable', buildNumber: 9, buildDate: '2026-10-27T10:00:00.000Z' });
const appId = 'com.github.iVegas.Gemiredmine.Unstable';
const xml = metainfoXml(info, { appId, projectLicense: 'ISC' });

/** The file parsed by Python's XML parser. It fails on an unclosed tag or an unescaped character. */
function wellFormed(text: string): boolean {
  const parsed = spawnSync('python3', ['-c', 'import sys, xml.dom.minidom; xml.dom.minidom.parseString(sys.stdin.read())'], {
    input: text,
    encoding: 'utf8',
  });
  return parsed.status === 0;
}

describe('the AppStream file of the Flatpak app', () => {
  it('is well-formed XML', () => {
    expect(wellFormed(xml)).toBe(true);
    expect(wellFormed('<component><name>a & b</component>')).toBe(false);
  });

  it('names the app by its Flatpak id, and its desktop entry', () => {
    expect(xml).toContain(`<id>${appId}</id>`);
    expect(xml).toContain(`<launchable type="desktop-id">${appId}.desktop</launchable>`);
  });

  it('gives the version of the build, so the software centre shows it instead of the branch', () => {
    expect(xml).toContain(`<release version="${info.version}" date="2026-10-27"/>`);
    expect(info.version).toBe('1.0.0-unstable.9');
  });

  it('names the developer, and the licence of the app and of the description', () => {
    expect(xml).toContain('<developer id="com.github.iVegas">');
    expect(xml).toContain('<project_license>ISC</project_license>');
    expect(xml).toContain('<metadata_license>CC0-1.0</metadata_license>');
  });

  it('takes the licence of the app from package.json', () => {
    expect(packageLicense()).toBe('ISC');
  });

  it('escapes what it is given, so that a name cannot break the file', () => {
    const odd = metainfoXml({ ...info, productName: 'Git & <Redmine>' }, { appId, projectLicense: 'ISC' });

    expect(odd).toContain('<name>Git &amp; &lt;Redmine&gt;</name>');
    expect(wellFormed(odd)).toBe(true);
  });

  it('is installed into the app, with the desktop entry, and shipped as a source of the build', () => {
    const manifest = flatpakManifest(info, { env: {} }) as { modules: Array<{ name: string; 'build-commands'?: string[]; sources?: unknown[] }> };
    const app = manifest.modules.find((module) => module.name === info.appName)!;

    expect(app['build-commands']).toContain(
      `install -Dm644 ${appId}.metainfo.xml /app/share/metainfo/${appId}.metainfo.xml`
    );
    expect(app.sources).toContainEqual({ type: 'inline', contents: xml, 'dest-filename': `${appId}.metainfo.xml` });
  });
});
