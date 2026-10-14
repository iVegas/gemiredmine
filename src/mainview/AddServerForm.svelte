<script lang="ts">
  import { addServer, type ServerUser } from './lib/store';
  import { redmineApi } from './lib/api';

  export let onSuccess: () => void;
  /** Without it there is nothing to go back to, so no Cancel button is shown. */
  export let onCancel: (() => void) | undefined = undefined;
  export let title = 'Add New Server';

  let name = '';
  let url = '';
  let username = '';
  let password = '';
  let apiToken = '';
  let error = '';
  let busy = false;

  async function handleSubmit(event: Event) {
    event.preventDefault();
    error = '';

    if ((username || password) && !(username && password)) {
      error = 'Enter both a username and a password to sign in, or leave both empty.';
      return;
    }

    const baseUrl = url.trim();
    let auth: { apiToken?: string; user?: ServerUser } = {};

    try {
      if (username && password) {
        busy = true;
        const result = await redmineApi.signIn({ baseUrl, username, password });
        auth = { apiToken: result.apiKey, user: result.user };
      } else if (apiToken) {
        busy = true;
        const user = await redmineApi.getCurrentUser({ baseUrl, apiKey: apiToken });
        auth = { apiToken, user };
      }

      addServer({ name, url: baseUrl, ...auth });
      onSuccess();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
  <h2 class="text-2xl font-bold mb-6 text-gray-800">{title}</h2>

  <form on:submit={handleSubmit} class="space-y-4">
    <div>
      <label for="name" class="block text-sm font-medium text-gray-700">Server Name</label>
      <input type="text" id="name" bind:value={name} required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border" placeholder="My Redmine Server">
    </div>

    <div>
      <label for="url" class="block text-sm font-medium text-gray-700">URL</label>
      <input type="url" id="url" bind:value={url} required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border" placeholder="https://redmine.example.com">
    </div>

    <div class="border-t border-gray-200 pt-4 mt-4">
      <h3 class="text-sm font-medium text-gray-700 mb-1">Authentication (Optional)</h3>
      <p class="text-xs text-gray-500 mb-3">Sign in to fetch an API key. The password is used once and not stored.</p>

      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="username" class="block text-sm text-gray-600">Username</label>
            <input type="text" id="username" autocomplete="username" bind:value={username} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
          </div>
          <div>
            <label for="password" class="block text-sm text-gray-600">Password</label>
            <input type="password" id="password" autocomplete="current-password" bind:value={password} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
          </div>
        </div>

        <div class="text-xs text-gray-500 text-center">- OR -</div>

        <div>
          <label for="apiToken" class="block text-sm text-gray-600">API Token</label>
          <input type="password" id="apiToken" autocomplete="off" bind:value={apiToken} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
        </div>
      </div>
    </div>

    {#if error}
      <p role="alert" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</p>
    {/if}

    <div class="flex justify-end space-x-3 pt-4">
      {#if onCancel}
        <button type="button" class="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500" on:click={onCancel}>
          Cancel
        </button>
      {/if}
      <button type="submit" disabled={busy} class="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
        Add Server
      </button>
    </div>
  </form>
</div>
