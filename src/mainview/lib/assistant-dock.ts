// The assistant as a companion of the whole app: a button in the corner of every view, and a chat panel that floats
// over the view the user is working in, the way a chat window does. The conversation itself is the one in assistant.ts,
// so the panel and the Assistant tab are two windows onto the same conversation.

import { get, writable } from 'svelte/store';
import type { ChatMessage } from '../../bun/assistant/providers';
import { conversation } from './assistant';
import { activeView, type ViewId } from './views';

/**
 * Where the floating assistant belongs. Not over its own settings, which is where it is set up and where the panel
 * would cover the form, and not over the Assistant tab, which is the same conversation at full size.
 */
export const dockFits = (view: ViewId): boolean => view !== 'settings' && view !== 'assistant';

/** Where the floating assistant is: out of the way, open over the view, or rolled up into its own title bar. */
export type DockState = 'closed' | 'open' | 'minimized';

export const dockState = writable<DockState>('closed');

/** Answers that arrived while the user was not looking at them, for the badge on the button. */
export const unreadReplies = writable(0);

/** Whether the conversation is in front of the user: in the open panel, or in the Assistant tab. */
const showing = () => get(dockState) === 'open' || get(activeView) === 'assistant';

export function openDock() {
  dockState.set('open');
  unreadReplies.set(0);
}

/** Rolls the panel up into its title bar. What was typed and the conversation stay as they are. */
export function minimizeDock() {
  dockState.set('minimized');
}

export function closeDock() {
  dockState.set('closed');
}

/** The button and the title bar both do this: open the panel, or roll it up when it is already open. */
export function toggleDock() {
  if (get(dockState) === 'open') minimizeDock();
  else openDock();
}

/** How many answers the conversation holds, which is what the badge counts up from. */
const replyCount = (messages: ChatMessage[]) => messages.filter((message) => message.role === 'assistant').length;

let seen = replyCount(get(conversation));

conversation.subscribe((messages) => {
  const replies = replyCount(messages);
  // A conversation that was cleared starts the count again, rather than counting its answers as new ones.
  if (replies < seen) unreadReplies.set(0);
  else if (replies > seen && !showing()) unreadReplies.update((count) => count + (replies - seen));
  seen = replies;
});

// Reading the conversation in its tab is reading it: the badge goes away there too.
activeView.subscribe((view) => {
  if (view === 'assistant') unreadReplies.set(0);
});

/** Back to the start, for a test or a fresh window. */
export function resetDock() {
  dockState.set('closed');
  unreadReplies.set(0);
  seen = replyCount(get(conversation));
}
