<script lang="ts">
  import ServerContextSelector from './ServerContextSelector.svelte';
  import { activeServer } from './lib/store';
  import { isHttpUrl } from './lib/url';
  import { openView, type ViewId } from './lib/views';
  import { buildInfo } from '../shared/build-info.generated';

  let open = false;
  let root: HTMLElement;
  let trigger: HTMLButtonElement;

  function close({ restoreFocus = false } = {}) {
    open = false;
    if (restoreFocus) trigger?.focus();
  }

  function show(view: ViewId) {
    openView(view);
    close();
  }

  function handleWindowClick(event: MouseEvent) {
    if (open && !root.contains(event.target as Node)) close();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') close({ restoreFocus: true });
  }

  $: user = $activeServer?.user;
  $: signedIn = Boolean($activeServer?.apiToken);
  $: displayName = signedIn && user ? `${user.firstname} ${user.lastname}`.trim() || user.login : 'Not signed in';
  $: initials = signedIn && user
    ? `${user.firstname.charAt(0)}${user.lastname.charAt(0)}`.toUpperCase() || user.login.charAt(0).toUpperCase()
    : '?';
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

<div class="relative shrink-0" bind:this={root}>
  <button
    type="button"
    bind:this={trigger}
    aria-expanded={open}
    aria-controls="user-menu-panel"
    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    on:click={() => (open = !open)}
  >
    <span aria-hidden="true" class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold {signedIn ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}">{initials}</span>
    <span class="sr-only min-w-0 flex-col sm:not-sr-only sm:flex">
      <span class="max-w-[12rem] truncate text-sm font-medium text-gray-900">{displayName}</span>
      <span class="sr-only">on</span>
      <span class="max-w-[12rem] truncate text-xs text-gray-500">{$activeServer?.name ?? 'No server selected'}</span>
    </span>
    <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current text-gray-500 transition-transform {open ? 'rotate-180' : ''}">
      <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z" />
    </svg>
  </button>

  {#if open}
    <div
      id="user-menu-panel"
      role="region"
      aria-label="Account and servers"
      class="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-lg space-y-4"
    >
      {#if $activeServer}
        <section aria-labelledby="user-menu-server-heading" class="space-y-1">
          <h2 id="user-menu-server-heading" class="text-xs font-semibold uppercase tracking-wide text-gray-500">Current server</h2>
          <p class="truncate text-base font-semibold text-gray-900">{$activeServer.name}</p>
          {#if isHttpUrl($activeServer.url)}
            <a href={$activeServer.url} target="_blank" rel="noopener noreferrer" class="block break-all text-sm text-blue-700 hover:underline">{$activeServer.url}</a>
          {:else}
            <span class="block break-all text-sm text-gray-600">{$activeServer.url}</span>
          {/if}
          {#if signedIn}
            <p class="text-sm text-green-700">Signed in as {user?.login ?? 'user'}</p>
          {:else}
            <p class="text-sm text-amber-700">Not signed in</p>
          {/if}
        </section>
      {/if}

      <ServerContextSelector />

      <div class="flex flex-col gap-1 border-t border-gray-200 pt-3">
        <button
          type="button"
          class="rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          on:click={() => show('settings')}
        >
          Manage servers…
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          on:click={() => show('about')}
        >
          About
        </button>
      </div>

      <p class="text-center text-xs text-gray-500">
        {buildInfo.productName} {buildInfo.version}
      </p>
    </div>
  {/if}
</div>
