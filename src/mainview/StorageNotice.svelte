<script lang="ts">
  import { storageProblem } from './lib/persistence';
</script>

{#if $storageProblem}
  <p role="alert" class="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{$storageProblem}</p>
{/if}
