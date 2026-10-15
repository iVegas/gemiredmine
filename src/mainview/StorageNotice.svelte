<script lang="ts">
  import { credentialProblem } from './lib/credentials';
  import { storageProblem } from './lib/persistence';
</script>

<!-- Two things can go wrong, the database and the credential store, and each has its own message. -->
{#each [$storageProblem, $credentialProblem] as problem}
  {#if problem}
    <p role="alert" class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{problem}</p>
  {/if}
{/each}
