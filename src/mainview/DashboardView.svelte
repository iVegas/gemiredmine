<script lang="ts">
  import CalendarPreview from './components/CalendarPreview.svelte';
  import TodoPreview from './components/TodoPreview.svelte';
  import type { ServerConnection } from './lib/store';

  export let server: ServerConnection;
</script>

<div class="flex flex-col gap-6">
  <div>
    <h2 class="text-2xl font-bold text-gray-900">Dashboard</h2>
    <p class="text-sm text-gray-500">Your work on {server.name} at a glance. Select a card to open it in its own tab.</p>
  </div>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
    <CalendarPreview {server} />
    <TodoPreview {server} />
  </div>
</div>
