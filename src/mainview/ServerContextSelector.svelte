<script lang="ts">
  import { servers, activeServer, activeServerId, updateServer } from './lib/store';

  function handleChange(event: Event) {
    activeServerId.set((event.currentTarget as HTMLSelectElement).value);
  }

  function signOut() {
    if ($activeServer) {
      updateServer($activeServer.id, { apiToken: undefined, user: undefined });
    }
  }
</script>

<div class="flex flex-wrap items-center gap-3">
  <label for="server-context" class="text-sm font-medium text-gray-700">Server context</label>
  <select
    id="server-context"
    class="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border bg-white"
    value={$activeServerId ?? ''}
    on:change={handleChange}
  >
    {#each $servers as server (server.id)}
      <option value={server.id}>{server.name}</option>
    {/each}
  </select>

  {#if $activeServer?.apiToken}
    <button
      type="button"
      class="py-2 px-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      on:click={signOut}
    >
      Sign out
    </button>
  {/if}
</div>
