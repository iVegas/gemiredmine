<script lang="ts">
  import type { ServerConnection } from './lib/store';
  import type { RedmineIssue, RedmineReference } from '../bun/redmine/types';
  import { redmineApi } from './lib/api';
  import { redmineChanges } from './lib/data-changes';
  import { formatDueDate, groupTasksByPriority, isOverdue } from './lib/todo';
  import { openTask } from './lib/views';

  export let server: ServerConnection;
  /** The project the list shows, or null for every project the user takes part in. */
  export let project: RedmineReference | null = null;

  let tasks: RedmineIssue[] = [];
  let loading = false;
  let error = '';
  // Responses for a server the user already switched away from are ignored.
  let latestRequest = 0;

  // Reloads after a write in this window, such as an approved task change (see CalendarPreview.svelte), and when the
  // project changes.
  $: void $redmineChanges, load(server.url, server.apiToken, project?.id);

  async function load(baseUrl: string, apiKey: string | undefined, projectId?: number) {
    if (!apiKey) return;

    const request = ++latestRequest;
    loading = true;
    error = '';
    try {
      const assigned = await redmineApi.listAssignedTasks({ baseUrl, apiKey }, { projectId });
      if (request !== latestRequest) return;
      tasks = assigned;
    } catch (err) {
      if (request !== latestRequest) return;
      tasks = [];
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (request === latestRequest) loading = false;
    }
  }

  const reload = () => load(server.url, server.apiToken, project?.id);

  $: groups = groupTasksByPriority(tasks);
  $: where = project ? `in ${project.name}` : 'across all projects';
</script>

<section aria-labelledby="todo-heading" aria-busy={loading} class="flex flex-col gap-4 min-w-0">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 id="todo-heading" class="text-2xl font-bold text-gray-900">To-do</h2>
      <p class="text-sm text-gray-600" aria-live="polite">
        {#if loading}
          Loading…
        {:else if !error}
          {tasks.length} open {tasks.length === 1 ? 'task' : 'tasks'} assigned to you {where}, by priority.
        {/if}
      </p>
    </div>
    <button
      type="button"
      disabled={loading}
      class="py-1.5 px-3 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
      on:click={reload}
    >
      Refresh
    </button>
  </div>

  {#if error}
    <div role="alert" class="flex flex-wrap items-center justify-between gap-3 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-800">
      <span>Could not load tasks from {server.name}: {error}</span>
      <button type="button" class="py-1 px-3 border border-red-300 rounded bg-white hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={reload}>
        Try again
      </button>
    </div>
  {:else if !loading && tasks.length === 0}
    <p class="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
      No open tasks are assigned to you.
    </p>
  {/if}

  {#each groups as group (group.priority.id)}
    <section aria-labelledby="todo-priority-{group.priority.id}" class="rounded-lg border border-gray-200 bg-white shadow">
      <h3 id="todo-priority-{group.priority.id}" class="flex items-baseline justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 rounded-t-lg">
        <span class="font-semibold text-gray-900">{group.priority.name}</span>
        <span class="text-sm font-normal text-gray-500">{group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}</span>
      </h3>
      <ul class="divide-y divide-gray-100">
        {#each group.tasks as task (task.id)}
          {@const overdue = isOverdue(task)}
          <li class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
            <div class="min-w-0 flex-1">
              <p class="text-gray-900">
                <span class="font-mono text-gray-500">#{task.id}</span>
                <button
                  type="button"
                  class="rounded text-left hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  on:click={() => openTask(server.id, task.id)}
                >{task.subject}</button>
              </p>
              <p class="text-xs text-gray-500">{task.project.name} · {task.tracker.name} · {task.status.name}</p>
            </div>
            <div class="shrink-0 text-right text-sm">
              {#if task.due_date}
                <p class={overdue ? 'font-medium text-red-700' : 'text-gray-700'}>
                  Due <time datetime={task.due_date}>{formatDueDate(task.due_date)}</time>{#if overdue}{' '}<span>(overdue)</span>{/if}
                </p>
              {:else}
                <p class="text-gray-400">No due date</p>
              {/if}
              {#if task.done_ratio}
                <p class="text-xs text-gray-500">{task.done_ratio}% done</p>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</section>
