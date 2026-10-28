// The conversations the user has with the assistant. There can be several at once — one about the task in front of
// them, one about last week's time — the way a web app keeps several chat windows. They last while the app runs; they
// are not saved. Each one carries what is needed to show it anywhere: its messages, whether an answer is being worked
// on, the last problem, what the user was typing, and the answers they have not read.

import { get, writable } from 'svelte/store';
import type { ChatMessage } from '../../bun/assistant/providers';

export interface Chat {
  id: string;
  /** What the chat is called in its title bar and in the list of chats. */
  title: string;
  messages: ChatMessage[];
  /** True while an answer is being worked on, so a second question waits its turn. */
  asking: boolean;
  /** The last problem, in a sentence for the user, or null. */
  error: string | null;
  /** What the user has typed and not sent. It is kept here, so closing a panel does not lose it. */
  draft: string;
  /** Answers that arrived while the user was not looking at this chat. */
  unread: number;
}

/** What a chat is called before its first question names it. */
export const NEW_CHAT_TITLE = 'New chat';

/** How long a title may be before it is shortened: a title bar is narrow. */
const TITLE_LENGTH = 28;

export const chats = writable<Chat[]>([]);

let lastId = 0;

/** The name a chat takes from its first question, short enough for a title bar. */
export function titleFrom(question: string): string {
  const text = question.trim().replace(/\s+/g, ' ');
  if (!text) return NEW_CHAT_TITLE;
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH).trimEnd()}…` : text;
}

export interface NewChat {
  /** What to call it, for a chat that is about something known, such as a task. */
  title?: string;
  /** A question to start from, which the user can finish or change before sending. */
  draft?: string;
}

/** Starts a chat and gives its id. Nothing is asked yet. */
export function startChat(options: NewChat = {}): string {
  const id = `chat-${++lastId}`;
  chats.update((all) => [
    ...all,
    {
      id,
      title: options.title ?? NEW_CHAT_TITLE,
      messages: [],
      asking: false,
      error: null,
      draft: options.draft ?? '',
      unread: 0,
    },
  ]);
  return id;
}

export const chatOf = (all: Chat[], id: string): Chat | undefined => all.find((chat) => chat.id === id);

/** The chat with this id, or undefined when it is gone. */
export const chatById = (id: string): Chat | undefined => chatOf(get(chats), id);

/** Changes one chat. A chat that is gone is left alone, so a late answer cannot bring it back. */
export function updateChat(id: string, changes: Partial<Chat> | ((chat: Chat) => Partial<Chat>)) {
  chats.update((all) =>
    all.map((chat) => (chat.id === id ? { ...chat, ...(typeof changes === 'function' ? changes(chat) : changes) } : chat))
  );
}

/** Forgets a chat and everything that was said in it. */
export function removeChat(id: string) {
  chats.update((all) => all.filter((chat) => chat.id !== id));
}

/** The user is looking at this chat, so its answers are no longer waiting to be read. */
export function markRead(id: string) {
  if (chatById(id)?.unread) updateChat(id, { unread: 0 });
}

/** Empties a chat, which keeps its place and its name. */
export function clearChat(id: string) {
  updateChat(id, { messages: [], error: null, unread: 0 });
}

/** The chat that was started last, which is the one the app opens when the user asks for the assistant. */
export const newestChat = (all: Chat[]): Chat | undefined => all[all.length - 1];

/** Back to no chats at all, for a test or a fresh window. */
export function resetChats() {
  chats.set([]);
  lastId = 0;
}
