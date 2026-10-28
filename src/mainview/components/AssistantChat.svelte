<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { redmineApi } from '../lib/api';
  import { askAssistant, assistantError, asking, conversation, readAloud, transcribeSpeech } from '../lib/assistant';
  import { RecordingUnsupportedError, startRecording } from '../lib/recorder';
  import { openView } from '../lib/views';
  import { assistantSettingsProblem, isOnDeviceProvider, type AssistantSettings } from '../../shared/assistant';

  // The chat itself, in the Assistant tab and in the floating panel. Both show the same conversation, because it is
  // kept in assistant.ts: what is asked in the panel is there in the tab, and the other way round.

  /** The panel is small: the conversation scrolls, and the controls take as little room as they can. */
  export let compact = false;
  /** Keeps the element ids apart where two chats could be on the page at once. */
  export let idPrefix = 'assistant';

  let settings: AssistantSettings | null = null;
  let draft = '';
  let readReplies = false;
  let stopRecording: (() => Promise<Blob>) | null = null;
  let recording = false;
  let transcribing = false;
  /** False once this window has shown that it has no recorder, so the Speak button is not offered again. */
  let canRecordHere = true;
  let list: HTMLOListElement;

  onMount(() => {
    redmineApi
      .getAssistantSettings()
      .then((loaded) => (settings = loaded))
      .catch((error: unknown) => assistantError.set(error instanceof Error ? error.message : String(error)));
  });

  // Stops a recording that is still running when the chat goes away, so the microphone is released.
  onDestroy(() => {
    if (stopRecording) void stopRecording().catch(() => undefined);
  });

  $: problem = settings ? assistantSettingsProblem(settings) : null;
  $: ready = settings !== null && problem === null;
  $: canListen = ready && settings?.voice != null && canRecordHere;
  $: canSpeak = ready && settings?.voice?.speech != null;
  $: shown = $conversation.filter((message) => message.role !== 'tool');
  // The model on the device answers without the app's tools, so it never reads Redmine. The chat says so once.
  $: onDevice = settings !== null && isOnDeviceProvider(settings.provider);
  // In the panel the newest message is the one to see, so the conversation follows it.
  $: if (compact) void keepAtNewest(shown.length, $asking);

  const sentence = (error: unknown) => (error instanceof Error ? error.message : String(error));

  async function keepAtNewest(_messages: number, _thinking: boolean) {
    await tick();
    if (list) list.scrollTop = list.scrollHeight;
  }

  async function send() {
    const answered = await askAssistant(draft);
    if (!answered) return;
    draft = '';
    const last = $conversation[$conversation.length - 1];
    if (readReplies && canSpeak && last?.role === 'assistant' && last.content) {
      readAloud(last.content).catch((error: unknown) => assistantError.set(sentence(error)));
    }
  }

  function onKeydown(event: KeyboardEvent) {
    // Enter sends the message; Shift+Enter starts a new line.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  /** Starts a recording, or stops it and puts what was said into the message, where the user can change it before sending. */
  async function toggleVoice() {
    if (stopRecording) {
      const stop = stopRecording;
      stopRecording = null;
      recording = false;
      transcribing = true;
      try {
        const words = await transcribeSpeech(await stop());
        draft = draft.trim() ? `${draft.trim()} ${words}` : words;
      } catch (error) {
        assistantError.set(sentence(error));
      } finally {
        transcribing = false;
      }
      return;
    }
    try {
      stopRecording = await startRecording();
      recording = true;
    } catch (error) {
      // A window without a recorder will not get one: the button goes, and the replies can still be read aloud.
      if (error instanceof RecordingUnsupportedError) canRecordHere = false;
      assistantError.set(sentence(error));
    }
  }

  const button = 'rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50';
  const primary = 'rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50';
  const notice = 'flex flex-wrap items-center gap-2 rounded border p-3 text-sm';
</script>

<div class="flex min-h-0 flex-1 flex-col {compact ? 'gap-2' : 'gap-4'}">
  {#if settings && problem}
    <p class="{notice} border-amber-200 bg-amber-50 text-amber-900">
      <span>The assistant is not set up yet. {problem}</span>
      <button type="button" class={button} on:click={() => openView('settings')}>Open Settings</button>
    </p>
  {/if}

  {#if onDevice}
    <p class="{notice} border-gray-200 bg-gray-50 text-gray-700">
      <span>The model on this device answers without reading your tasks or your time. Choose a model service in Settings for answers from Redmine.</span>
      <button type="button" class={button} on:click={() => openView('settings')}>Open Settings</button>
    </p>
  {/if}

  {#if $assistantError}
    <p role="alert" class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{$assistantError}</p>
  {/if}

  <ol
    bind:this={list}
    aria-label="Conversation"
    class="flex flex-col gap-3 {compact ? 'min-h-0 flex-1 overflow-y-auto pr-1' : ''}"
  >
    {#each shown as message, index (index)}
      {#if message.role === 'user'}
        <li class="ml-auto max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
          <span class="sr-only">You: </span>{message.content}
        </li>
      {:else if message.role === 'assistant' && (message.content || message.toolCalls.length > 0)}
        <li class="max-w-[85%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900">
          <span class="sr-only">Assistant: </span>{message.content}
          {#if message.toolCalls.length > 0}
            <p class="mt-1 text-xs text-gray-500">Checked: {message.toolCalls.map((call) => call.name).join(', ')}</p>
          {/if}
        </li>
      {/if}
    {:else}
      <li class="text-sm text-gray-500">Ask about your tasks, your time, or a change you want to make.</li>
    {/each}
  </ol>

  {#if $asking}
    <p role="status" class="text-sm text-gray-500">Thinking…</p>
  {/if}

  <form class="flex flex-col gap-2" on:submit|preventDefault={send}>
    <label for="{idPrefix}-message" class="text-sm font-medium text-gray-700 {compact ? 'sr-only' : ''}">Message</label>
    <textarea
      id="{idPrefix}-message"
      rows={compact ? 2 : 3}
      bind:value={draft}
      disabled={!ready || $asking}
      on:keydown={onKeydown}
      placeholder="Ask about your tasks or your time"
      class="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
    ></textarea>
    <div class="flex flex-wrap items-center gap-2">
      <button type="submit" class={primary} disabled={!ready || $asking || !draft.trim()}>Send</button>
      {#if canListen}
        <button type="button" class={button} aria-pressed={recording} on:click={toggleVoice} disabled={transcribing || $asking}>
          {recording ? 'Stop and transcribe' : transcribing ? 'Transcribing…' : 'Speak'}
        </button>
      {/if}
      {#if canSpeak}
        <label class="flex items-center gap-1 text-sm text-gray-700">
          <input type="checkbox" bind:checked={readReplies} />
          Read replies aloud
        </label>
      {/if}
      <button type="button" class="{button} ml-auto" on:click={() => conversation.set([])} disabled={$conversation.length === 0 || $asking}>
        Clear
      </button>
    </div>
    <p class="text-xs text-gray-500">A change the assistant proposes is not saved. Approve it in the notice at the top of the window.</p>
  </form>
</div>
