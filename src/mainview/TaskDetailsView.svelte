<script lang="ts">
  import type { ServerConnection } from './lib/store';
  import type { TaskDetails, TaskOptions, TimeActivity } from '../shared/backend';
  import type { RedmineTimeEntry } from '../bun/redmine/types';
  import { redmineApi } from './lib/api';
  import { formatHours, parseHours, sumHours, toDateKey } from './lib/calendar';
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
  import { startChatPanel } from './lib/assistant-dock';
  import HoursField from './components/HoursField.svelte';

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

  /**
   * Opens a chat about this task, in a window beside it. The question is started for the user, who finishes it: the
   * number is in the text, so the assistant reads the task with the same tool an agent would.
   */
  function askAboutTask() {
    const subject = details?.issue.subject ?? '';
    startChatPanel({
      title: `Task #${taskId}`,
      draft: `About task #${taskId}${subject ? ` (${subject})` : ''}: `,
    });
  }

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

  // The form for a new log entry, shown above the entries already logged on the task. The activities are fetched
  // the first time the form is opened.
  let logForm = false;
  let activities: TimeActivity[] = [];
  let activitiesError = '';
  // The hours are text, so that "1,01" and "1:01" can be typed as well as "1.01"; they are read by parseHours.
  let draft = { hours: '', spentOn: toDateKey(new Date()), activityId: null as number | null, comments: '' };
  let saving = false;
  let saveError = '';
  let saved = '';

  async function showLogForm() {
    logForm = true;
    saved = '';
    if (activities.length > 0 || !server.apiToken) return;
    activitiesError = '';
    try {
      activities = await redmineApi.listTimeActivities({ baseUrl: server.url, apiKey: server.apiToken });
      draft.activityId ??= activities[0]?.id ?? null;
    } catch (err) {
      activitiesError = describe(err);
    }
  }

  async function logTime() {
    if (!server.apiToken || saving) return;
    const hours = parseHours(draft.hours);
    if (hours === null) {
      saveError = draft.hours.trim() === '' ? 'Enter the hours, the date and an activity.' : 'Enter the time as hours, like 1.5, 1,5 or 1:30.';
      return;
    }
    if (!draft.spentOn || draft.activityId === null) {
      saveError = 'Enter the hours, the date and an activity.';
      return;
    }

    saving = true;
    saveError = '';
    saved = '';
    try {
      await redmineApi.createLogEntry(
        { baseUrl: server.url, apiKey: server.apiToken },
        { taskId, spentOn: draft.spentOn, hours, activityId: draft.activityId, comments: draft.comments.trim() }
      );
      saved = `Logged ${formatHours(hours)} on ${formatDueDate(draft.spentOn)}.`;
      draft = { ...draft, hours: '', comments: '' };
      // The entries and the spent time of the task are fetched again, so the new entry is in the list at once.
      await reload();
    } catch (err) {
      saveError = `The time could not be logged: ${describe(err)}`;
    } finally {
      saving = false;
    }
  }

  // The form that changes the task. Redmine decides which fields this user may change, and a refused change says so.
  let editingTask = false;
  let options: TaskOptions | null = null;
  let optionsError = '';
  let taskDraft = {
    subject: '',
    description: '',
    statusId: null as number | null,
    priorityId: null as number | null,
    startDate: '',
    dueDate: '',
    doneRatio: 0,
    estimatedHours: '',
    notes: '',
  };
  let savingTask = false;
  let taskSaveError = '';
  let taskSaved = '';

  /** Opens the form with the task's current values. The statuses and priorities are fetched the first time. */
  async function startTaskEdit() {
    if (!details || !server.apiToken) return;
    const current = details.issue;
    taskDraft = {
      subject: current.subject,
      description: current.description ?? '',
      statusId: current.status.id,
      priorityId: current.priority.id,
      startDate: current.start_date ?? '',
      dueDate: current.due_date ?? '',
      doneRatio: current.done_ratio ?? 0,
      estimatedHours: current.estimated_hours ? String(current.estimated_hours) : '',
      notes: '',
    };
    editingTask = true;
    taskSaved = '';
    taskSaveError = '';
    if (options) return;
    optionsError = '';
    try {
      options = await redmineApi.listTaskOptions({ baseUrl: server.url, apiKey: server.apiToken });
    } catch (err) {
      optionsError = describe(err);
    }
  }

  async function saveTask() {
    if (!server.apiToken || savingTask) return;
    const subject = taskDraft.subject.trim();
    const { statusId, priorityId, doneRatio } = taskDraft;
    const estimate = taskDraft.estimatedHours.trim() === '' ? null : parseHours(taskDraft.estimatedHours);
    if (subject === '') {
      taskSaveError = 'Enter a subject.';
      return;
    }
    if (statusId === null || priorityId === null) {
      taskSaveError = 'Choose a status and a priority.';
      return;
    }
    if (!(doneRatio >= 0 && doneRatio <= 100)) {
      taskSaveError = '% Done must be between 0 and 100.';
      return;
    }
    if (estimate === null && taskDraft.estimatedHours.trim() !== '') {
      taskSaveError = 'Enter the estimate as hours, like 8 or 2:30.';
      return;
    }

    savingTask = true;
    taskSaveError = '';
    taskSaved = '';
    try {
      await redmineApi.updateTask({ baseUrl: server.url, apiKey: server.apiToken }, taskId, {
        subject,
        description: taskDraft.description,
        statusId,
        priorityId,
        startDate: taskDraft.startDate || null,
        dueDate: taskDraft.dueDate || null,
        doneRatio,
        estimatedHours: estimate,
        notes: taskDraft.notes.trim(),
      });
      editingTask = false;
      taskSaved = 'Saved.';
      await reload();
    } catch (err) {
      taskSaveError = `The change was not saved: ${describe(err)}`;
    } finally {
      savingTask = false;
    }
  }

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
        <!-- The assistant opens beside the task, with the question already about it. -->
        <button
          type="button"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          on:click={askAboutTask}
        >
          Ask the assistant
        </button>
        {#if !editingTask}
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            on:click={startTaskEdit}
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

    {#if taskSaved}<p role="status" class="text-sm text-green-700">{taskSaved}</p>{/if}

    {#if editingTask}
      <form
        aria-label="Edit task #{taskId}"
        class="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow"
        on:submit|preventDefault={saveTask}
      >
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Subject
          <input type="text" required bind:value={taskDraft.subject} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Description
          <textarea rows="6" bind:value={taskDraft.description} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
        </label>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Status
            <select required disabled={!options} bind:value={taskDraft.statusId} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
              {#each options?.statuses ?? [] as status (status.id)}
                <option value={status.id}>{status.name}</option>
              {/each}
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Priority
            <select required disabled={!options} bind:value={taskDraft.priorityId} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
              {#each options?.priorities ?? [] as priority (priority.id)}
                <option value={priority.id}>{priority.name}</option>
              {/each}
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Start date
            <input type="date" bind:value={taskDraft.startDate} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Due date
            <input type="date" bind:value={taskDraft.dueDate} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            % Done
            <input type="number" min="0" max="100" step="10" bind:value={taskDraft.doneRatio} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
            Estimated time
            <input type="text" inputmode="decimal" placeholder="8 or 2:30" bind:value={taskDraft.estimatedHours} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
        </div>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-700">
          Note, added to the history (optional)
          <textarea rows="2" bind:value={taskDraft.notes} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
        </label>

        {#if optionsError}<p role="alert" class="text-sm text-red-700">The statuses and priorities cannot be loaded: {optionsError}</p>{/if}
        {#if taskSaveError}<p role="alert" class="text-sm text-red-700">{taskSaveError}</p>{/if}

        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={() => (editingTask = false)}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={savingTask || !options}
            class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            {savingTask ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    {:else if taskSaveError}
      <p role="alert" class="text-sm text-red-700">{taskSaveError}</p>
    {/if}

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
      <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="task-{taskId}-logged" class="font-semibold text-gray-900">Time logged</h3>
        <div class="flex flex-wrap items-baseline gap-3">
          {#if logEntries.length > 0}<span class="text-sm text-gray-500">{formatHours(loggedHours)} in {logEntries.length} {logEntries.length === 1 ? 'entry' : 'entries'}</span>{/if}
          {#if !logForm}
            <button
              type="button"
              disabled={!server.apiToken}
              class="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              on:click={showLogForm}
            >
              Log time
            </button>
          {/if}
        </div>
      </div>

      {#if logForm}
        <form
          aria-label="Log time on #{taskId}"
          class="mb-4 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3"
          on:submit|preventDefault={logTime}
        >
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <HoursField id="log-hours-{taskId}" bind:value={draft.hours} />
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
            <input type="text" bind:value={draft.comments} class="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>

          {#if activitiesError}<p role="alert" class="text-sm text-red-700">The activities cannot be loaded: {activitiesError}</p>{/if}
          {#if saveError}<p role="alert" class="text-sm text-red-700">{saveError}</p>{/if}

          <div class="flex flex-wrap items-center justify-between gap-2">
            <p role="status" class="text-sm text-green-700">{saved}</p>
            <div class="flex gap-2">
              <button type="button" class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={() => (logForm = false)}>
                Close
              </button>
              <button
                type="submit"
                disabled={saving || activities.length === 0}
                class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              >
                {saving ? 'Logging…' : 'Log time'}
              </button>
            </div>
          </div>
        </form>
      {/if}

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
