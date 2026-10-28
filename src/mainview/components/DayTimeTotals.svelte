<script lang="ts">
  import type { ServerConnection } from '../lib/store';
  import type { RedmineReference, RedmineTimeEntry } from '../../bun/redmine/types';
  import { redmineApi } from '../lib/api';
  import { redmineChanges } from '../lib/data-changes';
  import { formatHours, sumHours } from '../lib/calendar';
  import { formatDueDate } from '../lib/todo';

  // What the user has already logged on the day a form is set to: across all projects, and in the project the time is
  // logged to. A project with no time logged on the day is not mentioned. Used by the forms that log or change time.

  export let server: ServerConnection;
  /** YYYY-MM-DD, the day the form is set to */
  export let day: string;
  /** The project the time goes to: the project of the task, or of the log entry that is being changed. */
  export let project: RedmineReference;
  /** A log entry that is being changed. It is left out, so that the figures are what the day had before the change. */
  export let excludeEntryId: number | null = null;

  let entries: RedmineTimeEntry[] = [];
  let loading = false;
  let error = '';
  // Responses for a day the form has moved on from are ignored.
  let latestRequest = 0;

  // Reloads after a write in this window, so that the time just logged is counted.
  $: void $redmineChanges, load(server.url, server.apiToken, day);

  async function load(baseUrl: string, apiKey: string | undefined, dayKey: string) {
    if (!apiKey || !dayKey) return;

    const request = ++latestRequest;
    loading = true;
    error = '';
    try {
      const logged = await redmineApi.listTimeEntries({ baseUrl, apiKey }, { from: dayKey, to: dayKey });
      if (request !== latestRequest) return;
      entries = logged;
    } catch (err) {
      if (request !== latestRequest) return;
      entries = [];
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (request === latestRequest) loading = false;
    }
  }

  $: others = entries.filter((entry) => entry.id !== excludeEntryId);
  $: total = sumHours(others);
  $: inProject = sumHours(others.filter((entry) => entry.project.id === project.id));
  $: dayLabel = day ? formatDueDate(day) : '';
</script>

{#if day}
  <div aria-live="polite" class="space-y-0.5 text-sm text-gray-700">
    {#if error}
      <p role="alert" class="text-red-700">Could not check the time already logged on {dayLabel}: {error}</p>
    {:else if loading}
      <p class="text-gray-500">Checking the time already logged on {dayLabel}…</p>
    {:else}
      <p>
        Already logged on {dayLabel}:
        {#if total > 0}
          {formatHours(total)} across all projects{excludeEntryId === null ? '' : ', not counting this entry'}.
        {:else}
          nothing{excludeEntryId === null ? '' : ' else'} yet.
        {/if}
      </p>
      {#if inProject > 0}
        <p>{formatHours(inProject)} of it in {project.name}.</p>
      {/if}
    {/if}
  </div>
{/if}
