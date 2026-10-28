<script lang="ts">
  import { onDestroy } from 'svelte';
  import WelcomeScreen from './WelcomeScreen.svelte';
  import ViewTabs from './ViewTabs.svelte';
  import PrimaryNav from './PrimaryNav.svelte';
  import AssistantDock from './components/AssistantDock.svelte';
  import UserMenu from './UserMenu.svelte';
  import ServerLogin from './ServerLogin.svelte';
  import DashboardView from './DashboardView.svelte';
  import CalendarView from './CalendarView.svelte';
  import TodoView from './TodoView.svelte';
  import AssistantView from './AssistantView.svelte';
  import SettingsView from './SettingsView.svelte';
  import AboutView from './AboutView.svelte';
  import RecordPanel from './RecordPanel.svelte';
  import ApprovalNotice from './ApprovalNotice.svelte';
  import StorageNotice from './StorageNotice.svelte';
  import { credentialProblem, credentialsRestoring } from './lib/credentials';
  import { restoreAgentEndpoint } from './lib/mcp-host';
  import { serversRestored, startPersistence, storageProblem } from './lib/persistence';
  import { servers, activeServer } from './lib/store';
  import { activeView, closeView, isDetailView, needsServer, openView, openViews, viewPanelId, viewTabId } from './lib/views';
  import { dockFits, openAssistant } from './lib/assistant-dock';
  import { attachToMainWindow, sessionReady, startMainWindow, startViewWindow, viewWindowFromLocation } from './lib/windows';
  import { buildInfo } from '../shared/build-info.generated';

  // A tab dragged out of the main window opens in a window of its own, which shows only that view.
  const windowView = viewWindowFromLocation();
  onDestroy(windowView ? startViewWindow(windowView) : startMainWindow());
  // The servers of an earlier run are loaded by the main window only; a view window gets them from it.
  onDestroy(windowView ? () => {} : startPersistence());
  // The endpoint for AI agents runs from the main window, and only when the user turned it on in the settings.
  if (!windowView) void restoreAgentEndpoint();

  /**
   * Control+Shift+A brings the assistant up from wherever the user is: the floating chat over the view they are in, or
   * the Assistant tab on the two screens the chat windows stay out of.
   */
  function handleShortcut(event: KeyboardEvent) {
    if (windowView || event.key.toLowerCase() !== 'a' || !event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (dockFits($activeView)) openAssistant();
    else openView('assistant');
  }
</script>

<svelte:window on:keydown={handleShortcut} />

{#if (windowView && !$sessionReady) || (!windowView && !$serversRestored)}
  <p role="status" class="p-6 text-gray-600">Loading…</p>
{:else if !windowView && $servers.length === 0}
  <WelcomeScreen />
{:else}
  <div class="flex h-screen w-full flex-col bg-gray-50 font-sans">
    <!-- A view window can be dragged by the empty part of its header too, back onto the main window's tabs. -->
    <header class="border-b border-gray-200 bg-white" data-tauri-drag-region={windowView ? '' : undefined}>
      <h1 class="sr-only">{buildInfo.productName}</h1>
      <!-- The main window keeps the app's views in a row of their own, above the tabs, where they are always in reach. -->
      <div class="flex items-center gap-4 px-4 pt-2 {windowView ? 'justify-end' : 'justify-between'}">
        {#if windowView}
          <!-- A view window shows one view, so it has nothing to navigate to. -->
          <button
            type="button"
            title="Puts this view back in the main window's tabs. You can also drag this window onto them."
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            on:click={attachToMainWindow}
          >
            Move to main window
          </button>
        {:else}
          <PrimaryNav />
          <UserMenu />
        {/if}
      </div>
      <div class="flex items-end px-4 pt-1" data-tauri-drag-region={windowView ? '' : undefined}>
        <ViewTabs movable={!windowView} />
      </div>
    </header>

    <!-- Whatever goes wrong with keeping the servers or the sign-ins is told on every tab, where the user is working. -->
    {#if !windowView && ($storageProblem || $credentialProblem)}
      <div class="space-y-2 border-b border-gray-200 bg-white px-4 py-2"><StorageNotice /></div>
    {/if}

    <!-- A change an agent proposed waits for the user on every tab, so approving it does not need a trip to Settings. -->
    {#if !windowView}
      <ApprovalNotice />
    {/if}

    <!-- The assistant floats over the view the user is in, except where it would be in the way of its own setup. -->
    {#if !windowView && dockFits($activeView)}
      <AssistantDock />
    {/if}

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
          {#if isDetailView(view)}
            <!-- A task or a log entry belongs to the server it was opened on, not to the server in use. -->
            <RecordPanel {view} active={view === $activeView} />
          {:else if needsServer(view) && !$activeServer}
            <p class="text-gray-600">Choose a server from the user menu to see its data.</p>
          {:else if needsServer(view) && !$activeServer?.apiToken}
            <!-- One sign-in form at a time, in whichever server view is showing. -->
            {#if view === $activeView && $activeServer}
              {#if $credentialsRestoring}
                <!-- The saved sign-ins are being read, so the form would only flash up. -->
                <p role="status" class="text-gray-600">Reading your saved sign-ins…</p>
              {:else}
                <!-- Another server gets a fresh form, so one server's user name is not offered to the next. -->
                {#key $activeServer.id}
                  <ServerLogin server={$activeServer} />
                {/key}
              {/if}
            {/if}
          {:else if view === 'dashboard' && $activeServer}
            <DashboardView server={$activeServer} />
          {:else if view === 'calendar' && $activeServer}
            <CalendarView server={$activeServer} />
          {:else if view === 'todo' && $activeServer}
            <TodoView server={$activeServer} />
          {:else if view === 'assistant'}
            <AssistantView />
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
