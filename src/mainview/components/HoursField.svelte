<script lang="ts">
  import { parseHours } from '../lib/calendar';

  /** Hours typed as "1.5", "1,5" or "1:30", with buttons for a quarter hour and for common amounts. */
  export let id: string;
  /** The text in the field. Read it with parseHours. */
  export let value = '';
  /** Whether the common amounts are offered as buttons. */
  export let quickAmounts = true;

  const QUARTER_HOUR = 0.25;
  const QUICK_HOURS: Array<[string, number]> = [
    ['15 min', 0.25],
    ['30 min', 0.5],
    ['1 h', 1],
    ['2 h', 2],
    ['4 h', 4],
    ['8 h', 8],
  ];

  /** Adds a quarter hour, or takes one away. Hours that are not valid yet count as nothing. */
  function addHours(delta: number) {
    const current = parseHours(value) ?? 0;
    value = String(Math.max(QUARTER_HOUR, Math.round((current + delta) * 10000) / 10000));
  }
</script>

<div class="flex flex-col gap-1 text-xs font-medium text-gray-700">
  <label for={id}>Hours</label>
  <div class="flex items-stretch gap-1">
    <button
      type="button"
      aria-label="Subtract 15 minutes"
      class="rounded border border-gray-300 bg-white px-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      on:click={() => addHours(-QUARTER_HOUR)}
    >
      −
    </button>
    <input
      {id}
      type="text"
      inputmode="decimal"
      autocomplete="off"
      required
      aria-describedby="{id}-help"
      placeholder="1.5 or 1:30"
      bind:value
      class="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-center text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
    <button
      type="button"
      aria-label="Add 15 minutes"
      class="rounded border border-gray-300 bg-white px-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      on:click={() => addHours(QUARTER_HOUR)}
    >
      +
    </button>
  </div>
  <span id="{id}-help" class="font-normal text-gray-500">
    Type 1.01, 1,01 or 1:01 (one hour and one minute). Any amount above zero, to the minute.
  </span>
  {#if quickAmounts}
    <div class="flex flex-wrap gap-1 pt-1" role="group" aria-label="Common amounts">
      {#each QUICK_HOURS as [label, hours] (label)}
        <button
          type="button"
          aria-label="Set the hours to {label}"
          class="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          on:click={() => (value = String(hours))}
        >
          {label}
        </button>
      {/each}
    </div>
  {/if}
</div>
