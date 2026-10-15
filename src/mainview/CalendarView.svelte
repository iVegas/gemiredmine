<script lang="ts">
  import type { ServerConnection } from './lib/store';
  import type { RedmineIssue, RedmineTimeEntry } from '../bun/redmine/types';
  import { redmineApi } from './lib/api';
  import {
    WEEKDAY_LABELS,
    buildMonthGrid,
    formatHours,
    groupLogsByDay,
    groupTasksByDay,
    monthBounds,
    sumHours,
  } from './lib/calendar';
  import { openLogEntry, openTask } from './lib/views';

  export let server: ServerConnection;

  type View = 'logs' | 'tasks';
  const MAX_ITEMS_PER_DAY = 3;

  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();
  let view: View = 'logs';

  let entries: RedmineTimeEntry[] = [];
  let tasks: RedmineIssue[] = [];
  let loading = false;
  let error = '';
  // Each load gets a number so responses for a month the user already left are ignored.
  let latestRequest = 0;

  $: loadMonth(server.url, server.apiToken, year, month);

  async function loadMonth(baseUrl: string, apiKey: string | undefined, year: number, month: number) {
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

  function shiftMonth(delta: number) {
    const next = new Date(year, month + delta, 1);
    year = next.getFullYear();
    month = next.getMonth();
  }

  function goToToday() {
    year = today.getFullYear();
    month = today.getMonth();
  }

  $: weeks = buildMonthGrid(year, month);
  $: monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $: logsByDay = groupLogsByDay(entries);
  $: tasksByDay = groupTasksByDay(tasks);
  $: totalHours = sumHours(entries);
</script>

<section aria-labelledby="calendar-heading" class="flex flex-col gap-4 min-w-0">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <button type="button" aria-label="Previous month" class="py-1.5 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={() => shiftMonth(-1)}>‹</button>
      <h2 id="calendar-heading" aria-live="polite" class="min-w-[11rem] text-center text-xl font-semibold text-gray-900">{monthLabel}</h2>
      <button type="button" aria-label="Next month" class="py-1.5 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={() => shiftMonth(1)}>›</button>
      <button type="button" class="ml-2 py-1.5 px-3 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={goToToday}>Today</button>
    </div>

    <div role="group" aria-label="Show on calendar" class="inline-flex rounded-md shadow-sm">
      <button
        type="button"
        aria-pressed={view === 'logs'}
        class="py-1.5 px-4 border rounded-l-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 {view === 'logs' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}"
        on:click={() => (view = 'logs')}
      >
        Logs
      </button>
      <button
        type="button"
        aria-pressed={view === 'tasks'}
        class="py-1.5 px-4 border -ml-px rounded-r-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 {view === 'tasks' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}"
        on:click={() => (view = 'tasks')}
      >
        Tasks
      </button>
    </div>
  </div>

  <p class="text-sm text-gray-600" aria-live="polite">
    {#if loading}
      Loading…
    {:else if view === 'logs'}
      {formatHours(totalHours)} logged across {entries.length} {entries.length === 1 ? 'entry' : 'entries'} this month.
    {:else}
      {tasks.length} open {tasks.length === 1 ? 'task' : 'tasks'} due this month.
    {/if}
  </p>

  {#if error}
    <div role="alert" class="flex flex-wrap items-center justify-between gap-3 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-800">
      <span>Could not load data from {server.name}: {error}</span>
      <button type="button" class="py-1 px-3 border border-red-300 rounded bg-white hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-blue-500" on:click={() => loadMonth(server.url, server.apiToken, year, month)}>
        Try again
      </button>
    </div>
  {/if}

  <div class="overflow-x-auto bg-white rounded-lg shadow border border-gray-200" aria-busy={loading}>
    <table class="w-full min-w-[42rem] table-fixed border-collapse text-sm">
      <caption class="sr-only">
        {view === 'logs' ? 'Time logged' : 'Open tasks by due date'} for {monthLabel}
      </caption>
      <thead class="bg-gray-50">
        <tr>
          {#each WEEKDAY_LABELS as label}
            <th scope="col" class="p-2 text-left font-medium text-gray-600 border-b border-gray-200">{label}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each weeks as week}
          <tr>
            {#each week as day (day.key)}
              <td class="align-top h-28 p-1.5 border border-gray-100 {day.inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'} {day.isToday ? 'ring-2 ring-inset ring-blue-500' : ''}">
                <time datetime={day.key} class="block font-medium {day.isToday ? 'text-blue-700' : 'text-gray-700'}">{day.day}</time>

                {#if view === 'logs' && logsByDay[day.key]}
                  <p class="mt-1 text-xs font-semibold text-gray-900">{formatHours(logsByDay[day.key].hours)}</p>
                  <ul class="mt-1 space-y-0.5">
                    {#each logsByDay[day.key].entries.slice(0, MAX_ITEMS_PER_DAY) as item (item.id)}
                      <li>
                        <button
                          type="button"
                          class="block w-full truncate rounded text-left text-xs text-gray-600 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          title={item.comments || item.activity.name}
                          aria-label="Open log entry #{item.id}: {item.issue ? `task #${item.issue.id}` : item.project.name}, {formatHours(item.hours)}"
                          on:click={() => openLogEntry(server.id, item.id)}
                        >
                          {item.issue ? `#${item.issue.id}` : item.project.name} · {formatHours(item.hours)}
                        </button>
                      </li>
                    {/each}
                    {#if logsByDay[day.key].entries.length > MAX_ITEMS_PER_DAY}
                      <li class="text-xs text-gray-500">+{logsByDay[day.key].entries.length - MAX_ITEMS_PER_DAY} more</li>
                    {/if}
                  </ul>
                {/if}

                {#if view === 'tasks' && tasksByDay[day.key]}
                  <ul class="mt-1 space-y-0.5">
                    {#each tasksByDay[day.key].slice(0, MAX_ITEMS_PER_DAY) as task (task.id)}
                      <li>
                        <button
                          type="button"
                          class="block w-full truncate rounded text-left text-xs text-gray-700 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          title={task.subject}
                          aria-label="Open task #{task.id}: {task.subject}"
                          on:click={() => openTask(server.id, task.id)}
                        >
                          <span class="font-mono text-gray-500">#{task.id}</span> {task.subject}
                        </button>
                      </li>
                    {/each}
                    {#if tasksByDay[day.key].length > MAX_ITEMS_PER_DAY}
                      <li class="text-xs text-gray-500">+{tasksByDay[day.key].length - MAX_ITEMS_PER_DAY} more</li>
                    {/if}
                  </ul>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
