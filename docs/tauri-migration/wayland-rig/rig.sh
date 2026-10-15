#!/bin/sh
# A Wayland test rig: a headless sway (1280x900), and a virtual pointer you drive through a FIFO.
#
#   rig.sh start              build the virtual pointer if needed, start sway and the pointer
#   rig.sh ptr "move 300 109" "wait 150" "down" "wait 300" "move 900 300" "up"
#   rig.sh click X Y          move, press and release the primary button
#   rig.sh type "text"        type into the focused window (wtype; the first key of a new keyboard is lost, so a
#                             Shift press comes first)
#   rig.sh shot FILE.png      screenshot (grim)
#   rig.sh windows            list the app's windows and where sway put them
#   rig.sh app [args]         run the unstable build natively on Wayland (no DISPLAY)
#   rig.sh stop
#
# Needs: sway grim wtype libwayland-dev libwayland-bin gcc curl (apt), and network access to
# raw.githubusercontent.com once, for the virtual-pointer protocol file. The sockets live in /tmp/wr, because the
# path of a Unix socket is limited to about 100 characters.
HERE=$(cd "$(dirname "$0")" && pwd)
RIG=${RIG_DIR:-/tmp/wayland-rig}   # build output, the FIFO and logs
RUN=/tmp/wr
mkdir -p "$RIG"
export XDG_RUNTIME_DIR=$RUN WAYLAND_DISPLAY=wayland-1
unset DISPLAY

case "$1" in
start)
  "$0" stop
  mkdir -p $RUN && chmod 700 $RUN
  if [ ! -x "$RIG/vptr" ]; then
    curl -fsS -o "$RIG/vp.xml" https://raw.githubusercontent.com/swaywm/wlr-protocols/master/unstable/wlr-virtual-pointer-unstable-v1.xml || exit 1
    wayland-scanner client-header "$RIG/vp.xml" "$RIG/vp.h"
    wayland-scanner private-code "$RIG/vp.xml" "$RIG/vp.c"
    gcc -O1 -I"$RIG" -o "$RIG/vptr" "$HERE/vptr.c" "$RIG/vp.c" $(pkg-config --cflags --libs wayland-client) || exit 1
  fi
  (WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman nohup sway -c "$HERE/sway.conf" > "$RIG/sway.log" 2>&1 &)
  for i in 1 2 3 4 5 6 7 8 9 10; do [ -S $RUN/wayland-1 ] && ls $RUN/sway-ipc.*.sock >/dev/null 2>&1 && break; sleep 1; done
  rm -f "$RIG/ptr.fifo"; mkfifo "$RIG/ptr.fifo"
  (sleep 100000 > "$RIG/ptr.fifo" &)   # keeps the FIFO open between commands
  (nohup "$RIG/vptr" 1280 900 < "$RIG/ptr.fifo" > "$RIG/vptr.log" 2>&1 &)
  sleep 1; echo started ;;
stop)
  pkill -x sway; pkill -x vptr; pkill -f "sleep 100000"; rm -rf $RUN; true ;;
ptr)
  shift; for c in "$@"; do echo "$c" > "$RIG/ptr.fifo"; sleep 0.05; done ;;
click)
  "$0" ptr "move $2 $3" "wait 150" down "wait 120" up; sleep "${4:-0.4}" ;;
type)
  wtype -k Shift_L -s 400 -d 30 "$2" ;;
shot)
  grim "$2" ;;
windows)
  export SWAYSOCK=$(ls $RUN/sway-ipc.*.sock | head -1)
  swaymsg -t get_tree | python3 -c "
import json,sys
def walk(n):
    if n.get('app_id'): print(n.get('app_id'), repr(n.get('name')), n['rect']['x'], n['rect']['y'], n['rect']['width'], n['rect']['height'])
    for c in n.get('nodes',[])+n.get('floating_nodes',[]): walk(c)
walk(json.load(sys.stdin))" ;;
app)
  shift
  cd "$HERE/../../.." && XDG_DATA_HOME="$RIG/xdg" nohup src-tauri/target/release/Gemiredmine-Unstable "$@" > "$RIG/app.log" 2>&1 & ;;
*)
  sed -n 2,16p "$0"; exit 2 ;;
esac
