#!/usr/bin/env bash
# Builds and pushes one image, unless its tag is already published. The tags come from image-tags.sh and are hashes of
# what each image is built from, so a published tag already holds what this build would make. Pushing it again only
# risks a registry error, as happened on main (a push of the Android dependencies failed with "unknown blob").
# Usage: build-image-once.sh <image tag> <docker buildx build arguments, without -t or --push>
set -eu

tag="$1"
shift

if output="$(docker buildx imagetools inspect "$tag" 2>&1)"; then
  echo "Already published, so not built again: $tag"
  exit 0
fi

# Only a tag that is not there means "build it". Any other failure, such as a registry outage or a login problem,
# stops the job, so a missing image is never confused with an unreachable registry.
case "$output" in
  *"not found"* | *"manifest unknown"* | *"NAME_UNKNOWN"*) ;;
  *)
    echo "$output" >&2
    echo "::error title=Image check::Could not check whether $tag is published." >&2
    exit 1
    ;;
esac

docker buildx build "$@" -t "$tag" --push .
echo "Pushed $tag"
