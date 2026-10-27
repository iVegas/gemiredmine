<script lang="ts">
  import { onMount } from 'svelte';
  import { redmineApi } from '../lib/api';
  import {
    ASSISTANT_PROVIDERS,
    ASSISTANT_PROVIDER_INFO,
    DEFAULT_SPEECH_VOICE,
    assistantSettingsFrom,
    assistantSettingsProblem,
    type AssistantKeySlot,
    type AssistantProvider,
    type AssistantSettings,
  } from '../../shared/assistant';

  let loaded = false;
  let provider: AssistantProvider = 'openai-compatible';
  let baseUrl = ASSISTANT_PROVIDER_INFO['openai-compatible'].baseUrl;
  let model = '';
  let voiceOn = false;
  let voiceUrl = '';
  let transcription = '';
  let speech = '';
  let speechVoice = DEFAULT_SPEECH_VOICE;
  // The keys are typed here and never shown again: the form only says whether one is kept.
  let chatKey = '';
  let voiceKey = '';
  let chatKeySaved = false;
  let voiceKeySaved = false;
  let status = '';
  let error = '';
  let saving = false;

  const failure = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

  function show(settings: AssistantSettings) {
    provider = settings.provider;
    baseUrl = settings.baseUrl;
    model = settings.model;
    voiceOn = settings.voice !== null;
    voiceUrl = settings.voice?.baseUrl ?? '';
    transcription = settings.voice?.transcription ?? '';
    speech = settings.voice?.speech ?? '';
    speechVoice = settings.voice?.speechVoice ?? DEFAULT_SPEECH_VOICE;
  }

  onMount(async () => {
    try {
      show(assistantSettingsFrom(await redmineApi.getAssistantSettings()));
      chatKeySaved = (await redmineApi.loadAssistantKey('chat')) !== null;
      voiceKeySaved = (await redmineApi.loadAssistantKey('voice')) !== null;
    } catch (reason) {
      error = failure(reason);
    } finally {
      loaded = true;
    }
  });

  /** Changing the service puts its usual address in the box, unless the user has typed another one. */
  function changeProvider() {
    const known = Object.values(ASSISTANT_PROVIDER_INFO).map((info) => info.baseUrl);
    if (known.includes(baseUrl)) baseUrl = ASSISTANT_PROVIDER_INFO[provider].baseUrl;
  }

  async function save() {
    error = '';
    status = '';
    const settings: AssistantSettings = {
      provider,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      voice: voiceOn
        ? {
            baseUrl: voiceUrl.trim(),
            transcription: transcription.trim(),
            speech: speech.trim() || null,
            speechVoice: speechVoice.trim() || DEFAULT_SPEECH_VOICE,
          }
        : null,
    };
    const problem = assistantSettingsProblem(settings);
    if (problem) {
      error = problem;
      return;
    }

    saving = true;
    try {
      await redmineApi.saveAssistantSettings(settings);
      await saveKey('chat', chatKey);
      await saveKey('voice', voiceKey);
      status = 'Saved.';
    } catch (reason) {
      error = failure(reason);
    } finally {
      saving = false;
    }
  }

  async function saveKey(slot: AssistantKeySlot, key: string) {
    if (!key.trim()) return;
    await redmineApi.saveAssistantKey(slot, key);
    if (slot === 'chat') {
      chatKeySaved = true;
      chatKey = '';
    } else {
      voiceKeySaved = true;
      voiceKey = '';
    }
  }

  async function forgetKey(slot: AssistantKeySlot) {
    error = '';
    try {
      await redmineApi.deleteAssistantKey(slot);
      if (slot === 'chat') chatKeySaved = false;
      else voiceKeySaved = false;
      status = 'The key was removed.';
    } catch (reason) {
      error = failure(reason);
    }
  }

  const field = 'mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'text-sm font-medium text-gray-700';
  const button = 'rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
</script>

<div class="space-y-4">
  <p class="text-sm text-gray-600">
    The assistant answers from your tasks and time, and calls the same tools as the MCP endpoint. Its keys are kept in the system's
    credential store, not in the app's files. A local server needs no key.
  </p>

  {#if loaded}
    <form class="space-y-4" on:submit|preventDefault={save}>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label for="assistant-provider" class={label}>Service</label>
          <select id="assistant-provider" bind:value={provider} on:change={changeProvider} class={field}>
            {#each ASSISTANT_PROVIDERS as option (option)}
              <option value={option}>{ASSISTANT_PROVIDER_INFO[option].label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="assistant-model" class={label}>Model</label>
          <input id="assistant-model" type="text" bind:value={model} autocomplete="off" placeholder="The model's name" class={field} />
        </div>
        <div>
          <label for="assistant-base-url" class={label}>Address</label>
          <input id="assistant-base-url" type="url" bind:value={baseUrl} autocomplete="off" class={field} />
        </div>
        <div>
          <label for="assistant-key" class={label}>API key {chatKeySaved ? '(kept)' : ''}</label>
          <div class="flex gap-2">
            <input
              id="assistant-key"
              type="password"
              bind:value={chatKey}
              autocomplete="off"
              placeholder={chatKeySaved ? 'Type a new key to replace it' : 'Leave empty for a local server'}
              class={field}
            />
            {#if chatKeySaved}
              <button type="button" class="mt-1 {button}" on:click={() => forgetKey('chat')}>Remove</button>
            {/if}
          </div>
        </div>
      </div>

      <fieldset class="space-y-3 rounded border border-gray-200 p-3">
        <legend class="px-1 text-sm font-semibold text-gray-900">Voice model (optional)</legend>
        <label class="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" bind:checked={voiceOn} />
          Attach a voice model, to speak to the assistant and to hear its replies
        </label>
        {#if voiceOn}
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label for="assistant-voice-url" class={label}>Address</label>
              <input id="assistant-voice-url" type="url" bind:value={voiceUrl} autocomplete="off" placeholder="http://127.0.0.1:8000/v1" class={field} />
            </div>
            <div>
              <label for="assistant-transcription" class={label}>Speech-to-text model</label>
              <input id="assistant-transcription" type="text" bind:value={transcription} autocomplete="off" placeholder="whisper-1" class={field} />
            </div>
            <div>
              <label for="assistant-speech" class={label}>Text-to-speech model (optional)</label>
              <input id="assistant-speech" type="text" bind:value={speech} autocomplete="off" placeholder="Leave empty to keep replies on screen" class={field} />
            </div>
            <div>
              <label for="assistant-speech-voice" class={label}>Voice of the replies</label>
              <input id="assistant-speech-voice" type="text" bind:value={speechVoice} autocomplete="off" class={field} />
            </div>
            <div>
              <label for="assistant-voice-key" class={label}>Voice API key {voiceKeySaved ? '(kept)' : ''}</label>
              <div class="flex gap-2">
                <input id="assistant-voice-key" type="password" bind:value={voiceKey} autocomplete="off" class={field} />
                {#if voiceKeySaved}
                  <button type="button" class="mt-1 {button}" on:click={() => forgetKey('voice')}>Remove</button>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </fieldset>

      {#if error}
        <p role="alert" class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>
      {/if}
      {#if status}
        <p role="status" class="text-sm text-green-700">{status}</p>
      {/if}

      <button type="submit" disabled={saving} class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">
        Save the assistant
      </button>
    </form>
  {:else if error}
    <p role="alert" class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>
  {/if}
</div>
