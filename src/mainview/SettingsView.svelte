<script lang="ts">
  import { onMount } from 'svelte';
  import AddServerForm from './AddServerForm.svelte';
  import AssistantSettings from './components/AssistantSettings.svelte';
  import { redmineApi } from './lib/api';
  import { servers, activeServerId, removeServer, remembersSignIn, updateServer, type ServerConnection } from './lib/store';
  import { openView } from './lib/views';
  import type { CredentialOptions } from '../shared/backend';
  import { AGENT_MAX_PORT, AGENT_MIN_PORT, isAgentPort, type AgentSettings } from '../shared/agents';
  import {
    agentProposals,
    agentToken as loadAgentToken,
    agentsAvailable,
    approveAgentProposal,
    rejectAgentProposal,
    resetAgentToken,
    startAgentEndpoint,
    stopAgentEndpoint,
  } from './lib/mcp-host';

  let adding = false;

  /** The fingerprint or face unlock of the saved sign-ins. Null where the device has none, so the section is not shown. */
  let biometric: CredentialOptions['biometric'] = null;
  let biometricError = '';
  let biometricBusy = false;

  /** The endpoint for AI agents. Null where the app cannot run one, so the section is not shown. */
  let agents: AgentSettings | null = null;
  // The switch and the port field show what the user last chose; they go back when a change is refused.
  let agentsOn = false;
  let portText = '';
  let agentsBusy = false;
  let agentsError = '';
  let agentToken = '';
  let showAgentToken = false;
  let confirmingReset = false;

  const proposalStatus: Record<string, string> = {
    waiting: 'Waiting for you',
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    rejected: 'Rejected',
  };

  // The old token stops working at once, so the user is asked first.
  async function replaceAgentToken() {
    agentsBusy = true;
    agentsError = '';
    try {
      agentToken = await resetAgentToken();
      showAgentToken = false;
      confirmingReset = false;
    } catch (error) {
      agentsError = `The token could not be replaced: ${messageOf(error)}`;
    } finally {
      agentsBusy = false;
    }
  }

  onMount(async () => {
    try {
      biometric = (await redmineApi.getCredentialOptions()).biometric;
    } catch {
      // Outside the desktop app there are no saved sign-ins to unlock.
      biometric = null;
    }
    if (agentsAvailable()) {
      try {
        const saved = await redmineApi.getAgentSettings();
        agents = saved;
        agentsOn = saved.enabled;
        portText = String(saved.port);
        if (saved.enabled) {
          // The endpoint is started again when it is shown: it may have failed at launch, and this says why.
          await startAgentEndpoint(saved.port);
          agentToken = await loadAgentToken();
        }
      } catch (error) {
        agentsError = agentsFailure(error, agents?.enabled ?? false);
      }
    }
  });

  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

  function agentsFailure(error: unknown, enabled: boolean) {
    return `The agent endpoint could not be ${enabled ? 'started' : 'stopped'}: ${messageOf(error)}`;
  }

  // Starts or stops the endpoint, and keeps the choice only once the endpoint has done what it says.
  async function setAgentsEnabled(enabled: boolean) {
    const current = agents;
    if (!current) return;
    agentsOn = enabled;
    agentsBusy = true;
    agentsError = '';
    try {
      if (enabled) {
        await startAgentEndpoint(current.port);
        try {
          await redmineApi.saveAgentSettings({ enabled: true, port: current.port });
        } catch (error) {
          await stopAgentEndpoint().catch(() => undefined);
          throw error;
        }
        agentToken = await loadAgentToken();
      } else {
        await stopAgentEndpoint();
        await redmineApi.saveAgentSettings({ enabled: false, port: current.port });
      }
      agents = { ...current, enabled };
    } catch (error) {
      agentsOn = current.enabled;
      agentsError = agentsFailure(error, enabled);
    } finally {
      agentsBusy = false;
    }
  }

  // Moves a running endpoint to another port. A port that is taken leaves the endpoint where it was.
  async function changeAgentPort() {
    const current = agents;
    if (!current) return;
    const port = Number(portText);
    if (!isAgentPort(port)) {
      portText = String(current.port);
      agentsError = `The port must be a whole number from ${AGENT_MIN_PORT} to ${AGENT_MAX_PORT}.`;
      return;
    }
    if (port === current.port) return;
    agentsBusy = true;
    agentsError = '';
    try {
      if (current.enabled) await startAgentEndpoint(port);
      try {
        await redmineApi.saveAgentSettings({ enabled: current.enabled, port });
      } catch (error) {
        if (current.enabled) await startAgentEndpoint(current.port).catch(() => undefined);
        throw error;
      }
      agents = { ...current, port };
      if (current.enabled) agentToken = await loadAgentToken();
    } catch (error) {
      portText = String(current.port);
      agentsError = `The port could not be changed: ${messageOf(error)}`;
    } finally {
      agentsBusy = false;
    }
  }

  async function copyAgentToken() {
    await navigator.clipboard?.writeText(agentToken).catch(() => undefined);
  }

  // The switch shows the new setting at once and goes back to the old one if the change is refused.
  async function setBiometric(enabled: boolean) {
    const current = biometric;
    if (!current) return;
    biometric = { ...current, enabled };
    biometricBusy = true;
    biometricError = '';
    try {
      await redmineApi.setBiometricUnlock(enabled);
    } catch (error) {
      biometric = { ...current, enabled: current.enabled };
      biometricError = `The change was not saved: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      biometricBusy = false;
    }
  }

  function signIn(server: ServerConnection) {
    // The dashboard asks a signed-out server to sign in.
    activeServerId.set(server.id);
    openView('dashboard');
  }

  function signOut(server: ServerConnection) {
    updateServer(server.id, { apiToken: undefined, user: undefined, signInNotice: undefined });
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <h2 class="text-2xl font-bold text-gray-900">Settings</h2>

  <section aria-labelledby="settings-servers-heading" class="rounded-lg border border-gray-200 bg-white shadow">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
      <div>
        <h3 id="settings-servers-heading" class="text-lg font-semibold text-gray-900">Servers</h3>
        <p class="text-sm text-gray-500">Add, switch between and remove your Redmine servers. The servers are kept for the next start. Passwords are never kept; with Remember me, the API key is kept in the system's credential store.</p>
      </div>
      {#if !adding}
        <button
          type="button"
          class="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          on:click={() => (adding = true)}
        >
          + Add Server
        </button>
      {/if}
    </div>

    {#if adding}
      <div class="border-b border-gray-200 bg-gray-50 px-4 pb-6">
        <AddServerForm onCancel={() => (adding = false)} onSuccess={() => (adding = false)} />
      </div>
    {/if}

    <ul>
      {#each $servers as server (server.id)}
        {@const active = $activeServerId === server.id}
        <li class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4 last:border-b-0 {active ? 'bg-blue-50' : ''}">
          <div class="min-w-0">
            <p class="font-medium text-gray-900">
              {server.name}
              {#if active}
                <span class="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">Active</span>
              {/if}
            </p>
            <p class="truncate text-sm text-gray-500">{server.url}</p>
            {#if server.apiToken}
              <p class="text-xs text-green-700 mt-1">Signed in as {server.user?.login ?? 'user'}</p>
            {:else}
              <p class="text-xs text-amber-700 mt-1">Not signed in</p>
            {/if}
            <label class="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                aria-label="Remember me on this computer for {server.name}"
                checked={remembersSignIn(server)}
                class="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                on:change={(event) => updateServer(server.id, { remember: event.currentTarget.checked })}
              >
              Remember me on this computer
            </label>
          </div>

          <div class="flex flex-wrap gap-2">
            {#if !active}
              <button
                type="button"
                aria-label="Switch to {server.name}"
                class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                on:click={() => activeServerId.set(server.id)}
              >
                Switch to
              </button>
            {/if}
            {#if server.apiToken}
              <button
                type="button"
                aria-label="Sign out of {server.name}"
                class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                on:click={() => signOut(server)}
              >
                Sign out
              </button>
            {:else}
              <button
                type="button"
                aria-label="Sign in to {server.name}"
                class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                on:click={() => signIn(server)}
              >
                Sign in
              </button>
            {/if}
            <button
              type="button"
              aria-label="Remove {server.name}"
              class="py-1.5 px-3 border border-gray-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              on:click={() => removeServer(server.id)}
            >
              Remove
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  {#if biometric}
    <section aria-labelledby="settings-security-heading" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <h3 id="settings-security-heading" class="text-lg font-semibold text-gray-900">Security</h3>
      <p class="mt-1 text-sm text-gray-500">Saved sign-ins are kept encrypted on this device. Whether the app asks for a fingerprint or face before it uses them is up to you.</p>

      <label class="mt-4 flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={biometric.enabled}
          disabled={!biometric.available || biometricBusy}
          class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
          on:change={(event) => setBiometric(event.currentTarget.checked)}
        >
        <span>
          <span class="font-medium">Unlock saved sign-ins with a fingerprint or face</span>
          <span class="block text-gray-500">When on, the app asks for it once when it starts, before it signs in with a saved key. When off, saved sign-ins open without asking.</span>
        </span>
      </label>

      {#if !biometric.available}
        <p class="mt-2 text-sm text-amber-700">Set up a fingerprint or face in the system settings to use this.</p>
      {/if}
      {#if biometricError}
        <p role="alert" class="mt-2 text-sm text-red-700">{biometricError}</p>
      {/if}
    </section>
  {/if}

  {#if agents}
    <section aria-labelledby="settings-agents-heading" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
      <h3 id="settings-agents-heading" class="text-lg font-semibold text-gray-900">AI agents</h3>
      <p class="mt-1 text-sm text-gray-500">
        Lets an AI agent on this computer read your tasks and logged time from the servers above, through the Model Context Protocol. Only a program that
        has the token below can connect, and your API keys are never sent to it. Nothing the agent does changes Redmine.
      </p>

      <label class="mt-4 flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={agentsOn}
          disabled={agentsBusy}
          class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
          on:change={(event) => setAgentsEnabled(event.currentTarget.checked)}
        >
        <span class="font-medium">Let AI agents connect on this computer</span>
      </label>

      <div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <label for="settings-agents-port">Port on 127.0.0.1</label>
        <input
          id="settings-agents-port"
          type="number"
          inputmode="numeric"
          min={AGENT_MIN_PORT}
          max={AGENT_MAX_PORT}
          bind:value={portText}
          disabled={agentsBusy}
          on:change={changeAgentPort}
          class="w-28 rounded border border-gray-300 px-2 py-1 disabled:opacity-60"
        >
      </div>

      {#if agents.enabled}
        <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt class="text-gray-500">Endpoint</dt>
          <dd><code class="break-all">http://127.0.0.1:{agents.port}/mcp</code></dd>
          <dt class="text-gray-500">Token</dt>
          <dd class="flex flex-wrap items-center gap-2">
            <code class="break-all">{showAgentToken ? agentToken : '•'.repeat(16)}</code>
            <button
              type="button"
              class="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-pressed={showAgentToken}
              on:click={() => (showAgentToken = !showAgentToken)}
            >
              {showAgentToken ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              class="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              on:click={copyAgentToken}
            >
              Copy token
            </button>
            {#if confirmingReset}
              <span class="flex w-full flex-wrap items-center gap-2 text-xs text-amber-800">
                Agents that use the current token will be disconnected. Replace it?
                <button
                  type="button"
                  disabled={agentsBusy}
                  class="rounded border border-red-300 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  on:click={replaceAgentToken}
                >
                  Replace token
                </button>
                <button
                  type="button"
                  class="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  on:click={() => (confirmingReset = false)}
                >
                  Keep it
                </button>
              </span>
            {:else}
              <button
                type="button"
                class="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                on:click={() => (confirmingReset = true)}
              >
                Replace token
              </button>
            {/if}
          </dd>
        </dl>
        <p class="mt-3 text-xs text-gray-500">
          To connect Claude Code, run:
          <code class="block break-all rounded bg-gray-50 p-2 text-gray-800">claude mcp add --transport http gemiredmine http://127.0.0.1:{agents.port}/mcp --header "Authorization: Bearer {showAgentToken ? agentToken : '<token>'}"</code>
        </p>
      {/if}

      {#if $agentProposals.length > 0}
        <div class="mt-5 border-t border-gray-100 pt-4">
          <h4 class="text-sm font-semibold text-gray-900">Changes that agents proposed</h4>
          <p class="mt-1 text-xs text-gray-500">Nothing is saved in Redmine until you approve a change here. Approving runs it with your own API key.</p>
          <ul class="mt-2 divide-y divide-gray-100">
            {#each $agentProposals as proposal (proposal.id)}
              <li class="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                <div class="min-w-0">
                  <p class="text-gray-900">{proposal.summary}</p>
                  <p class="text-xs text-gray-500">
                    {proposal.serverName} · {proposalStatus[proposal.status] ?? proposal.status}{proposal.outcome ? ` · ${proposal.outcome}` : ''}
                  </p>
                </div>
                {#if proposal.status === 'waiting'}
                  <div class="flex shrink-0 gap-2">
                    <button
                      type="button"
                      aria-label="Approve: {proposal.summary}"
                      class="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      on:click={() => approveAgentProposal(proposal.id)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      aria-label="Reject: {proposal.summary}"
                      class="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      on:click={() => rejectAgentProposal(proposal.id)}
                    >
                      Reject
                    </button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if agentsError}
        <p role="alert" class="mt-3 text-sm text-red-700">{agentsError}</p>
      {/if}
    </section>
  {/if}

  <section aria-labelledby="settings-assistant-heading" class="rounded-lg border border-gray-200 bg-white p-4 shadow">
    <h3 id="settings-assistant-heading" class="text-lg font-semibold text-gray-900">AI assistant</h3>
    <div class="mt-3">
      <AssistantSettings />
    </div>
  </section>
</div>
