<script lang="ts">
  import { servers, activeServerId, removeServer } from './lib/store';

  export let onAddServerClick: () => void;
</script>

<aside class="w-64 bg-gray-100 h-full border-r border-gray-200 flex flex-col">
  <div class="p-4 border-b border-gray-200">
    <h2 class="text-xl font-bold text-gray-800">Servers</h2>
  </div>

  <ul class="flex-1 overflow-y-auto">
    {#each $servers as server (server.id)}
      <li class="flex items-stretch border-b border-gray-200 {$activeServerId === server.id ? 'bg-blue-100 border-l-4 border-l-blue-500' : ''}">
        <button
          class="flex-1 min-w-0 text-left p-4 hover:bg-gray-200 transition-colors"
          aria-current={$activeServerId === server.id ? 'true' : undefined}
          on:click={() => activeServerId.set(server.id)}
        >
          <div class="font-medium text-gray-800">{server.name}</div>
          <div class="text-sm text-gray-500 truncate">{server.url}</div>
          {#if server.apiToken}
            <div class="text-xs text-green-700 mt-1">Signed in as {server.user?.login ?? 'user'}</div>
          {:else}
            <div class="text-xs text-amber-700 mt-1">Not signed in</div>
          {/if}
        </button>
        <button
          type="button"
          class="px-3 text-gray-500 hover:text-red-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
          aria-label="Remove {server.name}"
          title="Remove server"
          on:click={() => removeServer(server.id)}
        >
          ✕
        </button>
      </li>
    {/each}
    {#if $servers.length === 0}
      <li class="p-4 text-gray-500 italic text-sm text-center">
        No servers added yet.
      </li>
    {/if}
  </ul>

  <div class="p-4 border-t border-gray-200">
    <button
      class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
      on:click={onAddServerClick}
    >
      + Add Server
    </button>
  </div>
</aside>
