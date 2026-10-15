<script lang="ts">
  import DashboardCard from './DashboardCard.svelte';
  import type { ServerConnection } from '../lib/store';
  import type { RedmineIssue } from '../../bun/redmine/types';
  import { redmineApi } from '../lib/api';
  import { openTask, openView } from '../lib/views';
  import { formatDueDate, groupTasksByPriority, isOverdue } from '../lib/todo';

  export let server: ServerConnection;

  const TOP_TASKS = 3;

  let tasks: RedmineIssue[] = [];
  let loading = false;
  let error = '';
  // Responses for a server the user already switched away from are ignored.
  let latestRequest = 0;

  $: load(server.url, server.apiToken);

  async function load(baseUrl: string, apiKey: string | undefined) {
    if (!apiKey) return;

    const request = ++latestRequest;
    loading = true;
    error = '';
    try {
      const assigned = await redmineApi.listAssignedTasks({ baseUrl, apiKey });
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

  $: groups = groupTasksByPriority(tasks);
  // Highest priority first, then the ones due soonest.
  $: topTasks = groups.flatMap(group => group.tasks).slice(0, TOP_TASKS);
  $: summary = loading
    ? 'Loading your tasks…'
    : error
      ? `Could not load your tasks: ${error}`
      : tasks.length === 0
        ? 'Nothing is assigned to you right now.'
        : `${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'} assigned to you.`;
</script>

<DashboardCard id="todo-preview" title="To-do" actionLabel="Open to-do list" {summary} onOpen={() => openView('todo')}>
  {#if !loading && !error && tasks.length > 0}
    <ul aria-label="Tasks by priority" class="flex flex-wrap gap-2">
      {#each groups as group (group.priority.id)}
        <li class="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {group.priority.name}: {group.tasks.length}
        </li>
      {/each}
    </ul>

    <ul aria-label="Top tasks" class="divide-y divide-gray-100 text-sm">
      {#each topTasks as task (task.id)}
        <li>
          <!-- Above the layer that makes the whole card open the to-do list (DashboardCard), so a click on a task opens the task. -->
          <button
            type="button"
            class="relative z-20 block w-full rounded py-1.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Open task #{task.id}: {task.subject}"
            on:click={() => openTask(server.id, task.id)}
          >
            <span class="block truncate text-gray-800" title={task.subject}>
              <span class="font-mono text-gray-500">#{task.id}</span> {task.subject}
            </span>
            <span class="block text-xs text-gray-500">
              {task.priority.name}{#if task.due_date}{' · '}<span class={isOverdue(task) ? 'font-medium text-red-700' : ''}>due {formatDueDate(task.due_date)}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</DashboardCard>
