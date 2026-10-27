<script lang="ts">
  import DashboardCard from './DashboardCard.svelte';
  import type { ServerConnection } from '../lib/store';
  import type { RedmineIssue, RedmineTimeEntry } from '../../bun/redmine/types';
  import { redmineApi } from '../lib/api';
  import { redmineChanges } from '../lib/data-changes';
  import { openView } from '../lib/views';
  import {
    WEEKDAY_LABELS,
    buildMonthGrid,
    formatHours,
    groupLogsByDay,
    groupTasksByDay,
    monthBounds,
    sumHours,
  } from '../lib/calendar';

  export let server: ServerConnection;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthLabel = today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weeks = buildMonthGrid(year, month, today);

  let entries: RedmineTimeEntry[] = [];
  let tasks: RedmineIssue[] = [];
  let loading = false;
  let error = '';
  // Responses for a server the user already switched away from are ignored.
  let latestRequest = 0;

  // The write count is read so that an entry or task changed in this window shows here at once, including an approval.
  $: void $redmineChanges, load(server.url, server.apiToken);

  async function load(baseUrl: string, apiKey: string | undefined) {
    if (!apiKey) return;

    const request = ++latestRequest;
    const { from, to } = monthBounds(year, month);
    const access = { baseUrl, apiKey };

    loading = true;
    error = '';
    try {
      const [logs, dueTasks] = await Promise.all([
        redmineApi.listTimeEntries(access, { from, to }),
        redmineApi.listOpenTasks(access, { dueFrom: from, dueTo: to }),
      ]);
      if (request !== latestRequest) return;
      entries = logs;
      tasks = dueTasks;
    } catch (err) {
      if (request !== latestRequest) return;
      entries = [];
      tasks = [];
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (request === latestRequest) loading = false;
    }
  }

  /** Darker cells for days with more time logged. */
  function shade(hours: number | undefined): string {
    if (!hours) return 'bg-gray-50 text-gray-700';
    if (hours < 2) return 'bg-blue-100 text-blue-900';
    if (hours < 4) return 'bg-blue-200 text-blue-900';
    if (hours < 6) return 'bg-blue-300 text-blue-950';
    return 'bg-blue-600 text-white';
  }

  $: logsByDay = groupLogsByDay(entries);
  $: tasksByDay = groupTasksByDay(tasks);
  $: summary = loading
    ? `Loading ${monthLabel}…`
    : error
      ? `Could not load the calendar: ${error}`
      : `${formatHours(sumHours(entries))} logged and ${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'} due in ${monthLabel}.`;
</script>

<DashboardCard id="calendar-preview" title="Calendar" actionLabel="Open calendar" {summary} onOpen={() => openView('calendar')}>
  <!-- The summary above carries this information for screen readers; the grid is a visual overview. -->
  <div aria-hidden="true" data-testid="calendar-preview-grid">
    <p class="mb-2 text-sm font-medium text-gray-700">{monthLabel}</p>
    <div class="grid grid-cols-7 gap-1 text-center text-xs">
      {#each WEEKDAY_LABELS as label}
        <span class="pb-1 text-gray-400">{label.charAt(0)}</span>
      {/each}
      {#each weeks.flat() as day (day.key)}
        <span
          class="relative rounded py-1 {day.inMonth ? shade(logsByDay[day.key]?.hours) : 'text-gray-300'} {day.isToday ? 'ring-2 ring-blue-500' : ''}"
          data-date={day.key}
        >
          {day.day}
          {#if day.inMonth && tasksByDay[day.key]}
            <span class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" data-testid="task-due-marker"></span>
          {/if}
        </span>
      {/each}
    </div>
    <p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
      <span><span class="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-300 align-middle"></span>Time logged</span>
      <span><span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle"></span>Task due</span>
    </p>
  </div>
</DashboardCard>
