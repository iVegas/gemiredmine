<script lang="ts">
  import { onMount } from 'svelte';
  import AddServerForm from './AddServerForm.svelte';
  import { redmineApi } from './lib/api';
  import { servers, activeServerId, removeServer, remembersSignIn, updateServer, type ServerConnection } from './lib/store';
  import { openView } from './lib/views';
  import type { CredentialOptions } from '../shared/backend';

  let adding = false;

  /** The fingerprint or face unlock of the saved sign-ins. Null where the device has none, so the section is not shown. */
  let biometric: CredentialOptions['biometric'] = null;
  let biometricError = '';
  let biometricBusy = false;

  onMount(async () => {
    try {
      biometric = (await redmineApi.getCredentialOptions()).biometric;
    } catch {
      // Outside the desktop app there are no saved sign-ins to unlock.
      biometric = null;
    }
  });

  // The switch shows the new setting at once and goes back to the old one if the change is refused.
  async function setBiometric(enabled: boolean) {
    const current = biometric;
    if (!current) return;
    biometric = { ...current, enabled };
    biometricBusy = true;
    biometricError = '';
    try {
      await redmineApi.setBiometricUnlock(enabled);
    } catch (error) {
      biometric = { ...current, enabled: current.enabled };
      biometricError = `The change was not saved: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      biometricBusy = false;
    }
  }

  function signIn(server: ServerConnection) {
    // The dashboard asks a signed-out server to sign in.
    activeServerId.set(server.id);
    openView('dashboard');
  }

  function signOut(server: ServerConnection) {
    updateServer(server.id, { apiToken: undefined, user: undefined, signInNotice: undefined });
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <h2 class="text-2xl font-bold text-gray-900">Settings</h2>

  <section aria-labelledby="settings-servers-heading" class="rounded-lg border border-gray-200 bg-white shadow">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
      <div>
        <h3 id="settings-servers-heading" class="text-lg font-semibold text-gray-900">Servers</h3>
        <p class="text-sm text-gray-500">Add, switch between and remove your Redmine servers. The servers are kept for the next start. Passwords are never kept; with Remember me, the API key is kept in the system's credential store.</p>
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
            <label class="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                aria-label="Remember me on this computer for {server.name}"
                checked={remembersSignIn(server)}
                class="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                on:change={(event) => updateServer(server.id, { remember: event.currentTarget.checked })}
              >
              Remember me on this computer
            </label>
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

  {#if biometric}
    <section aria-labelledby="settings-security-heading" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <h3 id="settings-security-heading" class="text-lg font-semibold text-gray-900">Security</h3>
      <p class="mt-1 text-sm text-gray-500">Saved sign-ins are kept encrypted on this device. Whether the app asks for a fingerprint or face before it uses them is up to you.</p>

      <label class="mt-4 flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={biometric.enabled}
          disabled={!biometric.available || biometricBusy}
          class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
          on:change={(event) => setBiometric(event.currentTarget.checked)}
        >
        <span>
          <span class="font-medium">Unlock saved sign-ins with a fingerprint or face</span>
          <span class="block text-gray-500">When on, the app asks for it once when it starts, before it signs in with a saved key. When off, saved sign-ins open without asking.</span>
        </span>
      </label>

      {#if !biometric.available}
        <p class="mt-2 text-sm text-amber-700">Set up a fingerprint or face in the system settings to use this.</p>
      {/if}
      {#if biometricError}
        <p role="alert" class="mt-2 text-sm text-red-700">{biometricError}</p>
      {/if}
    </section>
  {/if}
</div>
