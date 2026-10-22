#!/bin/sh
# Points Cargo at the crates that flatpak-cargo-generator vendored into cargo/vendor, in the build folder. Cargo looks for
# its config from the folder it runs in, and the desktop build runs from the repository root, so the config goes there.
# The path is absolute, so the config does not depend on where Cargo's manifest is.
set -eu
mkdir -p .cargo
cat > .cargo/config.toml <<EOT
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "$(pwd)/cargo/vendor"
EOT
