# The Flatpak build environment: flatpak-builder, the Flathub runtimes, the source generators and the test tools.
# Nothing comes from the host. flatpak-build.sh runs in a container started from this image, so the host needs only
# Docker. CI pulls the published image (scripts/release/image-tags.sh flatpak).
#
#   docker build -f docker/flatpak/env.Dockerfile -t gemiredmine-flatpak-env .
#
# The runtimes are the Flathub branches for GNOME 51 (freedesktop 26.08). Rust is not in them: the app's manifest
# installs the Rust release that rust-toolchain.toml pins.
FROM node:24-bookworm

# The generators come from one pinned commit of flatpak/flatpak-builder-tools, so every build uses the same ones.
ARG FLATPAK_BUILDER_TOOLS=74697c75b630d7330e77250fc13cb5ea688d9479
ARG CARGO_GENERATOR_SHA256=0a2db6be87d75910facef28ab46d4d6460802e8419ab850d0caa6a364d26b380

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      flatpak flatpak-builder git ca-certificates curl python3 python3-venv \
      xz-utils elfutils xvfb xauth weston \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/generators \
 && /opt/generators/bin/pip install --no-cache-dir \
      "git+https://github.com/flatpak/flatpak-builder-tools.git@${FLATPAK_BUILDER_TOOLS}#subdirectory=node" \
      aiohttp PyYAML tomlkit \
 && curl -fsSL -o /opt/generators/flatpak-cargo-generator.py \
      "https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/${FLATPAK_BUILDER_TOOLS}/cargo/flatpak-cargo-generator.py" \
 && echo "${CARGO_GENERATOR_SHA256}  /opt/generators/flatpak-cargo-generator.py" | sha256sum -c -

# Downloads from Flathub can drop mid-transfer, so the install is retried.
RUN flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo \
 && for attempt in 1 2 3 4; do \
      flatpak install --system -y --noninteractive flathub \
        org.gnome.Platform//51 \
        org.gnome.Sdk//51 \
        org.freedesktop.Sdk.Extension.node24//26.08 && break; \
      [ "$attempt" = 4 ] && exit 1; sleep 30; \
    done

# The cargo generator runs with the generators' Python, which has its dependencies, and is on the PATH by name.
RUN sed -i '1s|.*|#!/opt/generators/bin/python3|' /opt/generators/flatpak-cargo-generator.py \
 && chmod 755 /opt/generators/flatpak-cargo-generator.py \
 && ln -s /opt/generators/flatpak-cargo-generator.py /opt/generators/bin/flatpak-cargo-generator.py

ENV PATH=/opt/generators/bin:$PATH
WORKDIR /work
