# The environment (docker/android/env.Dockerfile) and the dependencies (docker/android/deps.Dockerfile) are separate
# images. CI pulls the published copies; locally, build them first and pass the deps image in DEPS_IMAGE.
#
#   docker build -f docker/android/env.Dockerfile -t gemiredmine-android-env .
#   docker build -f docker/android/deps.Dockerfile --build-arg ENV_IMAGE=gemiredmine-android-env -t gemiredmine-android-deps .
#   docker build -f docker/android/Dockerfile --target check .
#   docker build -f docker/android/Dockerfile --build-arg CHANNEL=unstable \
#     --output type=local,dest=dist/android-build .
#
# `check` runs the tests and the type check. The default target builds the release APK of CHANNEL (dev unless set)
# into dist/android-build. The stage order is the cache order: the dependencies change with the lockfiles, and the
# source changes most.

ARG DEPS_IMAGE=gemiredmine-android-deps
FROM ${DEPS_IMAGE} AS deps
WORKDIR /src

FROM deps AS check
COPY . .
RUN npm test && npm run typecheck

FROM deps AS build
COPY . .
# The release channel names the build: its identifier, name, version and icon all come from channels.mjs.
# GITHUB_RUN_NUMBER is the unstable build number, and GITHUB_SHA the commit the build records.
ARG CHANNEL=dev
ARG GITHUB_RUN_NUMBER=0
ARG GITHUB_SHA=unknown
ENV CHANNEL=$CHANNEL GITHUB_RUN_NUMBER=$GITHUB_RUN_NUMBER GITHUB_SHA=$GITHUB_SHA
# Generates src-tauri/gen/android for this channel, sets the channel's icon, then builds the release APK for the
# device architecture.
#
# The signing secrets are optional. Given `android_keystore_properties` (the keystore.properties file, whose storeFile
# points at /run/secrets/android_keystore) and `android_keystore`, the APK is signed. Without them it is unsigned.
RUN --mount=type=cache,target=/opt/cargo/registry \
    --mount=type=cache,target=/root/.gradle \
    --mount=type=secret,id=android_keystore \
    --mount=type=secret,id=android_keystore_properties \
    npx tauri android init --ci --config "$(node scripts/release/android-config.mjs)" \
 && npx tauri icon "assets/icons/${CHANNEL}.png" \
 && python3 scripts/release/patch-android-signing.py src-tauri/gen/android/app/build.gradle.kts \
 && if [ -f /run/secrets/android_keystore_properties ]; then \
      cp /run/secrets/android_keystore_properties src-tauri/gen/android/keystore.properties; \
    fi \
 && npx tauri android build --apk --target aarch64 $(node scripts/release/android-config.mjs features) \
      --config "$(node scripts/release/android-config.mjs)"

FROM scratch AS artifact
COPY --from=build /src/src-tauri/gen/android/app/build/outputs/apk/ /
