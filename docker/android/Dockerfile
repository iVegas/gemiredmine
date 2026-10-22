# Builds the Android APK in isolation. Nothing is installed on the host.
#
#   docker build -f docker/android/Dockerfile --target check .
#   docker build -f docker/android/Dockerfile --build-arg CHANNEL=unstable \
#     --output type=local,dest=dist/android-build .
#
# `check` runs the tests and the type check. The default target builds the release APK of CHANNEL (dev unless set)
# into dist/android-build. The stage order is the cache order: the toolchains change rarely, the dependencies change
# with package-lock.json, and the source changes most.

FROM node:24-bookworm AS base

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    NDK_HOME=/opt/android-sdk/ndk/27.2.12479018 \
    RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:$PATH \
    HUSKY=0

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

# Android SDK: the platform, build tools and the NDK that compiles the Rust crate for the device.
RUN curl -fsSL -o /tmp/cmdline-tools.zip \
      https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && unzip -q /tmp/cmdline-tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/cmdline-tools.zip \
 && yes | sdkmanager --licenses \
 && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.2.12479018"

# Rust, at the version rust-toolchain.toml pins, with the device target.
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.99.0 \
 && rustup target add aarch64-linux-android

FROM base AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

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
