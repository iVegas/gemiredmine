<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import AddServerForm from './AddServerForm.svelte';
  import { activeServerId, serversById } from './lib/store';

  let showAddForm = false;

  $: activeServer = $activeServerId ? $serversById.get($activeServerId) : null;
</script>

<div class="flex h-screen w-full bg-gray-50 font-sans">
  <Sidebar onAddServerClick={() => showAddForm = true} />

  <main class="flex-1 overflow-auto relative">
    {#if showAddForm}
      <div class="absolute inset-0 bg-gray-50 z-10 p-4">
        <AddServerForm
          onCancel={() => showAddForm = false}
          onSuccess={() => showAddForm = false}
        />
      </div>
    {/if}

    <div class="p-8 h-full flex flex-col">
      {#if activeServer && !showAddForm}
        <header class="mb-8">
          <h1 class="text-3xl font-bold text-gray-900">{activeServer.name}</h1>
          <a href={activeServer.url} target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">{activeServer.url}</a>
        </header>

        <div class="bg-white p-6 rounded-lg shadow border border-gray-200 flex-1 flex items-center justify-center">
          <p class="text-gray-500 text-lg">Server Dashboard Integration Pending...</p>
        </div>
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
