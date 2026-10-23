<script lang="ts">
  import type { ServerConnection } from './lib/store';
  import type { RedmineTimeEntry } from '../bun/redmine/types';
  import type { TimeActivity } from '../shared/backend';
  import { redmineApi } from './lib/api';
  import { formatHours, parseHours } from './lib/calendar';
  import { formatDueDate } from './lib/todo';
  import { customFieldText, formatTimestamp, serverPage } from './lib/task-details';
  import { logView, openTask, setViewLabel } from './lib/views';
  import HoursField from './components/HoursField.svelte';

  export let server: ServerConnection;
  export let entryId: number;

  let entry: RedmineTimeEntry | null = null;
  let loading = false;
  let error = '';
  // Responses for an entry or a server the view has moved on from are ignored.
  let latestRequest = 0;

  // The form that changes the entry. Redmine decides who may change it: a refused change says so here.
  let editing = false;
  let activities: TimeActivity[] = [];
  let activitiesError = '';
  let draft = { hours: '', spentOn: '', activityId: null as number | null, comments: '' };
  let saving = false;
  let saveError = '';
  let saved = '';

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

  /** Opens the form with the entry's current values. The activities are fetched the first time. */
  async function startEdit() {
    if (!entry) return;
    draft = {
      hours: String(entry.hours),
      spentOn: entry.spent_on,
      activityId: entry.activity.id,
      comments: entry.comments ?? '',
    };
    editing = true;
    saved = '';
    saveError = '';
    if (activities.length > 0 || !server.apiToken) return;
    activitiesError = '';
    try {
      activities = await redmineApi.listTimeActivities({ baseUrl: server.url, apiKey: server.apiToken });
    } catch (err) {
      activitiesError = err instanceof Error ? err.message : String(err);
    }
  }

  async function saveEdit() {
    const hours = parseHours(draft.hours);
    if (hours === null) {
      saveError = 'Enter the time as hours, like 1.5, 1,5 or 1:30.';
      return;
    }
    if (!draft.spentOn || draft.activityId === null) {
      saveError = 'Enter the date and an activity.';
      return;
    }
    if (!server.apiToken || saving) return;

    saving = true;
    saveError = '';
    saved = '';
    try {
      await redmineApi.updateLogEntry(
        { baseUrl: server.url, apiKey: server.apiToken },
        entryId,
        { spentOn: draft.spentOn, hours, activityId: draft.activityId, comments: draft.comments.trim() }
      );
      editing = false;
      saved = 'Saved.';
      await reload();
    } catch (err) {
      saveError = `The change was not saved: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      saving = false;
    }
  }

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
        {#if !editing}
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            on:click={startEdit}
          >
            Edit
          </button>
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

    {#if saved}<p role="status" class="text-sm text-green-700">{saved}</p>{/if}

    {#if editing}
      <form
        aria-label="Edit log entry #{entryId}"
        class="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow"
        on:submit|preventDefault={saveEdit}
      >
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <HoursField id="edit-hours-{entryId}" bind:value={draft.hours} />
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Date
            <input type="date" required bind:value={draft.spentOn} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Activity
            <select required disabled={activities.length === 0} bind:value={draft.activityId} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
              {#each activities as activity (activity.id)}
                <option value={activity.id}>{activity.name}</option>
              {/each}
            </select>
          </label>
        </div>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Comment
          <textarea rows="3" bind:value={draft.comments} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
        </label>

        {#if activitiesError}<p role="alert" class="text-sm text-red-700">The activities cannot be loaded: {activitiesError}</p>{/if}
        {#if saveError}<p role="alert" class="text-sm text-red-700">{saveError}</p>{/if}

        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={() => (editing = false)}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || activities.length === 0}
            class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    {:else if saveError}
      <p role="alert" class="text-sm text-red-700">{saveError}</p>
    {/if}

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
