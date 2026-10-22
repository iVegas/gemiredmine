# The Android project's dependencies: the npm packages and the Cargo crates that the lockfiles pin, on top of the
# environment. build-images.yml publishes it, tagged with the hash of the lockfiles, so a build starts with them installed.
#
#   docker build -f docker/android/deps.Dockerfile --build-arg ENV_IMAGE=gemiredmine-android-env -t gemiredmine-android-deps .
ARG ENV_IMAGE=gemiredmine-android-env
FROM ${ENV_IMAGE}

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci

COPY src-tauri src-tauri
RUN cargo fetch --locked --manifest-path src-tauri/Cargo.toml
