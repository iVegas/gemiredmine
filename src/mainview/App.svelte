<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import AddServerForm from './AddServerForm.svelte';
  import ServerContextSelector from './ServerContextSelector.svelte';
  import ServerLogin from './ServerLogin.svelte';
  import CalendarView from './CalendarView.svelte';
  import AboutView from './AboutView.svelte';
  import { activeServer } from './lib/store';

  let showAddForm = false;
  let showAbout = false;

  function isValidUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
</script>

<div class="flex h-screen w-full bg-gray-50 font-sans">
  <Sidebar onAddServerClick={() => showAddForm = true} onAboutClick={() => showAbout = true} />

  <main class="flex-1 overflow-auto relative">
    {#if showAddForm}
      <div class="absolute inset-0 bg-gray-50 z-10 p-4 overflow-auto">
        <AddServerForm
          onCancel={() => showAddForm = false}
          onSuccess={() => showAddForm = false}
        />
      </div>
    {/if}

    {#if showAbout}
      <div class="absolute inset-0 bg-gray-50 z-10 p-8 overflow-auto">
        <AboutView onClose={() => showAbout = false} />
      </div>
    {/if}

    <div class="p-8 min-h-full flex flex-col gap-6">
      {#if $activeServer && !showAddForm}
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-0">
            <h1 class="text-3xl font-bold text-gray-900 truncate">{$activeServer.name}</h1>
            {#if isValidUrl($activeServer.url)}
              <a href={$activeServer.url} target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline break-all">{$activeServer.url}</a>
            {:else}
              <span class="text-gray-600 break-all">{$activeServer.url}</span>
            {/if}
          </div>
          <ServerContextSelector />
        </header>

        {#if $activeServer.apiToken}
          <CalendarView server={$activeServer} />
        {:else}
          <ServerLogin server={$activeServer} />
        {/if}
      {:else if !showAddForm}
        <div class="h-full flex flex-col items-center justify-center text-center">
          <h2 class="text-2xl font-semibold text-gray-700 mb-2">No Server Selected</h2>
          <p class="text-gray-500 mb-6">Select a server from the sidebar or add a new one.</p>
          <button
            class="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            on:click={() => showAddForm = true}
          >
            Add First Server
          </button>
        </div>
      {/if}
    </div>
  </main>
</div>
