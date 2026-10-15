<script lang="ts">
  import LogEntryView from './LogEntryView.svelte';
  import ServerLogin from './ServerLogin.svelte';
  import TaskDetailsView from './TaskDetailsView.svelte';
  import { credentialsRestoring } from './lib/credentials';
  import { serversById } from './lib/store';
  import { parseDetailView, type DetailViewId } from './lib/views';

  /** The tab: a task or a log entry of one server. */
  export let view: DetailViewId;
  /** Whether this is the tab on show. One sign-in form is shown at a time, so that its fields have unique ids. */
  export let active: boolean;

  $: target = parseDetailView(view);
  $: server = target ? $serversById.get(target.serverId) : undefined;
</script>

{#if !target || !server}
  <p class="text-gray-600">The server of this tab is not in the list any more. Close the tab.</p>
{:else if !server.apiToken}
  {#if active}
    {#if $credentialsRestoring}
      <p role="status" class="text-gray-600">Reading your saved sign-ins…</p>
    {:else}
      <ServerLogin {server} />
    {/if}
  {/if}
{:else if target.kind === 'task'}
  <TaskDetailsView {server} taskId={target.id} />
{:else}
  <LogEntryView {server} entryId={target.id} />
{/if}
