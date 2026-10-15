<script lang="ts">
  import type { ServerConnection } from './lib/store';
  import type { RedmineTimeEntry } from '../bun/redmine/types';
  import { redmineApi } from './lib/api';
  import { formatHours } from './lib/calendar';
  import { formatDueDate } from './lib/todo';
  import { customFieldText, formatTimestamp, serverPage } from './lib/task-details';
  import { logView, openTask, setViewLabel } from './lib/views';

  export let server: ServerConnection;
  export let entryId: number;

  let entry: RedmineTimeEntry | null = null;
  let loading = false;
  let error = '';
  // Responses for an entry or a server the view has moved on from are ignored.
  let latestRequest = 0;

  $: load(server.url, server.apiToken, entryId);

  async function load(baseUrl: string, apiKey: string | undefined, id: number) {
    if (!apiKey) return;

    const request = ++latestRequest;
    loading = true;
    error = '';
    try {
      const loaded = await redmineApi.getLogEntry({ baseUrl, apiKey }, id);
      if (request !== latestRequest) return;
      entry = loaded;
      setViewLabel(logView(server.id, id), `Log #${id} · ${formatHours(loaded.hours)}`);
    } catch (err) {
      if (request !== latestRequest) return;
      entry = null;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (request === latestRequest) loading = false;
    }
  }

  const reload = () => load(server.url, server.apiToken, entryId);

  // Redmine has no page that shows one entry; its edit page is the one that opens.
  $: redmineLink = serverPage(server.url, `/time_entries/${entryId}/edit`);
  $: facts = entry
    ? ([
        ['Date', formatDueDate(entry.spent_on)],
        ['Time', formatHours(entry.hours)],
        ['User', entry.user.name],
        ['Activity', entry.activity.name],
        ['Project', entry.project.name],
        ['Logged', entry.created_on ? formatTimestamp(entry.created_on) : undefined],
        ['Changed', entry.updated_on && entry.updated_on !== entry.created_on ? formatTimestamp(entry.updated_on) : undefined],
        ...(entry.custom_fields ?? []).map((field) => [field.name, customFieldText(field) || undefined]),
      ] as Array<[string, string | undefined]>).filter(([, value]) => value !== undefined && value !== '')
    : [];
</script>

<section aria-labelledby="log-{entryId}-heading" aria-busy={loading} class="mx-auto flex max-w-3xl min-w-0 flex-col gap-5">
  {#if error}
    <div role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span>Could not load log entry #{entryId} from {server.name}: {error}</span>
      <button type="button" class="rounded border border-red-300 bg-white px-3 py-1 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={reload}>
        Try again
      </button>
    </div>
  {:else if !entry}
    <p role="status" class="text-gray-600">Loading log entry #{entryId}…</p>
  {/if}

  {#if entry}
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 id="log-{entryId}-heading" class="text-2xl font-bold text-gray-900">
          Log entry <span class="font-mono text-gray-500">#{entry.id}</span>
        </h2>
        <p class="mt-1 text-sm text-gray-600">
          {formatHours(entry.hours)} on <time datetime={entry.spent_on}>{formatDueDate(entry.spent_on)}</time>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if redmineLink}
          <a
            href={redmineLink}
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Open in Redmine
          </a>
        {/if}
        <button
          type="button"
          disabled={loading}
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          on:click={reload}
        >
          Refresh
        </button>
      </div>
    </header>

    <section aria-label="Details" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {#each facts as [label, value] (label)}
          <div class="flex gap-2">
            <dt class="w-24 shrink-0 text-gray-500">{label}</dt>
            <dd class="min-w-0 break-words text-gray-900">{value}</dd>
          </div>
        {/each}
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-gray-500">Task</dt>
          <dd class="min-w-0 text-gray-900">
            {#if entry.issue}
              <button type="button" class="font-mono text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" on:click={() => openTask(server.id, entry!.issue!.id)}>
                #{entry.issue.id}
              </button>
            {:else}
              <span class="text-gray-500">Logged on the project, not on a task</span>
            {/if}
          </dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="log-{entryId}-comments" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <h3 id="log-{entryId}-comments" class="mb-2 font-semibold text-gray-900">Comment</h3>
      {#if entry.comments?.trim()}
        <div class="whitespace-pre-wrap break-words text-sm text-gray-800">{entry.comments}</div>
      {:else}
        <p class="text-sm text-gray-500">There is no comment.</p>
      {/if}
    </section>
  {/if}
</section>
