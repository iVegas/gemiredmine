<script lang="ts">
  import { addServer } from './lib/store';

  export let onCancel: () => void;
  export let onSuccess: () => void;

  let name = '';
  let url = '';
  let username = '';
  let password = '';
  let apiToken = '';

  function handleSubmit(event: Event) {
    event.preventDefault();
    addServer({ name, url, username, password, apiToken });
    onSuccess();
  }
</script>

<div class="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
  <h2 class="text-2xl font-bold mb-6 text-gray-800">Add New Server</h2>

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
      <h3 class="text-sm font-medium text-gray-700 mb-2">Authentication (Optional)</h3>

      <div class="space-y-4">
        <div>
          <label for="apiToken" class="block text-sm text-gray-600">API Token</label>
          <input type="password" id="apiToken" bind:value={apiToken} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
        </div>

        <div class="text-xs text-gray-500 text-center">- OR -</div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="username" class="block text-sm text-gray-600">Username</label>
            <input type="text" id="username" bind:value={username} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
          </div>
          <div>
            <label for="password" class="block text-sm text-gray-600">Password</label>
            <input type="password" id="password" bind:value={password} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-end space-x-3 pt-4">
      <button type="button" class="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500" on:click={onCancel}>
        Cancel
      </button>
      <button type="submit" class="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
        Add Server
      </button>
    </div>
  </form>
</div>
