# Builds the Android APK in isolation. Nothing is installed on the host.
#
#   docker build -f docker/android/Dockerfile --target check .
#   docker build -f docker/android/Dockerfile --output type=local,dest=dist/android .
#
# `check` runs the tests and the type check. The default target builds the release APK into dist/android.
# The stage order is the cache order: the toolchains change rarely, the dependencies change with
# package-lock.json, and the source changes most.

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
# The release channel names the build; the Android identifier is the same for every channel.
ARG CHANNEL=stable
ENV CHANNEL=$CHANNEL
# Generates src-tauri/gen/android, then builds the release APK for the device architecture. The overlay sets the one
# Android identifier, so the generated project and the build agree. Without a keystore the APK is unsigned.
RUN --mount=type=cache,target=/opt/cargo/registry \
    --mount=type=cache,target=/root/.gradle \
    npx tauri android init --ci --config "$(node scripts/release/android-config.mjs)" \
 && npx tauri android build --apk --target aarch64 --config "$(node scripts/release/android-config.mjs)"

FROM scratch AS artifact
COPY --from=build /src/src-tauri/gen/android/app/build/outputs/apk/ /
