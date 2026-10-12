<script lang="ts">
  import { buildInfo } from '../shared/build-info.generated';
  import { DevPreviewPanel } from './dev-preview.generated';

  export let onClose: () => void;

  const channelNotes: Record<string, string> = {
    stable: 'Stable releases are the recommended version for everyday use.',
    canary: 'Canary builds are release candidates for the next stable version.',
    unstable: 'Unstable builds are created from every change merged to the main branch.',
    dev: 'A local developer build.',
  };

  $: builtAt = new Date(buildInfo.buildDate).toLocaleString();
</script>

<div class="max-w-2xl mx-auto space-y-6">
  <header class="flex items-start justify-between gap-4">
    <div>
      <p class="text-sm text-gray-500">About</p>
      <h1 class="text-3xl font-bold text-gray-900">{buildInfo.productName}</h1>
      <p class="text-lg text-gray-700 mt-1">
        Version <span class="font-mono" data-testid="app-version">{buildInfo.version}</span>
        <span class="ml-2 inline-block rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-800">{buildInfo.label}</span>
      </p>
    </div>
    <button
      type="button"
      class="py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      on:click={onClose}
    >
      Back
    </button>
  </header>

  <section aria-labelledby="build-heading" class="bg-white rounded-lg shadow border border-gray-200 p-6">
    <h2 id="build-heading" class="text-lg font-semibold text-gray-900 mb-3">Build</h2>
    <dl class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
      <dt class="text-gray-500">Channel</dt>
      <dd class="text-gray-900">{channelNotes[buildInfo.channel] ?? buildInfo.label}</dd>
      <dt class="text-gray-500">Commit</dt>
      <dd class="font-mono text-gray-900">{buildInfo.commit}</dd>
      <dt class="text-gray-500">Built</dt>
      <dd class="text-gray-900">{builtAt}</dd>
      <dt class="text-gray-500">Identifier</dt>
      <dd class="font-mono text-xs break-all text-gray-900">{buildInfo.identifier}</dd>
      <dt class="text-gray-500">Settings folder</dt>
      <dd class="font-mono text-xs text-gray-900">{buildInfo.dataDirName}</dd>
    </dl>
    <p class="text-sm text-gray-600 mt-4">
      Each channel keeps its own settings and logs in its own folder, so several channels can be installed side by side.
    </p>
  </section>

  <section aria-labelledby="updates-heading" class="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-3">
    <h2 id="updates-heading" class="text-lg font-semibold text-gray-900">Updates</h2>
    <p class="text-sm text-gray-700">
      Gemiredmine does not download or replace itself. Updates come from the way you installed it: use
      <code class="font-mono text-xs">AppImageUpdate</code> for the AppImage, or your package manager where one is available.
      Each channel updates only within its own channel.
    </p>
    <p class="text-sm text-gray-700">
      Release notes and downloads are on the
      <a href="https://github.com/iVegas/gemiredmine/releases" target="_blank" rel="noopener noreferrer" class="text-blue-700 underline">releases page</a>.
    </p>
  </section>

  {#if DevPreviewPanel}
    <DevPreviewPanel />
  {/if}

  <footer class="text-xs text-gray-500">Released under the ISC licence. Source: <a href={buildInfo.repositoryUrl} target="_blank" rel="noopener noreferrer" class="underline">{buildInfo.repositoryUrl}</a></footer>
</div>
