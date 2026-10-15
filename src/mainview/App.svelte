<script lang="ts">
  import { onDestroy } from 'svelte';
  import WelcomeScreen from './WelcomeScreen.svelte';
  import ViewTabs from './ViewTabs.svelte';
  import UserMenu from './UserMenu.svelte';
  import ServerLogin from './ServerLogin.svelte';
  import DashboardView from './DashboardView.svelte';
  import CalendarView from './CalendarView.svelte';
  import TodoView from './TodoView.svelte';
  import SettingsView from './SettingsView.svelte';
  import AboutView from './AboutView.svelte';
  import { servers, activeServer } from './lib/store';
  import { activeView, closeView, needsServer, openViews, viewPanelId, viewTabId } from './lib/views';
  import { attachToMainWindow, sessionReady, startMainWindow, startViewWindow, viewWindowFromLocation } from './lib/windows';
  import { buildInfo } from '../shared/build-info.generated';

  // A tab dragged out of the main window opens in a window of its own, which shows only that view.
  const windowView = viewWindowFromLocation();
  onDestroy(windowView ? startViewWindow(windowView) : startMainWindow());
</script>

{#if windowView && !$sessionReady}
  <p role="status" class="p-6 text-gray-600">Loading…</p>
{:else if !windowView && $servers.length === 0}
  <WelcomeScreen />
{:else}
  <div class="flex h-screen w-full flex-col bg-gray-50 font-sans">
    <!-- A view window can be dragged by the empty part of its header too, back onto the main window's tabs. -->
    <header
      class="flex items-end justify-between gap-4 border-b border-gray-200 bg-white px-4 pt-2"
      data-tauri-drag-region={windowView ? '' : undefined}
    >
      <h1 class="sr-only">{buildInfo.productName}</h1>
      <ViewTabs movable={!windowView} />
      <div class="pb-1.5">
        {#if windowView}
          <button
            type="button"
            title="Puts this view back in the main window's tabs. You can also drag this window onto them."
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            on:click={attachToMainWindow}
          >
            Move to main window
          </button>
        {:else}
          <UserMenu />
        {/if}
      </div>
    </header>

    <main class="flex-1 overflow-auto">
      <!-- Open tabs stay mounted, so a view keeps its state (such as the calendar month) while hidden. -->
      {#each $openViews as view (view)}
        <div
          role="tabpanel"
          id={viewPanelId(view)}
          aria-labelledby={viewTabId(view)}
          hidden={view !== $activeView}
          class="p-6 md:p-8"
        >
          {#if needsServer(view) && !$activeServer}
            <p class="text-gray-600">Choose a server from the user menu to see its data.</p>
          {:else if needsServer(view) && !$activeServer?.apiToken}
            <!-- One sign-in form at a time, in whichever server view is showing. -->
            {#if view === $activeView && $activeServer}
              <ServerLogin server={$activeServer} />
            {/if}
          {:else if view === 'dashboard' && $activeServer}
            <DashboardView server={$activeServer} />
          {:else if view === 'calendar' && $activeServer}
            <CalendarView server={$activeServer} />
          {:else if view === 'todo' && $activeServer}
            <TodoView server={$activeServer} />
          {:else if view === 'settings'}
            <SettingsView />
          {:else if view === 'about'}
            <AboutView onClose={() => closeView('about')} />
          {/if}
        </div>
      {/each}
    </main>
  </div>
{/if}
