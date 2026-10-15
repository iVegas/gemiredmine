// Pure helpers for the Linux AppImage: file names, desktop entry, AppRun and update information.
// Kept free of I/O so the packaging rules are unit tested.
import { POINTER_TAGS } from './policy.mjs';

export const ARCH = 'x86_64';

/** Versioned file name, for example Gemiredmine-Unstable-1.0.0-unstable.42-x86_64.AppImage */
export function appImageFileName(appName, version) {
  return `${appName}-${version}-${ARCH}.AppImage`;
}

/** Fixed file name served by the channel's pointer release, for example Gemiredmine-Unstable-x86_64.AppImage */
export function pointerFileName(appName) {
  return `${appName}-${ARCH}.AppImage`;
}

/**
 * Update information embedded in the AppImage (read by AppImageUpdate, zsync based).
 * Stable follows GitHub's "latest" release; canary and unstable follow their pointer release,
 * because pre-releases cannot be addressed with "latest".
 */
export function updateInformation({ channel, owner, repo, appName }) {
  if (channel === 'stable') {
    return `gh-releases-zsync|${owner}|${repo}|latest|${appName}-*-${ARCH}.AppImage.zsync`;
  }
  const pointer = POINTER_TAGS[channel];
  if (!pointer) throw new Error(`Channel "${channel}" has no update pointer.`);
  return `gh-releases-zsync|${owner}|${repo}|${pointer}|${pointerFileName(appName)}.zsync`;
}

export function desktopEntry({ productName, version, channel, identifier, appName }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${productName}`,
    `GenericName=Redmine client (${channel} channel)`,
    `Comment=Redmine client, ${channel} channel`,
    'Exec=AppRun %U',
    `Icon=${identifier}`,
    'Terminal=false',
    'Categories=Development;ProjectManagement;',
    `StartupWMClass=${appName}`,
    `X-AppImage-Name=${productName}`,
    `X-AppImage-Version=${version}`,
    `X-AppImage-Identifier=${identifier}`,
    '',
  ].join('\n');
}

/**
 * Starts the bundled executable, `binary` being its path inside the AppImage, for example usr/bin/Gemiredmine.
 * The app runs on X11 (through XWayland on a Wayland desktop) unless the user sets GDK_BACKEND: windows
 * that follow each other across the screen need the pointer position, which Wayland does not give, and
 * the previous desktop shell forced X11 too.
 */
export function appRunScript(binary) {
  return [
    '#!/bin/sh',
    '# Starts the app from the AppImage mount point.',
    'HERE="$(dirname "$(readlink -f "$0")")"',
    'export GDK_BACKEND="${GDK_BACKEND:-x11}"',
    `exec "$HERE/${binary}" "$@"`,
    '',
  ].join('\n');
}

/** Metadata the publish step reads. Written next to the artifacts, so publishing never recomputes anything. */
export function releaseMetadata({ channel, platform = 'linux', version, commit, commitSha = commit, tag, pointerTag = null, assets }) {
  return { channel, platform, version, commit, commitSha, tag, pointerTag, assets };
}
