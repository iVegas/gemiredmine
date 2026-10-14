<script lang="ts">
  import { tick } from 'svelte';
  import {
    VIEW_TITLES,
    activeView,
    closeView,
    isClosable,
    openViews,
    viewPanelId,
    viewTabId,
    type ViewId,
  } from './lib/views';

  const tabs: Partial<Record<ViewId, HTMLButtonElement>> = {};

  async function focusActiveTab() {
    await tick();
    const view = $activeView;
    tabs[view]?.focus();
  }

  function select(view: ViewId) {
    activeView.set(view);
    focusActiveTab();
  }

  function close(view: ViewId) {
    closeView(view);
    // The closed tab may have had focus; keep it on the tab strip.
    focusActiveTab();
  }

  // Keyboard support follows the WAI-ARIA tabs pattern, with Delete closing a closable tab.
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
      default:
        return;
    }
    event.preventDefault();
  }
</script>

<div role="tablist" aria-label="Views" class="flex min-w-0 items-end gap-1 overflow-x-auto">
  {#each $openViews as view (view)}
    {@const selected = view === $activeView}
    <button
      type="button"
      role="tab"
      id={viewTabId(view)}
      aria-controls={viewPanelId(view)}
      aria-selected={selected}
      aria-keyshortcuts={isClosable(view) ? 'Delete' : undefined}
      tabindex={selected ? 0 : -1}
      title={isClosable(view) ? undefined : 'Pinned tab'}
      class="group flex shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 {selected ? 'bg-gray-50 border-gray-200 text-gray-900' : 'bg-transparent border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900'}"
      bind:this={tabs[view]}
      on:click={() => activeView.set(view)}
      on:keydown={(event) => handleKeydown(event, view)}
    >
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
          class="-mr-1 rounded px-1 leading-none text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          on:click|stopPropagation={() => close(view)}
        >
          ✕
        </span>
      {/if}
    </button>
  {/each}
</div>
