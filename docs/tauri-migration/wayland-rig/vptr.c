// A virtual pointer for a wlroots compositor. Reads commands on stdin:
//   move X Y   (absolute, in output pixels)   down   up   click   wait MS
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <wayland-client.h>
#include "vp.h"

static struct zwlr_virtual_pointer_manager_v1 *mgr;
static struct wl_seat *seat;
static void global(void *d, struct wl_registry *r, uint32_t name, const char *iface, uint32_t ver) {
  if (!strcmp(iface, zwlr_virtual_pointer_manager_v1_interface.name))
    mgr = wl_registry_bind(r, name, &zwlr_virtual_pointer_manager_v1_interface, 1);
  else if (!strcmp(iface, "wl_seat") && !seat)
    seat = wl_registry_bind(r, name, &wl_seat_interface, 1);
}
static void gremove(void *d, struct wl_registry *r, uint32_t n) {}
static const struct wl_registry_listener rl = {global, gremove};

static uint32_t now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

int main(int argc, char **argv) {
  int W = argc > 1 ? atoi(argv[1]) : 1280, H = argc > 2 ? atoi(argv[2]) : 900;
  struct wl_display *dpy = wl_display_connect(NULL);
  if (!dpy) { fprintf(stderr, "no display\n"); return 1; }
  struct wl_registry *reg = wl_display_get_registry(dpy);
  wl_registry_add_listener(reg, &rl, NULL);
  wl_display_roundtrip(dpy);
  if (!mgr) { fprintf(stderr, "no virtual pointer manager\n"); return 1; }
  struct zwlr_virtual_pointer_v1 *vp = zwlr_virtual_pointer_manager_v1_create_virtual_pointer(mgr, seat);
  wl_display_roundtrip(dpy);
  setvbuf(stdout, NULL, _IOLBF, 0);
  char line[256];
  while (fgets(line, sizeof line, stdin)) {
    int x, y, ms;
    if (sscanf(line, "move %d %d", &x, &y) == 2) {
      zwlr_virtual_pointer_v1_motion_absolute(vp, now(), x, y, W, H);
      zwlr_virtual_pointer_v1_frame(vp);
    } else if (!strncmp(line, "down", 4)) {
      zwlr_virtual_pointer_v1_button(vp, now(), 0x110, WL_POINTER_BUTTON_STATE_PRESSED);
      zwlr_virtual_pointer_v1_frame(vp);
    } else if (!strncmp(line, "up", 2)) {
      zwlr_virtual_pointer_v1_button(vp, now(), 0x110, WL_POINTER_BUTTON_STATE_RELEASED);
      zwlr_virtual_pointer_v1_frame(vp);
    } else if (sscanf(line, "wait %d", &ms) == 1) {
      wl_display_flush(dpy); usleep(ms * 1000); continue;
    } else if (!strncmp(line, "quit", 4)) break;
    wl_display_flush(dpy);
    wl_display_roundtrip(dpy);
    printf("ok\n");
  }
  return 0;
}
