<script lang="ts">
  import { onMount } from 'svelte';
  import { redmineApi } from '../lib/api';
  import { onDeviceState, onDeviceStateText, type OnDeviceState } from '../lib/on-device-ai';
  import type { LocalModelServer } from '../../bun/assistant/discovery';
  import {
    ASSISTANT_PROVIDERS,
    ASSISTANT_PROVIDER_INFO,
    DEFAULT_SPEECH_VOICE,
    ON_DEVICE_PROVIDER,
    assistantSettingsFrom,
    assistantSettingsProblem,
    assistantSetupFrom,
    assistantSetupLink,
    type AssistantKeySlot,
    type AssistantProvider,
    type AssistantSettings,
    type SystemAiSetup,
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

  // What this computer offers, so that nobody has to find out an address or a key by hand.
  let scanning = false;
  let scanned = false;
  let localServers: LocalModelServer[] = [];
  let systemSetup: SystemAiSetup[] = [];
  let device: OnDeviceState = 'missing';
  let scanProblem = '';

  let setupText = '';

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

  function current(): AssistantSettings {
    return {
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
    await scan();
  });

  /**
   * Looks for a model that needs no setting up: the one this device carries, a local server that is running, and the
   * services this computer already has a key for. Finding none is the usual case, so it is not reported as a failure.
   */
  async function scan() {
    scanning = true;
    scanProblem = '';
    try {
      device = await onDeviceState();
      const [servers, setup] = await Promise.all([redmineApi.findLocalModelServers(), redmineApi.findSystemAiSetup()]);
      localServers = servers;
      systemSetup = setup;
    } catch (reason) {
      scanProblem = `This computer could not be searched for a model: ${failure(reason)}`;
    } finally {
      scanning = false;
      scanned = true;
    }
  }

  /** Changing the service puts its usual address in the box, unless the user has typed another one. */
  function changeProvider() {
    const known = Object.values(ASSISTANT_PROVIDER_INFO).map((info) => info.baseUrl);
    if (known.includes(baseUrl)) baseUrl = ASSISTANT_PROVIDER_INFO[provider].baseUrl;
  }

  /** Puts a local server in the form. The service becomes the OpenAI-compatible one, which every local server speaks. */
  function useServer(server: LocalModelServer) {
    provider = 'openai-compatible';
    baseUrl = server.baseUrl;
    if (server.models.length > 0 && !server.models.includes(model)) model = server.models[0];
    chatKey = '';
    status = `${server.label} is in the form. Save the assistant to use it.`;
    error = '';
  }

  /** Puts a key or an address that this computer already holds in the form, ready to be saved. */
  function useSetup(found: SystemAiSetup) {
    error = '';
    if (found.kind === 'address') {
      useServer({ label: 'The address this computer is set up for', baseUrl: found.value, models: [] });
      return;
    }
    provider = found.provider;
    changeProvider();
    chatKey = found.value;
    status = `The key from ${found.source} is in the form. Save the assistant to keep it in the credential store.`;
  }

  /** Puts the model of this device in the form: it needs no address, no key and no model name. */
  function useDevice() {
    provider = ON_DEVICE_PROVIDER;
    baseUrl = '';
    model = '';
    chatKey = '';
    error = '';
    status = 'The model on this device is in the form. Save the assistant to use it.';
  }

  async function copySetupLink() {
    error = '';
    try {
      await navigator.clipboard?.writeText(assistantSetupLink(current()));
      status = 'The setup link is on the clipboard. It carries no API key.';
    } catch (reason) {
      error = `The link could not be copied: ${failure(reason)}`;
    }
  }

  /** Fills the form from a pasted setup link or from settings in JSON. Nothing is saved until the user saves. */
  function applySetupText() {
    error = '';
    status = '';
    try {
      const setup = assistantSetupFrom(setupText);
      show(setup.settings);
      if (setup.key) chatKey = setup.key;
      setupText = '';
      status = `The setup is in the form${setup.key ? ', with the key it carried' : ''}. Save the assistant to keep it.`;
    } catch (reason) {
      error = failure(reason);
    }
  }

  async function save() {
    error = '';
    status = '';
    const settings = current();
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

  async function openKeyPage() {
    error = '';
    try {
      await redmineApi.openAssistantKeyPage(provider);
    } catch (reason) {
      error = `The page could not be opened: ${failure(reason)}`;
    }
  }

  /** The models of the server at this address, and the ones the service is known for, as suggestions under the box. */
  function suggestedModels(info: (typeof ASSISTANT_PROVIDER_INFO)[AssistantProvider], address: string, servers: LocalModelServer[]) {
    const here = servers.find((server) => server.baseUrl.replace(/\/+$/, '') === address.trim().replace(/\/+$/, ''));
    return [...new Set([...(here?.models ?? []), ...info.models])];
  }

  function modelsOf(server: LocalModelServer): string {
    if (server.models.length === 0) return 'no model loaded yet';
    const [first, second, ...rest] = server.models;
    const named = [first, second].filter((name) => name !== undefined).join(', ');
    return rest.length > 0 ? `${named} and ${rest.length} more` : named;
  }

  $: info = ASSISTANT_PROVIDER_INFO[provider];
  $: onDevice = info.onDevice;
  $: models = suggestedModels(info, baseUrl, localServers);
  $: deviceOffer = onDeviceStateText(device);
  // What is worth offering for the service that is chosen: the service's own key, found here, is the first thing.
  $: keysForProvider = systemSetup.filter((found) => found.kind === 'key' && found.provider === provider);
  $: nothingFound = scanned && !scanProblem && !deviceOffer && localServers.length === 0 && systemSetup.length === 0;

  const field = 'mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'text-sm font-medium text-gray-700';
  const button = 'rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  const offer = 'shrink-0 rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
</script>

<div class="space-y-4">
  <p class="text-sm text-gray-600">
    The assistant answers from your tasks and time, and calls the same tools as the MCP endpoint. Its keys are kept in the system's
    credential store, not in the app's files. A local server needs no key.
  </p>

  <section aria-labelledby="assistant-found-heading" class="rounded border border-gray-200 bg-gray-50 p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 id="assistant-found-heading" class="text-sm font-semibold text-gray-900">What this computer offers</h4>
      <button type="button" class={button} disabled={scanning} on:click={scan}>
        {scanning ? 'Searching…' : 'Search again'}
      </button>
    </div>

    {#if scanning}
      <p role="status" class="mt-2 text-sm text-gray-600">Asking this device and the usual local addresses…</p>
    {:else}
      <ul class="mt-2 space-y-2">
        {#if deviceOffer}
          <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="min-w-0">
              <span class="font-medium text-gray-900">The model on this device</span>
              <span class="block text-gray-600">{deviceOffer} It answers without reading your Redmine data.</span>
            </span>
            <button type="button" class={offer} on:click={useDevice}>Use this device</button>
          </li>
        {/if}
        {#each localServers as server (server.baseUrl)}
          <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="min-w-0">
              <span class="font-medium text-gray-900">{server.label}</span>
              <span class="block break-all text-gray-600">{server.baseUrl} · {modelsOf(server)}</span>
            </span>
            <!-- The name says which server, so that several of them are told apart by a screen reader too. -->
            <button type="button" aria-label="Use {server.label} at {server.baseUrl}" class={offer} on:click={() => useServer(server)}>
              Use this server
            </button>
          </li>
        {/each}
        {#each systemSetup as found (found.source)}
          <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="min-w-0">
              <span class="font-medium text-gray-900">
                {found.kind === 'key' ? `A key for ${ASSISTANT_PROVIDER_INFO[found.provider].label}` : 'An address for a local server'}
              </span>
              <span class="block break-all text-gray-600">
                {found.kind === 'key' ? `Found in ${found.source}. The key is not shown here.` : `${found.value}, from ${found.source}.`}
              </span>
            </span>
            <button
              type="button"
              aria-label={found.kind === 'key' ? `Use the key from ${found.source}` : `Use the address from ${found.source}`}
              class={offer}
              on:click={() => useSetup(found)}
            >
              {found.kind === 'key' ? 'Use this key' : 'Use this address'}
            </button>
          </li>
        {/each}
      </ul>

      {#if nothingFound}
        <p class="mt-2 text-sm text-gray-600">
          Nothing was found here. Start a local server such as Ollama, LM Studio or Lemonade and search again, or choose a service below.
        </p>
      {/if}
    {/if}

    {#if scanProblem}
      <p class="mt-2 text-sm text-amber-700">{scanProblem}</p>
    {/if}
  </section>

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

        {#if onDevice}
          <div class="sm:col-span-1">
            <p class="mt-1 text-sm text-gray-600">
              The device answers with the model the system keeps up to date. There is no address, no key and no model name to fill in.
              {#if device !== 'available' && device !== 'downloading'}
                This webview has no built-in model, so save this only on a device that has one.
              {/if}
            </p>
          </div>
        {:else}
          <div>
            <label for="assistant-model" class={label}>Model</label>
            <input
              id="assistant-model"
              type="text"
              bind:value={model}
              autocomplete="off"
              list="assistant-model-options"
              placeholder="The model's name"
              class={field}
            />
            <datalist id="assistant-model-options">
              {#each models as name (name)}
                <option value={name}></option>
              {/each}
            </datalist>
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
                placeholder={chatKeySaved ? 'Type a new key to replace it' : info.key === 'required' ? 'The key of the service' : 'Leave empty for a local server'}
                class={field}
              />
              {#if chatKeySaved}
                <button type="button" class="mt-1 {button}" on:click={() => forgetKey('chat')}>Remove</button>
              {/if}
            </div>
            {#if info.keyPage}
              <button type="button" class="mt-2 text-sm font-medium text-blue-700 hover:underline" on:click={openKeyPage}>
                Get a key from {info.keyPageName}
              </button>
            {/if}
            {#each keysForProvider as found (found.source)}
              <p class="mt-2 text-sm text-gray-600">
                This computer already has a key for this service, in {found.source}.
                <button type="button" class="font-medium text-blue-700 hover:underline" on:click={() => useSetup(found)}>Use it</button>
              </p>
            {/each}
            {#if deviceOffer && info.key === 'required'}
              <p class="mt-2 text-sm text-gray-600">
                This device can also answer without any key.
                <button type="button" class="font-medium text-blue-700 hover:underline" on:click={useDevice}>Use the model on this device</button>
              </p>
            {/if}
            {#if localServers.length > 0 && info.key === 'required'}
              <p class="mt-2 text-sm text-gray-600">
                A local model server is running on this computer ({localServers[0].label}), and it needs no key.
                <button type="button" class="font-medium text-blue-700 hover:underline" on:click={() => useServer(localServers[0])}>Use it</button>
              </p>
            {/if}
          </div>
        {/if}
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

    <details class="rounded border border-gray-200 p-3">
      <summary class="cursor-pointer text-sm font-semibold text-gray-900">Set this up from a link</summary>
      <p class="mt-2 text-sm text-gray-600">
        A setup link carries the service, the address and the model, so one person can set the app up and the others paste a line. The
        link the app hands out carries no API key; a link that was given one fills the key box too.
      </p>
      <div class="mt-2 space-y-2">
        <label for="assistant-setup-text" class={label}>A setup link or the settings in JSON</label>
        <textarea
          id="assistant-setup-text"
          rows="2"
          bind:value={setupText}
          placeholder="gemiredmine://assistant?provider=gemini&model=gemini-2.5-flash"
          class={field}
        ></textarea>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={button} disabled={!setupText.trim()} on:click={applySetupText}>Fill in the form</button>
          <button type="button" class={button} on:click={copySetupLink}>Copy this setup as a link</button>
        </div>
      </div>
    </details>
  {:else if error}
    <p role="alert" class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>
  {/if}
</div>
