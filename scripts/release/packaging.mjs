// The packaging information that every platform shows for the app: who makes it, what it is, and where to find it.
// Each platform reads it from here, so the Flatpak's AppStream file, the Windows package and the properties of its
// executable, and the Tauri bundle settings all say the same thing. The developer's name is shown to the user, so it is
// set once and not in each platform's file.
import { REPOSITORY_URL } from './channels.mjs';

/** The developer. `id` is a reverse-DNS name, as AppStream asks for; `name` is what people read. */
export const PUBLISHER = Object.freeze({ id: 'com.github.iVegas', name: 'iVegas' });

/** What the app is, in one line, as software centres and the Windows store show it. */
export const SUMMARY = 'Redmine client';

/** What the app does, in a paragraph. */
export const DESCRIPTION =
  'Gemiredmine is a desktop client for Redmine. It shows the tasks assigned to you, your calendar and your to-do list, ' +
  'and it lets you log time and edit tasks and time logs, on any number of Redmine servers. Redmine decides what you may change.';

/** The category of the app, in Tauri's list of bundle categories. */
export const CATEGORY = 'Productivity';

/** The licence of the descriptions above, which software centres read. Public-domain dedication, as AppStream recommends. */
export const METADATA_LICENSE = 'CC0-1.0';

/** The copyright notice. The year is the year of the build, so each release says when it was made. */
export function copyrightNotice(buildDate) {
  return `Copyright © ${buildDate.slice(0, 4)} ${PUBLISHER.name}`;
}

/**
 * The packaging settings of one channel's Tauri bundle. Tauri writes the publisher and the copyright into the properties
 * of the Windows executable, and the rest into the bundles it makes.
 *
 * @param {ReturnType<typeof import('./channels.mjs').deriveBuildInfo>} info
 */
export function bundlePackaging(info) {
  return {
    publisher: PUBLISHER.name,
    copyright: copyrightNotice(info.buildDate),
    shortDescription: SUMMARY,
    longDescription: DESCRIPTION,
    homepage: REPOSITORY_URL,
    category: CATEGORY,
  };
}
