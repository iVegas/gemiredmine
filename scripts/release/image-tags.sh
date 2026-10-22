#!/usr/bin/env bash
# Prints the published image names a build starts from. The tag is the hash of what the image is built from, so an
# image is reused exactly while its inputs are unchanged. Usage: image-tags.sh android|flatpak
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
registry="ghcr.io/ivegas"

case "${1:-}" in
  android)
    env_tag="$(sha256sum "$root/docker/android/env.Dockerfile" | cut -c1-12)"
    deps_tag="$(cat "$root/docker/android/deps.Dockerfile" "$root/package-lock.json" "$root/src-tauri/Cargo.lock" \
      | sha256sum | cut -c1-12)"
    echo "ENV=$registry/gemiredmine-android-env:$env_tag"
    echo "DEPS=$registry/gemiredmine-android-deps:${deps_tag}-${env_tag}"
    ;;
  flatpak)
    env_tag="$(sha256sum "$root/docker/flatpak/env.Dockerfile" | cut -c1-12)"
    echo "ENV=$registry/gemiredmine-flatpak-env:$env_tag"
    ;;
  *)
    echo "Usage: image-tags.sh android|flatpak" >&2
    exit 2
    ;;
esac
