<script lang="ts">
  // The Assistant in a tab of its own: the whole screen for one conversation. The same conversation is in the floating
  // panel (components/AssistantDock.svelte), so moving between the two keeps what was said.
  import AssistantChat from './components/AssistantChat.svelte';
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4">
  <h2 class="text-2xl font-bold text-gray-900">Assistant</h2>
  <AssistantChat />
</div>
