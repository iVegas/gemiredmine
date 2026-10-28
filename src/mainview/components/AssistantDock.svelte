<script lang="ts">
  import { tick } from 'svelte';
  import AssistantChat from './AssistantChat.svelte';
  import { asking } from '../lib/assistant';
  import { closeDock, dockState, minimizeDock, openDock, toggleDock, unreadReplies } from '../lib/assistant-dock';
  import { openView } from '../lib/views';

  // The assistant, in the corner of whichever view the user is in: a round button that opens a chat panel floating over
  // the view, which can be rolled up into its title bar and keeps what was typed. The Assistant tab shows the same
  // conversation, so "Open in a tab" gives the whole screen to it without losing a word.

  let launcher: HTMLButtonElement;
  let panel: HTMLElement;

  $: open = $dockState === 'open';
  $: minimized = $dockState === 'minimized';
  $: badge = $unreadReplies > 0 ? `${$unreadReplies} new ${$unreadReplies === 1 ? 'answer' : 'answers'}` : '';

  async function show() {
    openDock();
    await tick();
    panel?.querySelector('textarea')?.focus();
  }

  async function hide() {
    closeDock();
    await tick();
    launcher?.focus();
  }

  function openInTab() {
    openView('assistant');
    closeDock();
  }

  // Escape rolls the panel up rather than closing it, so a question in the box is not lost by a stray key.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    minimizeDock();
  }

  const headerButton =
    'rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
</script>

{#if $dockState === 'closed'}
  <button
    type="button"
    bind:this={launcher}
    aria-label="Open the assistant{badge ? `, ${badge}` : ''}"
    class="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
    on:click={show}
  >
    <svg aria-hidden="true" viewBox="0 0 20 20" class="h-6 w-6 fill-current">
      <path d="M10 3c-4 0-7.2 2.4-7.2 5.5 0 1.8 1.1 3.4 2.8 4.4-.2 1-.7 2-1.5 2.9 1.8-.3 3.2-1 4.1-1.7.6.1 1.2.2 1.8.2 4 0 7.2-2.4 7.2-5.8S14 3 10 3z" />
    </svg>
    {#if $unreadReplies > 0}
      <span aria-hidden="true" class="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-xs font-semibold leading-5">
        {$unreadReplies}
      </span>
    {/if}
    {#if $asking}
      <!-- The assistant answers while the user works on; the ring says an answer is on its way. -->
      <span aria-hidden="true" class="absolute inset-0 animate-ping rounded-full border-2 border-blue-400"></span>
      <span class="sr-only">Thinking…</span>
    {/if}
  </button>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    bind:this={panel}
    role="dialog"
    aria-modal="false"
    aria-label="Assistant"
    class="fixed bottom-0 right-2 z-40 flex w-[calc(100vw-1rem)] flex-col rounded-t-xl border border-gray-200 bg-white shadow-2xl sm:right-4 sm:w-[22rem] {open
      ? 'h-[min(32rem,calc(100vh-7rem))]'
      : ''}"
    on:keydown={handleKeydown}
  >
    <header class="flex items-center gap-1 rounded-t-xl border-b border-gray-200 bg-gray-50 px-2 py-1.5">
      <button
        type="button"
        aria-expanded={open}
        class="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-sm font-semibold text-gray-900 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        on:click={toggleDock}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 shrink-0 fill-current text-blue-600">
          <path d="M10 3c-4 0-7.2 2.4-7.2 5.5 0 1.8 1.1 3.4 2.8 4.4-.2 1-.7 2-1.5 2.9 1.8-.3 3.2-1 4.1-1.7.6.1 1.2.2 1.8.2 4 0 7.2-2.4 7.2-5.8S14 3 10 3z" />
        </svg>
        <span class="truncate">Assistant</span>
        {#if $unreadReplies > 0}
          <span class="shrink-0 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{$unreadReplies}</span>
        {/if}
        {#if $asking && minimized}
          <span class="shrink-0 text-xs font-normal text-gray-500">Thinking…</span>
        {/if}
      </button>

      <button type="button" aria-label="Open the assistant in a tab" title="Open in a tab" class={headerButton} on:click={openInTab}>
        <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current">
          <path d="M11 3h6v6h-2V6.4l-5.3 5.3-1.4-1.4L13.6 5H11V3zM4 5h4v2H5v8h8v-3h2v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={open ? 'Minimize the assistant' : 'Expand the assistant'}
        title={open ? 'Minimize' : 'Expand'}
        class={headerButton}
        on:click={toggleDock}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current">
          {#if open}
            <path d="M4 11h12v2H4z" />
          {:else}
            <path d="M10 6l5 5-1.4 1.4L10 8.8l-3.6 3.6L5 11z" />
          {/if}
        </svg>
      </button>
      <button type="button" aria-label="Close the assistant" title="Close" class={headerButton} on:click={hide}>
        <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current">
          <path d="M5.3 3.9 10 8.6l4.7-4.7 1.4 1.4L11.4 10l4.7 4.7-1.4 1.4L10 11.4l-4.7 4.7-1.4-1.4L8.6 10 3.9 5.3z" />
        </svg>
      </button>
    </header>

    <!-- Rolled up, the chat stays as it is: the question in the box is still there when the panel comes back. -->
    <div class="flex min-h-0 flex-1 flex-col p-3 {minimized ? 'hidden' : ''}">
      <AssistantChat compact idPrefix="assistant-dock" />
    </div>
  </section>
{/if}
