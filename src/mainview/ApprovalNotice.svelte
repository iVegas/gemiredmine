<script lang="ts">
  import { agentProposals, approveAgentProposal, rejectAgentProposal } from './lib/mcp-host';

  // The changes that AI agents proposed and that wait for the user. They are shown in every view of the main window, so
  // the user decides on them where they are working, and does not have to find them in Settings.
  $: waiting = $agentProposals.filter((proposal) => proposal.status === 'waiting');
</script>

{#if waiting.length > 0}
  <section aria-label="Changes waiting for your approval" class="border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-950">
    <h2 class="font-semibold">
      {waiting.length === 1 ? 'An AI agent proposed a change' : `${waiting.length} changes from AI agents wait for you`}
    </h2>
    <ul class="mt-2 space-y-2">
      {#each waiting as proposal (proposal.id)}
        <li class="flex flex-wrap items-center justify-between gap-2">
          <span>
            {proposal.summary}
            <span class="text-blue-800">· {proposal.serverName}</span>
          </span>
          <span class="flex gap-2">
            <button
              type="button"
              aria-label="Approve: {proposal.summary}"
              class="rounded border border-blue-300 bg-white px-3 py-1 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              on:click={() => approveAgentProposal(proposal.id)}
            >
              Approve
            </button>
            <button
              type="button"
              aria-label="Reject: {proposal.summary}"
              class="rounded border border-blue-300 bg-white px-3 py-1 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              on:click={() => rejectAgentProposal(proposal.id)}
            >
              Reject
            </button>
          </span>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-blue-800">Settings lists every change that agents proposed, and what came of it.</p>
  </section>
{/if}
