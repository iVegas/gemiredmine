<script lang="ts">
  import { remembersSignIn, updateServer, type ServerConnection } from './lib/store';
  import { redmineApi } from './lib/api';

  export let server: ServerConnection;

  // The user who signed in to this server last time, kept with the server. The password never is.
  let username = server.user?.login ?? '';
  // What the user chose at this server before.
  let remember = remembersSignIn(server);
  let password = '';
  let error = '';
  let busy = false;

  async function handleSubmit() {
    error = '';
    busy = true;
    try {
      const result = await redmineApi.signIn({ baseUrl: server.url, username, password });
      password = '';
      updateServer(server.id, { apiToken: result.apiKey, user: result.user, remember, signInNotice: undefined });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="max-w-md mx-auto mt-6 p-6 bg-white rounded-lg shadow border border-gray-200">
  <h2 class="text-xl font-semibold mb-1 text-gray-800">Sign in to {server.name}</h2>
  <p class="text-sm text-gray-500 mb-6">Your password is used once to fetch an API key. It is not stored.</p>

  {#if server.signInNotice}
    <p role="alert" class="mb-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">{server.signInNotice}</p>
  {/if}

  <form on:submit|preventDefault={handleSubmit} class="space-y-4">
    <div>
      <label for="login-username" class="block text-sm font-medium text-gray-700">Username</label>
      <input type="text" id="login-username" autocomplete="username" required bind:value={username} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
    </div>

    <div>
      <label for="login-password" class="block text-sm font-medium text-gray-700">Password</label>
      <input type="password" id="login-password" autocomplete="current-password" required bind:value={password} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border">
    </div>

    <div class="flex items-start gap-2">
      <input type="checkbox" id="login-remember" bind:checked={remember} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
      <label for="login-remember" class="text-sm text-gray-700">
        Remember me on this computer
        <span class="block text-xs text-gray-500">Keeps the API key in the system's credential store, so you do not sign in at every start.</span>
      </label>
    </div>

    {#if error}
      <p role="alert" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</p>
    {/if}

    <button type="submit" disabled={busy} class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</div>
