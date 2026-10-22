/** Metadata the publish step reads. Written next to the artifacts, so publishing never recomputes anything. */
export function releaseMetadata({ channel, platform, version, commit, commitSha = commit, tag, pointerTag = null, assets }) {
  return { channel, platform, version, commit, commitSha, tag, pointerTag, assets };
}
