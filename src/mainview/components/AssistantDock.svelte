<script lang="ts">
  import { tick } from 'svelte';
  import AssistantPanel from './AssistantPanel.svelte';
  import { chats, chatOf } from '../lib/chats';
  import { openAssistant, panels, startChatPanel, unreadOutside, closePanel } from '../lib/assistant-dock';
  import { openView } from '../lib/views';

  // The assistant in the corner of whichever view the user is in: a round button, and the chat windows that are open.
  // Several chats can be open at once, each in a window of its own, and each can be dragged and resized.

  let launcher: HTMLButtonElement;
  let windows: Record<string, AssistantPanel> = {};

  $: open = $panels.map((panel) => ({ panel, chat: chatOf($chats, panel.chatId) }));
  $: badge = $unreadOutside > 0 ? `, ${$unreadOutside} new ${$unreadOutside === 1 ? 'answer' : 'answers'}` : '';

  /** A window that has just been made is not on the page yet, so the question box is reached after a render. */
  async function focusChat(chatId: string) {
    await tick();
    await windows[chatId]?.focusMessage();
  }

  async function show() {
    await focusChat(openAssistant());
  }

  async function startAnother() {
    await focusChat(startChatPanel());
  }

  function openInTab(chatId: string) {
    openView('assistant');
    closePanel(chatId);
  }
</script>

{#each open as { panel, chat } (panel.chatId)}
  {#if chat}
    <AssistantPanel bind:this={windows[chat.id]} {chat} {panel} on:tab={(event) => openInTab(event.detail.chatId)} />
  {/if}
{/each}

<div class="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
  {#if $panels.length > 0}
    <button
      type="button"
      aria-label="Start another chat with the assistant"
      class="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-md transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      on:click={startAnother}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" class="h-5 w-5 fill-current"><path d="M9 4h2v5h5v2h-5v5H9v-5H4V9h5z" /></svg>
    </button>
  {/if}

  <button
    type="button"
    bind:this={launcher}
    aria-label="Open the assistant{badge}"
    aria-keyshortcuts="Control+Shift+A"
    class="relative flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
    on:click={show}
  >
    <svg aria-hidden="true" viewBox="0 0 20 20" class="h-6 w-6 fill-current">
      <path d="M10 3c-4 0-7.2 2.4-7.2 5.5 0 1.8 1.1 3.4 2.8 4.4-.2 1-.7 2-1.5 2.9 1.8-.3 3.2-1 4.1-1.7.6.1 1.2.2 1.8.2 4 0 7.2-2.4 7.2-5.8S14 3 10 3z" />
    </svg>
    {#if $unreadOutside > 0}
      <span aria-hidden="true" class="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-xs font-semibold leading-5">
        {$unreadOutside}
      </span>
    {/if}
    {#if $chats.some((chat) => chat.asking)}
      <!-- The assistant answers while the user works on; the ring says an answer is on its way. -->
      <span aria-hidden="true" class="absolute inset-0 animate-ping rounded-full border-2 border-blue-400"></span>
      <span class="sr-only">Thinking…</span>
    {/if}
  </button>
</div>
