<script lang="ts">
  import AddServerForm from './AddServerForm.svelte';
  import StorageNotice from './StorageNotice.svelte';
  import { resetViews } from './lib/views';
</script>

<div class="min-h-screen w-full overflow-auto bg-gray-50 px-4 py-12 font-sans">
  <header class="mx-auto max-w-xl text-center">
    <h1 class="text-3xl font-bold text-gray-900">Welcome to Gemiredmine</h1>
    <p class="mt-3 text-gray-600">
      Your Redmine work in one place: time you logged, tasks assigned to you and what is due, across all your servers.
    </p>
    <p class="mt-2 text-gray-600">
      To get started, add the Redmine server you work with. You can add more servers later in Settings.
    </p>
  </header>

  <div class="mx-auto mt-6 max-w-xl"><StorageNotice /></div>

  <!-- A fresh start opens on the dashboard, even if tabs were left open before the last server was removed. -->
  <AddServerForm title="Add your first server" onSuccess={resetViews} />
</div>
