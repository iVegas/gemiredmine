<script lang="ts">
  import AddServerForm from './AddServerForm.svelte';
  import StorageNotice from './StorageNotice.svelte';
  import { storageProblem } from './lib/persistence';
  import { servers, activeServerId, removeServer, updateServer, type ServerConnection } from './lib/store';
  import { openView } from './lib/views';

  let adding = false;

  function signIn(server: ServerConnection) {
    // The dashboard asks a signed-out server to sign in.
    activeServerId.set(server.id);
    openView('dashboard');
  }

  function signOut(server: ServerConnection) {
    updateServer(server.id, { apiToken: undefined, user: undefined });
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <h2 class="text-2xl font-bold text-gray-900">Settings</h2>

  <section aria-labelledby="settings-servers-heading" class="rounded-lg border border-gray-200 bg-white shadow">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
      <div>
        <h3 id="settings-servers-heading" class="text-lg font-semibold text-gray-900">Servers</h3>
        <p class="text-sm text-gray-500">Add, switch between and remove your Redmine servers. The servers are kept for the next start; passwords and API keys are not, so you sign in again.</p>
      </div>
      {#if !adding}
        <button
          type="button"
          class="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          on:click={() => (adding = true)}
        >
          + Add Server
        </button>
      {/if}
    </div>

    {#if $storageProblem}
      <div class="border-b border-gray-200 p-4"><StorageNotice /></div>
    {/if}

    {#if adding}
      <div class="border-b border-gray-200 bg-gray-50 px-4 pb-6">
        <AddServerForm onCancel={() => (adding = false)} onSuccess={() => (adding = false)} />
      </div>
    {/if}

    <ul>
      {#each $servers as server (server.id)}
        {@const active = $activeServerId === server.id}
        <li class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4 last:border-b-0 {active ? 'bg-blue-50' : ''}">
          <div class="min-w-0">
            <p class="font-medium text-gray-900">
              {server.name}
              {#if active}
                <span class="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">Active</span>
              {/if}
            </p>
            <p class="truncate text-sm text-gray-500">{server.url}</p>
            {#if server.apiToken}
              <p class="text-xs text-green-700 mt-1">Signed in as {server.user?.login ?? 'user'}</p>
            {:else}
              <p class="text-xs text-amber-700 mt-1">Not signed in</p>
            {/if}
          </div>

          <div class="flex flex-wrap gap-2">
            {#if !active}
              <button
                type="button"
                aria-label="Switch to {server.name}"
                class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                on:click={() => activeServerId.set(server.id)}
              >
                Switch to
              </button>
            {/if}
            {#if server.apiToken}
              <button
                type="button"
                aria-label="Sign out of {server.name}"
                class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                on:click={() => signOut(server)}
              >
                Sign out
              </button>
            {:else}
              <button
                type="button"
                aria-label="Sign in to {server.name}"
                class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                on:click={() => signIn(server)}
              >
                Sign in
              </button>
            {/if}
            <button
              type="button"
              aria-label="Remove {server.name}"
              class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              on:click={() => removeServer(server.id)}
            >
              Remove
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
</div>
