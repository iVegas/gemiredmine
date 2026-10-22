# The Android build environment: the JDK, the Android SDK and NDK, and Rust with the device target. Nothing comes from
# the host. The build (docker/android/Dockerfile) starts from this image, and CI pulls the published copy, so no run
# downloads these again.
#
#   docker build -f docker/android/env.Dockerfile -t gemiredmine-android-env .
#
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
