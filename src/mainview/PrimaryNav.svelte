<script lang="ts">
  // The app's own navigation: every view the app is for, in one row that is always there. A view opens in a tab, and
  // the row says which one is showing. Nothing here is behind a menu.
  import { activeView, openView, PRIMARY_VIEWS, VIEW_TITLES, type StaticViewId } from './lib/views';

  /** One path per view, drawn in a 20×20 box. */
  const ICONS: Record<StaticViewId, string> = {
    dashboard: 'M3 3h6v6H3V3zm8 0h6v6h-6V3zM3 11h6v6H3v-6zm8 0h6v6h-6v-6z',
    calendar:
      'M6 2v2H4.5A1.5 1.5 0 0 0 3 5.5v11A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 15.5 4H14V2h-2v2H8V2H6zm9.5 6v8.5h-11V8h11z',
    todo: 'M3 5h2v2H3V5zm4 0h10v2H7V5zM3 9h2v2H3V9zm4 0h10v2H7V9zm-4 4h2v2H3v-2zm4 0h10v2H7v-2z',
    assistant:
      'M10 3c-4 0-7.2 2.4-7.2 5.5 0 1.8 1.1 3.4 2.8 4.4-.2 1-.7 2-1.5 2.9 1.8-.3 3.2-1 4.1-1.7.6.1 1.2.2 1.8.2 4 0 7.2-2.4 7.2-5.8S14 3 10 3z',
    settings: 'M3 5h7V3h2v2h5v2h-5v2h-2V7H3V5zm0 6h5V9h2v2h7v2H10v2H8v-2H3v-2z',
    about: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 4h2v2H9V6zm0 3h2v5H9V9z',
  };
</script>

<nav aria-label="Views of the app" class="min-w-0">
  <ul class="flex items-center gap-1 overflow-x-auto">
    {#each PRIMARY_VIEWS as view (view)}
      {@const current = $activeView === view}
      <li>
        <button
          type="button"
          aria-current={current ? 'page' : undefined}
          class="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 {current
            ? 'bg-blue-50 text-blue-800'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}"
          on:click={() => openView(view)}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" class="h-4 w-4 fill-current"><path d={ICONS[view]} /></svg>
          {VIEW_TITLES[view]}
        </button>
      </li>
    {/each}
  </ul>
</nav>
