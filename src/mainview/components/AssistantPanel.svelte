<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import AssistantChat from './AssistantChat.svelte';
  import {
    closePanel,
    minimizePanel,
    movePanel,
    resizePanel,
    togglePanel,
    PANEL_MIN_HEIGHT,
    PANEL_MIN_WIDTH,
    type Panel,
  } from '../lib/assistant-dock';
  import type { Chat } from '../lib/chats';

  // One chat window, floating over the view. It is anchored by its bottom right corner, so dragging its title bar moves
  // that corner and the grip in the top left corner makes the window bigger towards the top and the left.

  export let chat: Chat;
  export let panel: Panel;

  const dispatch = createEventDispatcher<{ tab: { chatId: string } }>();

  /** How far the pointer moves, in pixels, with the button held, before a press on the title bar becomes a drag. */
  const DRAG_THRESHOLD = 4;

  let root: HTMLElement;
  /** What is being dragged with the pointer, where it started, and whether it has moved far enough to count. */
  let drag: { kind: 'move' | 'resize'; pointerId: number; x: number; y: number; from: Panel; moving: boolean } | null = null;
  /** Set when a drag ends, so the click it causes does not roll the window up as well. */
  let dragEnded = false;

  $: open = !panel.minimized;
  $: style = `right:${panel.right}px;bottom:${panel.bottom}px;width:${panel.width}px;${open ? `height:${panel.height}px;` : ''}`;

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  export async function focusMessage() {
    await tick();
    root?.querySelector('textarea')?.focus();
  }

  function startDrag(event: PointerEvent, kind: 'move' | 'resize') {
    if (event.button !== 0) return;
    // The controls at the end of the title bar are not handles for dragging; the name of the chat is.
    if (kind === 'move' && (event.target as Element).closest('[data-panel-button]')) return;
    drag = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: { ...panel }, moving: kind === 'resize' };
    // The rest of the drag is followed on the window, so it keeps up with a pointer that leaves the title bar.
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    // A press that hardly moves is a click on the title bar, which rolls the window up instead.
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moving = true;
    }
    if (drag.kind === 'move') {
      // The window is anchored by its right and bottom edges, so the pointer moves them the other way.
      movePanel(chat.id, { right: drag.from.right - dx, bottom: drag.from.bottom - dy }, viewport());
    } else {
      resizePanel(chat.id, { width: drag.from.width - dx, height: drag.from.height - dy }, viewport());
    }
  }

  function endDrag(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moving && drag.kind === 'move';
    drag = null;
    if (!moved) return;
    dragEnded = true;
    // The click, if any, comes right after this event.
    setTimeout(() => (dragEnded = false));
  }

  function toggle() {
    if (dragEnded) return;
    togglePanel(chat.id);
  }

  // Escape rolls the window up rather than closing it, so a question in the box is not lost by a stray key.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    minimizePanel(chat.id);
  }

  const headerButton =
    'rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
</script>

<svelte:window on:pointermove={moveDrag} on:pointerup={endDrag} on:pointercancel={endDrag} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  bind:this={root}
  role="dialog"
  aria-modal="false"
  aria-label="Assistant: {chat.title}"
  class="fixed z-40 flex max-w-[calc(100vw-1rem)] flex-col rounded-t-xl border border-gray-200 bg-white shadow-2xl"
  style="{style}min-width:{PANEL_MIN_WIDTH}px;{open ? `min-height:${PANEL_MIN_HEIGHT}px;` : ''}"
  on:keydown={handleKeydown}
>
  {#if open}
    <!-- The grip makes the window bigger towards the top and the left, where there is room. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      role="separator"
      aria-label="Resize the chat with {chat.title}"
      title="Drag to resize"
      class="absolute -left-1 -top-1 h-4 w-4 cursor-nwse-resize rounded-tl border-l-2 border-t-2 border-gray-300 bg-white"
      data-testid="resize-{chat.id}"
      on:pointerdown={(event) => startDrag(event, 'resize')}
    ></span>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header
    class="flex items-center gap-1 rounded-t-xl border-b border-gray-200 bg-gray-50 px-2 py-1.5 {drag?.kind === 'move' ? 'cursor-grabbing' : 'cursor-grab'}"
    data-testid="title-{chat.id}"
    on:pointerdown={(event) => startDrag(event, 'move')}
  >
    <button
      type="button"
      aria-expanded={open}
      class="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-sm font-semibold text-gray-900 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      on:click={toggle}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 shrink-0 fill-current text-blue-600">
        <path d="M10 3c-4 0-7.2 2.4-7.2 5.5 0 1.8 1.1 3.4 2.8 4.4-.2 1-.7 2-1.5 2.9 1.8-.3 3.2-1 4.1-1.7.6.1 1.2.2 1.8.2 4 0 7.2-2.4 7.2-5.8S14 3 10 3z" />
      </svg>
      <span class="truncate">{chat.title}</span>
      {#if chat.unread > 0}
        <span class="shrink-0 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
          <span aria-hidden="true">{chat.unread}</span>
          <span class="sr-only">{chat.unread} new {chat.unread === 1 ? 'answer' : 'answers'}</span>
        </span>
      {/if}
      {#if chat.asking && !open}
        <span class="shrink-0 text-xs font-normal text-gray-500">Thinking…</span>
      {/if}
    </button>

    <button
      type="button"
      data-panel-button
      aria-label="Open {chat.title} in a tab"
      class={headerButton}
      on:click={() => dispatch('tab', { chatId: chat.id })}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current">
        <path d="M11 3h6v6h-2V6.4l-5.3 5.3-1.4-1.4L13.6 5H11V3zM4 5h4v2H5v8h8v-3h2v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      </svg>
    </button>
    <button
      type="button"
      data-panel-button
      aria-label={open ? `Minimize ${chat.title}` : `Expand ${chat.title}`}
      title={open ? 'Minimize' : 'Expand'}
      class={headerButton}
      on:click={() => togglePanel(chat.id)}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current">
        {#if open}
          <path d="M4 11h12v2H4z" />
        {:else}
          <path d="M10 6l5 5-1.4 1.4L10 8.8l-3.6 3.6L5 11z" />
        {/if}
      </svg>
    </button>
    <button
      type="button"
      data-panel-button
      aria-label="Close {chat.title}"
      class={headerButton}
      on:click={() => closePanel(chat.id)}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current">
        <path d="M5.3 3.9 10 8.6l4.7-4.7 1.4 1.4L11.4 10l4.7 4.7-1.4 1.4L10 11.4l-4.7 4.7-1.4-1.4L8.6 10 3.9 5.3z" />
      </svg>
    </button>
  </header>

  <!-- Rolled up, the chat stays as it is: the question in the box is still there when the window comes back. -->
  <div class="flex min-h-0 flex-1 flex-col p-3 {open ? '' : 'hidden'}">
    <AssistantChat {chat} compact idPrefix="assistant-{chat.id}" />
  </div>
</section>

