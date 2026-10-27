import { DESCRIPTION, METADATA_LICENSE, PUBLISHER, SUMMARY } from './packaging.mjs';

// The AppStream metadata of the Flatpak app: what software centres such as GNOME Software show for it. It names the
// version of the build, its developer and its licence. Without this file, a software centre shows the Flatpak branch
// name (master) in place of the version, and no developer or licence at all.

const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The AppStream component of one channel's build. `info` is the build's BuildInfo (see channels.mjs); `projectLicense`
 * is the licence of the app's code, from package.json.
 */
export function metainfoXml(info, { appId, projectLicense }) {
  const released = info.buildDate.slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${escape(appId)}</id>
  <launchable type="desktop-id">${escape(appId)}.desktop</launchable>
  <name>${escape(info.productName)}</name>
  <summary>${escape(SUMMARY)}</summary>
  <developer id="${escape(PUBLISHER.id)}">
    <name>${escape(PUBLISHER.name)}</name>
  </developer>
  <metadata_license>${METADATA_LICENSE}</metadata_license>
  <project_license>${escape(projectLicense)}</project_license>
  <description>
    <p>${escape(DESCRIPTION)}</p>
  </description>
  <url type="homepage">${escape(info.repositoryUrl)}</url>
  <categories>
    <category>Development</category>
  </categories>
  <provides>
    <binary>${escape(info.appName)}</binary>
  </provides>
  <content_rating type="oars-1.1"/>
  <releases>
    <release version="${escape(info.version)}" date="${released}"/>
  </releases>
</component>
`;
}
