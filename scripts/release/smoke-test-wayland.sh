#!/bin/sh
# Starts a command (the app, or `flatpak run <app-id>`) on a headless Wayland compositor and
# checks that it opens a window as a Wayland client and keeps running.
#
# Usage: smoke-test-wayland.sh <command> [arguments...]
#
# Wayland is the target on Linux, so this runs without X11: DISPLAY is unset and there is no X server to fall back
# to. WAYLAND_DEBUG makes libwayland log every request the app makes, and the window is proven by the app's own
# xdg_toplevel.set_app_id call, which does not depend on the compositor.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [arguments...]" >&2
  exit 2
fi

SOCKET="${SMOKE_SOCKET:-gemiredmine-smoke}"   # a Flatpak run needs the socket name the sandbox binds (wayland-0)
OPEN_TIMEOUT=${SMOKE_OPEN_TIMEOUT:-40}   # seconds to wait for the window
STAY_FOR=5        # seconds it has to keep running after the window opened

runtime=$(mktemp -d "${TMPDIR:-/tmp}/wayland-smoke.XXXXXX")
chmod 700 "$runtime"
export XDG_RUNTIME_DIR="$runtime"
log="$runtime/app.log"
weston_log="$runtime/weston.log"
app_pid=""
weston_pid=""

cleanup() {
  # The app was started in a process group of its own, so that its helper processes end with it.
  [ -n "$app_pid" ] && kill -- "-$app_pid" 2>/dev/null
  [ -n "$weston_pid" ] && kill "$weston_pid" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$runtime"
}
trap cleanup EXIT

fail() {
  echo "::error title=Wayland smoke test::$1"
  echo "--- app output (last 40 lines)"
  grep -v '^\[' "$log" 2>/dev/null | tail -n 40
  echo "--- app protocol log (last 15 lines)"
  tail -n 15 "$log" 2>/dev/null
  echo "--- compositor output"
  tail -n 20 "$weston_log" 2>/dev/null
  exit 1
}

# Weston names its headless backend by version: headless-backend.so in some releases, headless in others. The module
# that is installed decides, so the check holds across distributions.
if find /usr/lib -path '*libweston-*/headless-backend.so' 2>/dev/null | grep -q .; then
  backend=headless-backend.so
  renderer=--use-pixman
else
  backend=headless
  renderer=--renderer=pixman
fi

weston --backend="$backend" "$renderer" --socket="$SOCKET" --width=1280 --height=720 --idle-time=0 \
  > "$weston_log" 2>&1 &
weston_pid=$!

i=0
while [ ! -S "$runtime/$SOCKET" ]; do
  i=$((i + 1))
  kill -0 "$weston_pid" 2>/dev/null || fail "The Wayland compositor did not start."
  [ "$i" -gt 30 ] && fail "The Wayland compositor did not create its socket."
  sleep 0.5
done

echo "Starting: $*"
setsid env -u DISPLAY WAYLAND_DISPLAY="$SOCKET" WAYLAND_DEBUG=1 "$@" > "$log" 2>&1 &
app_pid=$!

waited=0
until grep -q 'xdg_toplevel@[0-9]*\.set_app_id("Gemiredmine' "$log" 2>/dev/null; do
  kill -0 "$app_pid" 2>/dev/null || fail "The app exited before it opened a window."
  waited=$((waited + 1))
  [ "$waited" -gt "$OPEN_TIMEOUT" ] && fail "The app opened no Wayland window within $OPEN_TIMEOUT seconds."
  sleep 1
done
echo "The app opened a window after about $waited seconds."

sleep "$STAY_FOR"
kill -0 "$app_pid" 2>/dev/null || fail "The app exited within $STAY_FOR seconds of opening its window."
echo "The app is still running."
