#!/bin/sh
# Builds the Flatpak bundle of one release channel. Run inside the Flatpak environment image
# (docker/flatpak/env.Dockerfile), with the repository mounted at /work:
#
#   docker run --rm --privileged -v "$PWD:/work" -e CHANNEL=unstable gemiredmine-flatpak-env scripts/release/flatpak-build.sh
#
# The repository is copied to a scratch folder first, so the build writes nothing into the mounted checkout except
# the bundle, in dist/flatpak/<channel>/. Downloads happen here, before flatpak-builder, which then builds offline.
set -eu

channel="${CHANNEL:?Set CHANNEL to stable, canary, unstable or dev.}"
src=/work
scratch=/tmp/flatpak
out="/work/dist/flatpak/$channel"

rm -rf "$scratch"
mkdir -p "$scratch/src" "$out"
(cd "$src" && tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=build \
    --exclude=src-tauri/target --exclude=src-tauri/gen -cf - .) | (cd "$scratch/src" && tar -xf -)

cd "$scratch/src"
# The generators list every crate and npm package by its checksum; flatpak-builder downloads and verifies them.
flatpak-cargo-generator.py src-tauri/Cargo.lock -o "$scratch/cargo-sources.json"
flatpak-node-generator npm package-lock.json -o "$scratch/node-sources.json"
node scripts/release/flatpak-manifest.mjs > "$scratch/manifest.json"
app_id="$(node -p "require('$scratch/manifest.json')['app-id']")"

cd "$scratch"
flatpak-builder --force-clean --disable-rofiles-fuse --repo=repo build manifest.json
flatpak build-bundle repo "$out/bundle.flatpak" "$app_id"
echo "$app_id" > "$out/app-id.txt"
# This runs as root in the container, so the bundle and the folders above it are root's in the mounted checkout. The
# packaging step runs as the runner's user and could not write into dist/. Give them back to the checkout's owner.
chown -R "$(stat -c '%u:%g' /work)" /work/dist
echo "bundle: $out/bundle.flatpak ($app_id)"
