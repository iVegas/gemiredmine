<script lang="ts">
  import { credentialProblem } from './lib/credentials';
  import { storageProblem } from './lib/persistence';
</script>

<!-- Two things can go wrong, the database and the credential store, and each has its own message. -->
{#each [{ problem: $storageProblem, clear: () => storageProblem.set(null) }, { problem: $credentialProblem, clear: () => credentialProblem.set(null) }] as { problem, clear }}
  {#if problem}
    <div role="alert" class="flex items-start justify-between gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p>{problem}</p>
      <!-- A problem that stays, such as no credential store, can be put away. It comes back if it happens again. -->
      <button
        type="button"
        class="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        on:click={clear}
      >
        Dismiss
      </button>
    </div>
  {/if}
{/each}
