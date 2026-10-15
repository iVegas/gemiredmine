// Geometry and addressing for view windows, shared by the tab strip in the webview (dragging a
// tab within its window) and the Bun side (dragging a view's own window back over the tab strip).

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A tab's left and right edges, in the same horizontal coordinates as the pointer. */
export interface TabEdges {
  left: number;
  right: number;
}

/**
 * The gap a tab dropped at `x` goes into: 0 is before the first tab and `tabs.length` after the
 * last. Tabs are in display order, left to right. Gaps before `firstMovable` are never chosen,
 * so pinned tabs keep their place.
 */
export function dropGap(x: number, tabs: readonly TabEdges[], firstMovable = 0): number {
  const gap = tabs.filter(tab => (tab.left + tab.right) / 2 < x).length;
  return Math.max(firstMovable, gap);
}

/** Whether `point` is inside `rect`, or within `margin` of it. */
export function containsPoint(rect: Rect, point: Point, margin = 0): boolean {
  return (
    point.x >= rect.x - margin &&
    point.x <= rect.x + rect.width + margin &&
    point.y >= rect.y - margin &&
    point.y <= rect.y + rect.height + margin
  );
}

/**
 * The data type of a view that is dragged from its own window onto the main window's tabs. It is a drag and
 * drop between two windows of the app, which the system routes, so it needs no position on screen: that is
 * what a Wayland session does not give an application.
 */
export const VIEW_DRAG_TYPE = 'application/x-gemiredmine-view';

/** The view id in dropped data, or null when the data is not a plain view id. */
export function viewFromDragData(data: string): string | null {
  return /^[a-z]+$/.test(data) ? data : null;
}

const VIEW_PARAM = 'view';

/** The URL fragment that makes the webview show one view in a window of its own. */
export function viewWindowHash(view: string): string {
  return `#${VIEW_PARAM}=${encodeURIComponent(view)}`;
}

/** The view named by a view window's URL fragment, or null in the main window. */
export function viewFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(VIEW_PARAM);
}

/**
 * JSON with the keys of every object in alphabetical order, so that two values that mean the same thing
 * give the same text. Windows compare what they have with what they were sent, and the events that carry
 * the data between windows do not keep the order of an object's keys.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}
