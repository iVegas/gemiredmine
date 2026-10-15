<script lang="ts">
  import type { ServerConnection } from './lib/store';
  import type { TaskDetails } from '../shared/backend';
  import type { RedmineTimeEntry } from '../bun/redmine/types';
  import { redmineApi } from './lib/api';
  import { formatHours, sumHours } from './lib/calendar';
  import { formatDueDate, isOverdue } from './lib/todo';
  import {
    attachmentLink,
    customFieldText,
    describeRelation,
    formatBytes,
    formatTimestamp,
    historyEntries,
    serverPage,
  } from './lib/task-details';
  import { openLogEntry, openTask, setViewLabel, taskView } from './lib/views';

  export let server: ServerConnection;
  export let taskId: number;

  let details: TaskDetails | null = null;
  let logEntries: RedmineTimeEntry[] = [];
  let logsError = '';
  let loading = false;
  let error = '';
  // Responses for a task or a server the view has moved on from are ignored.
  let latestRequest = 0;

  $: load(server.url, server.apiToken, taskId);

  const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

  async function load(baseUrl: string, apiKey: string | undefined, id: number) {
    if (!apiKey) return;

    const request = ++latestRequest;
    const access = { baseUrl, apiKey };
    loading = true;
    error = '';
    logsError = '';
    // The time logged is fetched on its own: a user may see a task and not the time that others logged on it.
    const logs = redmineApi.listTaskLogEntries(access, id).then(
      (entries) => ({ entries }),
      (err: unknown) => ({ failure: describe(err) })
    );
    try {
      const task = await redmineApi.getTask(access, id);
      if (request !== latestRequest) return;
      details = task;
      setViewLabel(taskView(server.id, id), `#${id} ${task.issue.subject}`);
    } catch (err) {
      if (request !== latestRequest) return;
      details = null;
      error = describe(err);
    } finally {
      if (request === latestRequest) loading = false;
    }

    const result = await logs;
    if (request !== latestRequest) return;
    if ('entries' in result) {
      logEntries = result.entries;
    } else {
      logEntries = [];
      logsError = result.failure;
    }
  }

  const reload = () => load(server.url, server.apiToken, taskId);

  $: issue = details?.issue ?? null;
  $: overdue = issue !== null && !issue.closed_on && isOverdue(issue);
  $: history = issue ? historyEntries(issue.journals ?? [], details?.names ?? {}, issue.custom_fields ?? []) : [];
  $: redmineLink = serverPage(server.url, `/issues/${taskId}`);
  $: loggedHours = sumHours(logEntries);

  /** The facts of the task in a list of labels and values. Fields the task has no value for are left out. */
  $: facts = issue
    ? ([
        ['Project', issue.project.name],
        ['Tracker', issue.tracker.name],
        ['Status', issue.status.name],
        ['Priority', issue.priority.name],
        ['Author', issue.author?.name],
        ['Assignee', issue.assigned_to?.name],
        ['Category', issue.category?.name],
        ['Target version', issue.fixed_version?.name],
        ['Start date', issue.start_date ? formatDueDate(issue.start_date) : undefined],
        ['Due date', issue.due_date ? `${formatDueDate(issue.due_date)}${overdue ? ' (overdue)' : ''}` : undefined],
        ['Estimated time', issue.estimated_hours ? formatHours(issue.estimated_hours) : undefined],
        ['Spent time', issue.spent_hours ? formatHours(issue.spent_hours) : undefined],
        ['Created', issue.created_on ? formatTimestamp(issue.created_on) : undefined],
        ['Updated', issue.updated_on ? formatTimestamp(issue.updated_on) : undefined],
        ['Closed', issue.closed_on ? formatTimestamp(issue.closed_on) : undefined],
        ...(issue.custom_fields ?? []).map((field) => [field.name, customFieldText(field) || undefined]),
      ] as Array<[string, string | undefined]>).filter(([, value]) => value !== undefined && value !== '')
    : [];
</script>

