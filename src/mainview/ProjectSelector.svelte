<script lang="ts">
  // The project the views show. "All projects" is the default: every project the user takes part in on the server.
  // The list is the projects the user is a member of there. The choice is shared with every window (see windows.ts).
  import { get } from 'svelte/store';
  import type { RedmineReference } from '../bun/redmine/types';
  import { redmineApi } from './lib/api';
  import { activeProject, activeServer, projectSelection, selectProject } from './lib/store';

  let projects: RedmineReference[] = [];
  let loading = false;
  let error = '';
  // Responses for a server the user already switched away from are ignored.
  let latestRequest = 0;

  $: load($activeServer?.id, $activeServer?.url, $activeServer?.apiToken);

  async function load(serverId: string | undefined, baseUrl: string | undefined, apiKey: string | undefined) {
    const request = ++latestRequest;
    projects = [];
    error = '';
    if (!serverId || !baseUrl || !apiKey) {
      loading = false;
      return;
    }

    loading = true;
    try {
      const memberships = await redmineApi.listMyProjects({ baseUrl, apiKey });
      if (request !== latestRequest) return;
      projects = memberships;
      // A project that the user is no longer a member of is not kept: the views go back to every project.
      const chosen = get(projectSelection)[serverId];
      if (chosen && !memberships.some((project) => project.id === chosen.id)) selectProject(serverId, null);
    } catch (err) {
      if (request !== latestRequest) return;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (request === latestRequest) loading = false;
    }
  }

  // The project in use is listed even before the list has loaded, so that the selector shows what the views show.
  $: choices = withSelected(projects, $activeProject);

  function withSelected(list: RedmineReference[], selected: RedmineReference | null): RedmineReference[] {
    if (!selected || list.some((project) => project.id === selected.id)) return list;
    return [...list, selected].sort((a, b) => a.name.localeCompare(b.name));
  }

  function handleChange(event: Event) {
    const serverId = $activeServer?.id;
    if (!serverId) return;
    const value = (event.currentTarget as HTMLSelectElement).value;
    selectProject(serverId, choices.find((project) => String(project.id) === value) ?? null);
  }
</script>

{#if $activeServer?.apiToken}
  <div class="flex min-w-0 items-center gap-2">
    <span aria-hidden="true" class="hidden text-sm text-gray-600 md:inline">Project</span>
    <select
      aria-label="Project"
      aria-busy={loading}
      class="min-w-0 max-w-[9rem] truncate rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 md:max-w-[14rem]"
      value={$activeProject ? String($activeProject.id) : ''}
      on:change={handleChange}
    >
      <option value="">All projects</option>
      {#each choices as project (project.id)}
        <option value={String(project.id)}>{project.name}</option>
      {/each}
    </select>
    {#if error}
      <span role="status" class="text-xs text-red-700" title={error}>Projects unavailable</span>
    {/if}
  </div>
{/if}
