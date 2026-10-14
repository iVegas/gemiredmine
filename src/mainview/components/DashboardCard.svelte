<script lang="ts">
  /** Prefix for the element ids inside the card; must be unique on the page. */
  export let id: string;
  export let title: string;
  /** Visible hint shown next to the title, such as "Open calendar". */
  export let actionLabel: string;
  /** Text read out with the card's button, so the preview itself can stay visual. */
  export let summary: string;
  export let onOpen: () => void;
</script>

<article
  aria-labelledby="{id}-title"
  class="relative flex min-w-0 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-within:ring-2 focus-within:ring-blue-500"
>
  <div class="flex items-baseline justify-between gap-2">
    <h3 id="{id}-title" class="text-lg font-semibold text-gray-900">
      <!-- The ::after layer covers the whole card, so a click anywhere on it opens the view. -->
      <button
        type="button"
        aria-describedby="{id}-summary"
        class="text-left after:absolute after:inset-0 after:z-10 after:rounded-lg focus:outline-none"
        on:click={onOpen}
      >
        {title}
      </button>
    </h3>
    <span aria-hidden="true" class="text-sm font-medium text-blue-700">{actionLabel} →</span>
  </div>

  <p id="{id}-summary" class="text-sm text-gray-600">{summary}</p>

  <slot />
</article>
