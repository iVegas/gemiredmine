#!/bin/bash
# A rig for trying the app against a real credential store on Linux: a private D-Bus session with an unlocked GNOME
# Keyring (the Secret Service), a virtual display, and the mock Redmine. See docs/tauri-migration/progress.md, "Recipes".
#
#   apt install gnome-keyring libsecret-tools dbus dbus-x11 xvfb xdotool scrot x11-utils metacity
#   CHANNEL=unstable npm run build:desktop
#
#   rig.sh start                  start the keyring, the display and the mock Redmine (port 18123)
#   rig.sh app [VAR=value ...]    start the app in the session that has the keyring
#   rig.sh appbare [VAR=value]    start it in a session where the Secret Service is only "activatable": every call hangs
#   rig.sh second                 start a second copy of the same channel (it must end at once, and exit 0)
#   rig.sh keys                   what the keyring holds for the app (the secret is the API key)
#   rig.sh shot FILE              a screenshot
#   rig.sh kill [-SIGNAL]         end the app (default SIGTERM; -KILL for an unclean end)
#   rig.sh stop                   stop everything
#
# Environment: WORK (a folder for the rig's files; default /tmp/gemiredmine-keyring-rig), BIN (the executable; default the
# unstable build), CHANNEL_ID (the service name in the keyring; default com.gemiredmine.app.unstable).
# Other recipes: a bogus bus (`rig.sh app DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent`) is an app with no session bus;
# `secret-tool store --label=x service <CHANNEL_ID> username server:<id>` puts any key in the keyring.
# Run `metacity --replace --sm-disable &` on the display to try minimising and bringing the window forward.
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
WORK=${WORK:-/tmp/gemiredmine-keyring-rig}
BIN=${BIN:-$ROOT/src-tauri/target/release/Gemiredmine-Unstable}
CHANNEL_ID=${CHANNEL_ID:-com.gemiredmine.app.unstable}
export XDG_RUNTIME_DIR=$WORK/run
export DISPLAY=:99
case "$1" in
  start)
    mkdir -p "$WORK/run" "$WORK/xdg"; chmod 700 "$WORK/run"
    dbus-launch --sh-syntax > "$WORK/dbus.env"
    . "$WORK/dbus.env"
    echo -n "keyring-pass" | gnome-keyring-daemon --unlock --components=secrets --daemonize > "$WORK/keyring.log" 2>&1
    dbus-launch --sh-syntax > "$WORK/dbus-bare.env"
    node "$ROOT/scripts/dev/mock-redmine.mjs" --port 18123 > "$WORK/mock.log" 2>&1 &
    echo $! > "$WORK/mock.pid"
    Xvfb :99 -screen 0 1280x900x24 > "$WORK/xvfb.log" 2>&1 &
    echo $! > "$WORK/xvfb.pid"
    sleep 3; echo "rig started in $WORK" ;;
  app)
    shift; . "$WORK/dbus.env"
    XDG_DATA_HOME=$WORK/xdg env "$@" "$BIN" > "$WORK/app.log" 2>&1 &
    echo $! > "$WORK/app.pid"; echo "app pid $(cat "$WORK/app.pid")" ;;
  appbare)
    shift; . "$WORK/dbus-bare.env"
    XDG_DATA_HOME=$WORK/xdg env "$@" "$BIN" > "$WORK/app.log" 2>&1 &
    echo $! > "$WORK/app.pid"; echo "app (hanging Secret Service) pid $(cat "$WORK/app.pid")" ;;
  second)
    . "$WORK/dbus.env"; XDG_DATA_HOME=$WORK/xdg "$BIN"; echo "second copy exit code: $?" ;;
  keys)
    . "$WORK/dbus.env"; secret-tool search --all service "$CHANNEL_ID" 2>&1 | grep -E "^(secret|attribute\.username|label)" ;;
  kill)
    kill "${2:--TERM}" "$(cat "$WORK/app.pid")" 2>/dev/null; sleep 1
    # The whole command line, anchored: `pgrep -x` cannot match a name of more than 15 characters.
    pgrep -f "^$BIN\$" > /dev/null && echo "app still running" || echo "app gone" ;;
  shot) scrot -o "$2" ;;
  stop)
    kill "$(cat "$WORK/mock.pid")" "$(cat "$WORK/xvfb.pid")" 2>/dev/null
    . "$WORK/dbus.env"; kill "$DBUS_SESSION_BUS_PID" 2>/dev/null
    . "$WORK/dbus-bare.env"; kill "$DBUS_SESSION_BUS_PID" 2>/dev/null
    pkill -x gnome-keyring-d 2>/dev/null; echo stopped ;;
  *) sed -n 2,22p "$0" ;;
esac
