#!/bin/sh
# Installs a Flatpak bundle on the system, then runs the installed app with smoke-test-wayland.sh: it has to open a
# window on a headless Wayland compositor and keep running. The app ID comes from app-id.txt, which flatpak-build.sh
# writes next to the bundle.
#
# Usage: smoke-test-flatpak.sh <bundle.flatpak>
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <bundle.flatpak>" >&2
  exit 2
fi

bundle="$1"
app_id="$(cat "$(dirname "$bundle")/app-id.txt")"
flatpak install --system -y --noninteractive --bundle "$bundle" > /dev/null

# The app loads its icons through a loader that talks to a D-Bus session bus. The CI container has none, and GTK aborts
# without it, so the app runs under a session bus of its own. dbus-run-session is in the environment image.
if ! command -v dbus-run-session > /dev/null 2>&1; then
  echo "::error title=Smoke test::dbus-run-session is not installed; the environment image needs the dbus package." >&2
  exit 1
fi

# The sandbox binds the Wayland socket named wayland-0; WAYLAND_DEBUG is set inside the sandbox, where the app runs.
SMOKE_SOCKET=wayland-0 "$(dirname "$0")/smoke-test-wayland.sh" \
  dbus-run-session -- flatpak run --env=WAYLAND_DEBUG=1 "$app_id"
