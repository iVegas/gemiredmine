<script lang="ts">
  import { tick } from 'svelte';
  import {
    VIEW_TITLES,
    activeView,
    closeView,
    firstMovableIndex,
    isClosable,
    moveView,
    openViews,
    viewPanelId,
    viewTabId,
    type ViewId,
  } from './lib/views';
  import { canDetachViews, detachView, detachedViews, reportTabStrip, windowDropTarget } from './lib/windows';
  import { dropGap, type Point, type TabEdges } from '../shared/windows';

  /**
   * Whether tabs can be dragged to a new place, or out of the window into one of their own.
   * A view window's single tab cannot.
   */
  export let movable = true;

  /** How far the pointer moves, in pixels, with the button held, before a press becomes a drag. */
  const DRAG_THRESHOLD = 5;

  interface TabDrag {
    view: ViewId;
    pointerId: number;
    startX: number;
    startY: number;
    /** False until the pointer has moved far enough to make this a drag rather than a click. */
    moving: boolean;
    /** The gap between tabs the tab would be dropped in. */
    gap: number | null;
    /** The pointer is outside the window: dropping opens the view in a window of its own. */
    outside: boolean;
  }

  const tabs: Partial<Record<ViewId, HTMLButtonElement>> = {};
  let strip: HTMLDivElement;
  let drag: TabDrag | null = null;
  /** Set when a drag ends, so that the click it causes does not count. */
  let dragEnded = false;
  let announcement = '';
  /** Screen position of the webview's top-left corner, from the latest pointer event. */
  let origin: Point | null = null;

  $: firstMovable = firstMovableIndex($openViews);
  // The drop indicator shows where the dragged tab, or a view window dragged over the strip, would go.
  $: indicator = drag?.moving ? movedGap(drag, $openViews) : ($windowDropTarget?.index ?? null);
  // While views have windows of their own, the backend needs to know where the tabs are.
  $: tracking = movable && $detachedViews.length > 0;
  $: if (tracking) reportAfterRender($openViews);

  function movableTab(view: ViewId) {
    return movable && isClosable(view);
  }

  /** The gap to show for a drag, unless dropping there would leave the tab where it is. */
  function movedGap({ view, gap }: TabDrag, views: ViewId[]) {
    const from = views.indexOf(view);
    return gap === null || gap === from || gap === from + 1 ? null : gap;
  }

  async function focusTab(view?: ViewId) {
    await tick();
    tabs[view ?? $activeView]?.focus();
  }

  function select(view: ViewId) {
    activeView.set(view);
    focusTab();
  }

  function close(view: ViewId) {
    closeView(view);
    // The closed tab may have had focus; keep it on the tab strip.
    focusTab();
  }

  function moveTo(view: ViewId, index: number) {
    moveView(view, index);
    const views = $openViews;
    announcement = `${VIEW_TITLES[view]} tab moved to position ${views.indexOf(view) + 1} of ${views.length}`;
    // Moving the tab's element can take focus off it.
    focusTab(view);
  }

  function moveBy(view: ViewId, offset: number) {
    const index = $openViews.indexOf(view) + offset;
    if (index >= firstMovable && index < $openViews.length) moveTo(view, index);
  }

  // Keyboard support follows the WAI-ARIA tabs pattern, with Delete closing a closable tab
  // and Control+Shift+PageUp/PageDown moving a tab, as in web browsers.
  function handleKeydown(event: KeyboardEvent, view: ViewId) {
    const views = $openViews;
    const index = views.indexOf(view);

    switch (event.key) {
      case 'ArrowRight':
        select(views[(index + 1) % views.length]);
        break;
      case 'ArrowLeft':
        select(views[(index - 1 + views.length) % views.length]);
        break;
      case 'Home':
        select(views[0]);
        break;
      case 'End':
        select(views[views.length - 1]);
        break;
      case 'Delete':
        if (!isClosable(view)) return;
        close(view);
        break;
      case 'PageUp':
      case 'PageDown':
        if (!event.ctrlKey || !event.shiftKey || !movableTab(view)) return;
        moveBy(view, event.key === 'PageUp' ? -1 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function keyShortcuts(view: ViewId) {
    if (!isClosable(view)) return undefined;
    return movableTab(view) ? 'Delete Control+Shift+PageUp Control+Shift+PageDown' : 'Delete';
  }

  function tabEdges(): TabEdges[] {
    return $openViews.map(view => {
      const rect = tabs[view]?.getBoundingClientRect();
      return { left: rect?.left ?? 0, right: rect?.right ?? 0 };
    });
  }

  function report() {
    if (!tracking || !strip) return;
    const rect = strip.getBoundingClientRect();
    reportTabStrip({
      strip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      tabs: tabEdges(),
      firstMovable,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      origin,
    });
  }

  /** Reports the tab strip once the tabs for `views` are on screen. */
  async function reportAfterRender(_views: ViewId[]) {
    await tick();
    report();
  }

  /** Any pointer event tells where the webview is on screen, which the backend cannot find out itself. */
  function trackOrigin(event: PointerEvent) {
    if (!movable) return;
    const next = { x: event.screenX - event.clientX, y: event.screenY - event.clientY };
    if (origin?.x === next.x && origin.y === next.y) return;
    origin = next;
    report();
  }

  function isOutsideWindow(event: PointerEvent) {
    return event.clientX < 0 || event.clientY < 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
  }

  function handlePointerDown(event: PointerEvent, view: ViewId) {
    trackOrigin(event);
    if (event.button !== 0 || !movableTab(view)) return;
    // The close control is not a handle for dragging.
    if ((event.target as Element).closest('[data-tab-close]')) return;
    drag = { view, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moving: false, gap: null, outside: false };
    // Keeps pointer events coming while the pointer is outside the window.
    tabs[view]?.setPointerCapture?.(event.pointerId);
  }

  /** Follows the pointer during a drag. Returns false when no drag is under way with this pointer. */
  function follow(event: PointerEvent): boolean {
    if (!drag || event.pointerId !== drag.pointerId) return false;
    if (!drag.moving) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return true;
      drag.moving = true;
      activeView.set(drag.view);
    }
    drag.outside = canDetachViews() && isOutsideWindow(event);
    drag.gap = drag.outside ? null : dropGap(event.clientX, tabEdges(), firstMovable);
    drag = drag;
    return true;
  }

  function handlePointerMove(event: PointerEvent) {
    trackOrigin(event);
    follow(event);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!follow(event) || !drag) return;
    const { view, moving, gap, outside } = drag;
    drag = null;
    if (!moving) return;

    dragEnded = true;
    // The click, if any, comes right after this event.
    setTimeout(() => (dragEnded = false));
    if (outside) {
      void detachView(view);
    } else if (gap !== null) {
      const from = $openViews.indexOf(view);
      if (gap !== from && gap !== from + 1) moveTo(view, gap > from ? gap - 1 : gap);
    }
  }

  function cancelDrag(event: PointerEvent | KeyboardEvent) {
    if (!drag) return;
    if ('pointerId' in event) {
      if (event.pointerId !== drag.pointerId) return;
    } else {
      if (event.key !== 'Escape') return;
      event.preventDefault();
    }
    drag = null;
  }

  function handleClick(view: ViewId) {
    if (dragEnded) return;
    activeView.set(view);
  }
</script>

<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={cancelDrag}
  on:lostpointercapture={cancelDrag}
  on:keydown={cancelDrag}
  on:resize={() => report()}
/>

<div
  role="tablist"
  aria-label="Views"
  class="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
  bind:this={strip}
  on:scroll={() => report()}
>
  {#each $openViews as view, index (view)}
    {@const selected = view === $activeView}
    {@const dragged = drag?.moving && drag.view === view}
    <button
      type="button"
      role="tab"
      id={viewTabId(view)}
      aria-controls={viewPanelId(view)}
      aria-selected={selected}
      aria-keyshortcuts={keyShortcuts(view)}
      tabindex={selected ? 0 : -1}
      title={isClosable(view) ? undefined : 'Pinned tab'}
      data-dragging={dragged ? (drag?.outside ? 'outside' : 'inside') : undefined}
      class="group relative flex shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 {selected ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-transparent border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900'} {dragged ? 'cursor-grabbing opacity-60' : ''} {dragged && drag?.outside ? 'border-dashed border-blue-500' : ''}"
      bind:this={tabs[view]}
      on:pointerdown={(event) => handlePointerDown(event, view)}
      on:click={() => handleClick(view)}
      on:keydown={(event) => handleKeydown(event, view)}
    >
      {#if indicator === index}
        <span aria-hidden="true" data-testid="drop-indicator" class="pointer-events-none absolute inset-y-1 -left-[3px] w-0.5 rounded bg-blue-600"></span>
      {/if}
      {#if !isClosable(view)}
        <svg aria-hidden="true" viewBox="0 0 16 16" class="h-3.5 w-3.5 fill-current text-blue-600" data-testid="pinned-icon">
          <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707c-.28-.28-.576-.316-.766-.29l-3.168 3.168c.09.513.068 1.093-.137 1.693-.246.722-.763 1.457-1.637 2.15a.5.5 0 0 1-.664-.039L5.95 11.06l-3.597 3.597a.5.5 0 1 1-.707-.707L5.243 10.35 3.142 8.25a.5.5 0 0 1-.038-.664c.692-.874 1.427-1.391 2.149-1.637.6-.205 1.18-.227 1.693-.137l3.168-3.168c.026-.19-.01-.486-.29-.766a.5.5 0 0 1 .354-.854z" />
        </svg>
      {/if}
      <span>{VIEW_TITLES[view]}</span>
      {#if isClosable(view)}
        <!-- Pointer shortcut only: keyboard and screen reader users close the tab with Delete (aria-keyshortcuts). -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <span
          aria-hidden="true"
          title="Close tab (Delete)"
          data-testid="close-{view}"
          data-tab-close
          class="electrobun-webkit-app-region-no-drag -mr-1 rounded px-1 leading-none text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          on:click|stopPropagation={() => close(view)}
        >
          ✕
        </span>
      {/if}
      {#if indicator === $openViews.length && index === $openViews.length - 1}
        <span aria-hidden="true" data-testid="drop-indicator" class="pointer-events-none absolute inset-y-1 -right-[3px] w-0.5 rounded bg-blue-600"></span>
      {/if}
    </button>
  {/each}
</div>
<p class="sr-only" role="status">{announcement}</p>
