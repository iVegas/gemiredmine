<script lang="ts">
  import { onMount } from 'svelte';
  import { redmineApi } from '../lib/api';
  import type { DevPreviewStatus, FeedbackResult } from '../../bun/diagnostics/service';

  let status: DevPreviewStatus | null = null;
  let loadError = '';
  let busy = false;

  let title = '';
  let description = '';
  let includeLogs = true;
  let feedback: FeedbackResult | null = null;
  let feedbackError = '';
  let opened = false;

  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  async function load() {
    try {
      status = await redmineApi.getDevPreviewStatus();
    } catch (error) {
      loadError = messageOf(error);
    }
  }

  async function toggle() {
    if (!status) return;
    busy = true;
    loadError = '';
    try {
      status = await redmineApi.setDevPreviewEnabled(!status.enabled);
      feedback = null;
    } catch (error) {
      loadError = messageOf(error);
    } finally {
      busy = false;
    }
  }

  async function sendFeedback() {
    busy = true;
    feedbackError = '';
    feedback = null;
    opened = false;
    try {
      feedback = await redmineApi.createFeedback({ title: title.trim(), description, includeLogs });
      status = await redmineApi.getDevPreviewStatus();
      try {
        await redmineApi.openIssueLink(feedback.issueUrl);
        opened = true;
      } catch {
        // The link is still shown below, so the user can open it by hand.
      }
    } catch (error) {
      feedbackError = messageOf(error);
    } finally {
      busy = false;
    }
  }

  onMount(load);
</script>

<section aria-labelledby="dev-preview-heading" class="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-5">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 id="dev-preview-heading" class="text-lg font-semibold text-gray-900">Developer preview</h2>
      <p class="text-sm text-gray-600 mt-1">
        Off by default. When on, Gemiredmine keeps a small, rotated log of recent errors on this computer. Credentials are
        removed before anything is written. Nothing leaves this computer unless you create an issue below.
      </p>
    </div>

    {#if status}
      <button
        type="button"
        role="switch"
        aria-checked={status.enabled}
        aria-labelledby="dev-preview-heading"
        disabled={busy}
        class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 {status.enabled ? 'bg-blue-600' : 'bg-gray-300'}"
        on:click={toggle}
      >
        <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform {status.enabled ? 'translate-x-5' : 'translate-x-0.5'}"></span>
      </button>
    {/if}
  </div>

  {#if loadError}
    <p role="alert" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{loadError}</p>
  {/if}

  {#if status?.enabled}
    <dl class="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
      <dt class="text-gray-500">Stored log</dt>
      <dd class="text-gray-900">{formatBytes(status.logBytes)}</dd>
      <dt class="text-gray-500">Pending entries</dt>
      <dd class="text-gray-900">{status.pendingEntries}</dd>
      <dt class="text-gray-500">Folder</dt>
      <dd class="font-mono text-xs break-all text-gray-900">{status.dataDir}</dd>
    </dl>

    <form on:submit|preventDefault={sendFeedback} class="space-y-4 border-t border-gray-200 pt-5">
      <div>
        <h3 class="text-base font-semibold text-gray-900">Send feedback</h3>
        <p class="text-sm text-gray-600">
          Opens a prefilled GitHub issue in your browser. Review it there before you submit.
        </p>
      </div>

      <div>
        <label for="feedback-title" class="block text-sm font-medium text-gray-700">Title</label>
        <input
          id="feedback-title"
          type="text"
          required
          maxlength="120"
          bind:value={title}
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
        />
      </div>

      <div>
        <label for="feedback-description" class="block text-sm font-medium text-gray-700">What happened?</label>
        <textarea
          id="feedback-description"
          rows="4"
          bind:value={description}
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
        ></textarea>
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" bind:checked={includeLogs} class="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        Include aggregated diagnostics
      </label>

      {#if feedbackError}
        <p role="alert" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{feedbackError}</p>
      {/if}

      <button
        type="submit"
        disabled={busy || !title.trim()}
        class="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        Create GitHub issue
      </button>
    </form>

    {#if feedback}
      <div role="status" class="text-sm text-gray-800 bg-blue-50 border border-blue-200 rounded p-4 space-y-2">
        {#if opened}
          <p>The prefilled issue is open in your browser. Review it there before you submit.</p>
        {:else}
          <p>Your browser did not open the prefilled issue. Open it from the link below, and review it before you submit.</p>
        {/if}
        {#if includeLogs && feedback.logsIncluded !== 'all'}
          <p>The logs were shortened to fit the issue link. Attach the full report to the issue.</p>
        {/if}
        <p>Full report: <code class="break-all text-xs">{feedback.reportPath}</code></p>
        <p>
          <a href={feedback.issueUrl} target="_blank" rel="noopener noreferrer" class="text-blue-700 underline">Open the prefilled issue</a>
        </p>
      </div>
    {/if}
  {/if}
</section>
