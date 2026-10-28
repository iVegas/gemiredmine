<script lang="ts">
  // The Assistant in a tab of its own: every chat the user has, and the one they chose at full width. The same chats
  // are in the floating windows (components/AssistantDock.svelte), so moving between the two keeps what was said.
  import { onMount } from 'svelte';
  import AssistantChat from './components/AssistantChat.svelte';
  import { chatOf, chats, markRead, newestChat, removeChat, startChat } from './lib/chats';
  import { showChat } from './lib/assistant-dock';

  let chosen: string | null = null;

  onMount(() => {
    if ($chats.length === 0) chosen = startChat();
  });

  $: selected = (chosen ? chatOf($chats, chosen) : undefined) ?? newestChat($chats);
  // The chat in front of the user is read; what arrives in it while it is shown is read too.
  $: if (selected && selected.unread > 0) markRead(selected.id);

  function select(chatId: string) {
    chosen = chatId;
  }

  function startAnother() {
    chosen = startChat();
  }

  function forget(chatId: string) {
    removeChat(chatId);
    if (chosen === chatId) chosen = null;
  }

  const button = 'rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-2xl font-bold text-gray-900">Assistant</h2>
    <button type="button" class={button} on:click={startAnother}>New chat</button>
  </div>

  <div class="flex min-h-0 flex-col gap-4 sm:flex-row">
    <nav aria-label="Chats" class="sm:w-56 sm:shrink-0">
      <ul class="flex flex-col gap-1">
        {#each $chats as chat (chat.id)}
          {@const current = selected?.id === chat.id}
          <li class="flex items-center gap-1">
            <button
              type="button"
              aria-current={current ? 'true' : undefined}
              class="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 {current
                ? 'bg-blue-50 font-medium text-blue-800'
                : 'text-gray-700 hover:bg-gray-100'}"
              on:click={() => select(chat.id)}
            >
              <span class="truncate">{chat.title}</span>
              {#if chat.unread > 0}
                <span class="ml-auto shrink-0 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                  <span aria-hidden="true">{chat.unread}</span>
                  <span class="sr-only">{chat.unread} new {chat.unread === 1 ? 'answer' : 'answers'}</span>
                </span>
              {/if}
            </button>
            <button
              type="button"
              aria-label="Forget {chat.title}"
              title="Forget this chat"
              class="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              on:click={() => forget(chat.id)}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" class="h-3.5 w-3.5 fill-current">
                <path d="M5.3 3.9 10 8.6l4.7-4.7 1.4 1.4L11.4 10l4.7 4.7-1.4 1.4L10 11.4l-4.7 4.7-1.4-1.4L8.6 10 3.9 5.3z" />
              </svg>
            </button>
          </li>
        {/each}
      </ul>
      {#if selected}
        <button type="button" class="{button} mt-2 w-full" on:click={() => showChat(selected.id)}>
          Keep it floating
        </button>
      {/if}
    </nav>

    <div class="min-w-0 flex-1">
      {#if selected}
        {#key selected.id}
          <AssistantChat chat={selected} idPrefix="assistant" />
        {/key}
      {:else}
        <p class="text-sm text-gray-500">No chats yet. Start one to ask about your tasks or your time.</p>
      {/if}
    </div>
  </div>
</div>
