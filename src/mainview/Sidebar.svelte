<script lang="ts">
  import { servers, activeServerId } from './lib/store';

  export let onAddServerClick: () => void;
</script>

<aside class="w-64 bg-gray-100 h-full border-r border-gray-200 flex flex-col">
  <div class="p-4 border-b border-gray-200">
    <h2 class="text-xl font-bold text-gray-800">Servers</h2>
  </div>

  <ul class="flex-1 overflow-y-auto">
    {#each $servers as server}
      <li>
        <button
          class="w-full text-left p-4 hover:bg-gray-200 transition-colors {$activeServerId === server.id ? 'bg-blue-100 border-l-4 border-blue-500' : ''}"
          on:click={() => activeServerId.set(server.id)}
        >
          <div class="font-medium text-gray-800">{server.name}</div>
          <div class="text-sm text-gray-500 truncate">{server.url}</div>
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