<section aria-labelledby="task-{taskId}-heading" aria-busy={loading} class="mx-auto flex max-w-4xl min-w-0 flex-col gap-5">
  {#if error}
    <div role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <span>Could not load task #{taskId} from {server.name}: {error}</span>
      <button type="button" class="rounded border border-red-300 bg-white px-3 py-1 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={reload}>
        Try again
      </button>
    </div>
  {:else if !issue}
    <p role="status" class="text-gray-600">Loading task #{taskId}…</p>
  {/if}

  {#if issue}
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 id="task-{taskId}-heading" class="break-words text-2xl font-bold text-gray-900">
          <span class="font-mono text-gray-500">#{issue.id}</span> {issue.subject}
        </h2>
        <p class="mt-1 flex flex-wrap gap-2 text-xs font-medium">
          <span class="rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-700">{issue.tracker.name}</span>
          <span class="rounded-full bg-blue-100 px-2.5 py-0.5 text-blue-800">{issue.status.name}</span>
          <span class="rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-700">{issue.priority.name}</span>
          {#if issue.is_private}<span class="rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-800">Private</span>{/if}
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
            <dt class="w-32 shrink-0 text-gray-500">{label}</dt>
            <dd class="min-w-0 break-words text-gray-900 {label === 'Due date' && overdue ? 'font-medium text-red-700' : ''}">{value}</dd>
          </div>
        {/each}
        <div class="flex items-center gap-2">
          <dt class="w-32 shrink-0 text-gray-500">% Done</dt>
          <dd class="flex min-w-0 flex-1 items-center gap-2 text-gray-900">
            <span
              role="progressbar"
              aria-label="Done"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={issue.done_ratio ?? 0}
              class="block h-2 w-full max-w-[10rem] overflow-hidden rounded bg-gray-200"
            >
              <span class="block h-full bg-blue-600" style="width: {issue.done_ratio ?? 0}%"></span>
            </span>
            {issue.done_ratio ?? 0}%
          </dd>
        </div>
      </dl>
    </section>

    {#if issue.parent || (issue.children ?? []).length > 0 || (issue.relations ?? []).length > 0}
      <section aria-labelledby="task-{taskId}-related" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
        <h3 id="task-{taskId}-related" class="mb-2 font-semibold text-gray-900">Related tasks</h3>
        <ul class="space-y-1 text-sm">
          {#if issue.parent}
            <li>
              <span class="text-gray-500">Parent task</span>
              <button type="button" class="font-mono text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" on:click={() => openTask(server.id, issue.parent!.id)}>#{issue.parent.id}</button>
            </li>
          {/if}
          {#each issue.children ?? [] as child (child.id)}
            <li>
              <span class="text-gray-500">Subtask</span>
              <button type="button" class="text-left text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" on:click={() => openTask(server.id, child.id)}>
                <span class="font-mono">#{child.id}</span> {child.subject}
              </button>
              <span class="text-xs text-gray-500">{child.tracker.name}</span>
            </li>
          {/each}
          {#each issue.relations ?? [] as relation (relation.id)}
            {@const related = describeRelation(relation, issue.id)}
            <li>
              <span class="text-gray-500">{related.label}</span>
              <button type="button" class="font-mono text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" on:click={() => openTask(server.id, related.otherId)}>#{related.otherId}</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="task-{taskId}-description" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <h3 id="task-{taskId}-description" class="mb-2 font-semibold text-gray-900">Description</h3>
      {#if issue.description?.trim()}
        <!-- Shown as it was typed. Redmine's markup is not rendered, and nothing in it is run. -->
        <div class="whitespace-pre-wrap break-words text-sm text-gray-800">{issue.description}</div>
      {:else}
        <p class="text-sm text-gray-500">There is no description.</p>
      {/if}
    </section>

    {#if (issue.attachments ?? []).length > 0}
      <section aria-labelledby="task-{taskId}-files" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
        <h3 id="task-{taskId}-files" class="mb-2 font-semibold text-gray-900">Files</h3>
        <ul class="space-y-1 text-sm">
          {#each issue.attachments ?? [] as file (file.id)}
            {@const link = attachmentLink(server.url, file.content_url)}
            <li>
              {#if link}
                <a href={link} target="_blank" rel="noopener noreferrer" class="text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{file.filename}</a>
              {:else}
                {file.filename}
              {/if}
              <span class="text-xs text-gray-500">{formatBytes(file.filesize)} · {file.author.name} · {formatTimestamp(file.created_on)}</span>
              {#if file.description}<p class="text-xs text-gray-600">{file.description}</p>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-labelledby="task-{taskId}-logged" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <h3 id="task-{taskId}-logged" class="mb-2 flex items-baseline justify-between gap-2 font-semibold text-gray-900">
        <span>Time logged</span>
        {#if logEntries.length > 0}<span class="text-sm font-normal text-gray-500">{formatHours(loggedHours)} in {logEntries.length} {logEntries.length === 1 ? 'entry' : 'entries'}</span>{/if}
      </h3>
      {#if logsError}
        <p class="text-sm text-gray-600">The time logged on this task cannot be shown: {logsError}</p>
      {:else if logEntries.length === 0}
        <p class="text-sm text-gray-500">No time has been logged on this task.</p>
      {:else}
        <ul class="divide-y divide-gray-100 text-sm">
          {#each logEntries as entry (entry.id)}
            <li>
              <button
                type="button"
                class="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                on:click={() => openLogEntry(server.id, entry.id)}
              >
                <time datetime={entry.spent_on} class="w-28 shrink-0 text-gray-700">{formatDueDate(entry.spent_on)}</time>
                <span class="w-14 shrink-0 font-medium text-gray-900">{formatHours(entry.hours)}</span>
                <span class="text-gray-600">{entry.user.name} · {entry.activity.name}</span>
                {#if entry.comments}<span class="min-w-0 basis-full truncate text-gray-500 sm:basis-auto">{entry.comments}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section aria-labelledby="task-{taskId}-history" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <h3 id="task-{taskId}-history" class="mb-2 font-semibold text-gray-900">History</h3>
      {#if history.length === 0}
        <p class="text-sm text-gray-500">Nothing has been said or changed on this task.</p>
      {:else}
        <ol class="space-y-4">
          {#each history as entry (entry.id)}
            <li class="border-l-2 border-gray-200 pl-3 text-sm">
              <p class="text-gray-600">
                <span class="font-medium text-gray-900">{entry.author}</span>
                <time datetime={entry.when}>{formatTimestamp(entry.when)}</time>
                {#if entry.isPrivate}<span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Private</span>{/if}
              </p>
              {#if entry.changes.length > 0}
                <ul class="mt-1 list-disc pl-5 text-gray-700">
                  {#each entry.changes as change}<li>{change}</li>{/each}
                </ul>
              {/if}
              {#if entry.notes}
                <div class="mt-1 whitespace-pre-wrap break-words text-gray-800">{entry.notes}</div>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</section>
