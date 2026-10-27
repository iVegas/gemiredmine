import { describe, it, expect } from 'vitest';
import { CHANNELS, REPOSITORY, deriveBuildInfo } from '../channels.mjs';
import { POINTER_TAGS, tagFor } from '../policy.mjs';
import { flatpakAppId } from '../flatpak-manifest.mjs';
import {
  appInstallerFileName,
  buildAppInstaller,
  buildAppxManifest,
  feedUrls,
  fixedPackageFileName,
  msixVersion,
  packageFileName,
} from '../windows-metadata.mjs';

// Golden snapshots of everything that identifies a release to users and to their update paths.
// A change to any of it, such as swapping the desktop shell, shows up here as a snapshot diff
// and has to be accepted on purpose. Inputs are fixed, so the output depends only on the code.

const PACKAGE_VERSION: Record<string, string> = {
  stable: '1.0.0',
  canary: '1.0.0-rc.3',
  unstable: '1.0.0',
  dev: '1.0.0',
};

const COMMIT = 'abc1234';
const BUILD_DATE = '2026-10-12T00:00:00.000Z';
const BUILD_NUMBER = 42;
const PUBLISHER = 'CN=Gemiredmine';

/** Records a thrown message as data, so "this channel has no such thing" is pinned too. */
function outcome<T>(run: () => T): T | { error: string } {
  try {
    return run();
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const channels = Object.keys(CHANNELS);

describe.each(channels)('%s channel', (channel) => {
  const linux = deriveBuildInfo({
    packageVersion: PACKAGE_VERSION[channel],
    channel,
    platform: 'linux',
    buildNumber: BUILD_NUMBER,
    commit: COMMIT,
    buildDate: BUILD_DATE,
  });
  const windows = deriveBuildInfo({
    packageVersion: PACKAGE_VERSION[channel],
    channel,
    platform: 'windows',
    buildNumber: BUILD_NUMBER,
    commit: COMMIT,
    buildDate: BUILD_DATE,
  });

  it('derives the build info', () => {
    expect({ linux, windows }).toMatchSnapshot();
  });

  it('names the release tags', () => {
    expect({
      tag: outcome(() => tagFor(channel, linux.version)),
      pointer: POINTER_TAGS[channel as keyof typeof POINTER_TAGS] ?? null,
    }).toMatchSnapshot();
  });

  it('names the Flatpak app and its bundle', () => {
    expect({
      appId: flatpakAppId(linux),
      bundle: `${linux.appName}-${linux.version}-x86_64.flatpak`,
      pointer: POINTER_TAGS[channel as keyof typeof POINTER_TAGS] ? `${linux.appName}-x86_64.flatpak` : null,
    }).toMatchSnapshot();
  });

  it('names and describes the Windows package and its feed', () => {
    const packageVersion = outcome(() => msixVersion(channel, windows.version));
    const feed = outcome(() =>
      feedUrls({ channel, owner: REPOSITORY.owner, repo: REPOSITORY.name, appName: windows.appName })
    );
    const installerInput =
      typeof packageVersion === 'string' && !('error' in feed)
        ? {
            identityName: windows.identifier,
            publisher: PUBLISHER,
            version: packageVersion,
            packageUrl: feed.packageUrl,
            appInstallerUrl: feed.appInstallerUrl,
          }
        : null;

    expect({
      msixVersion: packageVersion,
      packageFile: packageFileName(windows.appName, windows.version),
      fixedPackageFile: fixedPackageFileName(windows.appName),
      appInstallerFile: appInstallerFileName(windows.appName),
      feed,
      manifest:
        typeof packageVersion === 'string'
          ? buildAppxManifest({
              identityName: windows.identifier,
              publisher: PUBLISHER,
              version: packageVersion,
              displayName: windows.productName,
              publisherDisplayName: 'iVegas',
              description: `Redmine client, ${windows.label} channel`,
              // The executable is the one thing a change of desktop shell is allowed to move.
              executable: `${windows.appName}.exe`,
            })
          : null,
      appInstaller: installerInput ? buildAppInstaller(installerInput) : null,
    }).toMatchSnapshot();
  });
});
