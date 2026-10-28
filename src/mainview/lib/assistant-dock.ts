// The assistant as a companion of the whole app: a button in the corner of every view, and the chat windows that float
// over the view the user is working in. Each window shows one chat (chats.ts); several can be open at once, they can be
// dragged anywhere in the window and resized, and the Assistant tab shows the same chats at full size.

import { derived, get, writable } from 'svelte/store';
import { chats, markRead, newestChat, startChat, updateChat, type Chat, type NewChat } from './chats';
import { activeView, type ViewId } from './views';

/**
 * Where the floating assistant belongs. Not over its own settings, which is where it is set up and where a window
 * would cover the form, and not over the Assistant tab, which is the same chats at full size.
 */
export const dockFits = (view: ViewId): boolean => view !== 'settings' && view !== 'assistant';

/** A chat window: which chat it shows, whether it is rolled up, and where and how big it is. */
export interface Panel {
  chatId: string;
  /** Rolled up into its own title bar. What was typed and the conversation stay as they are. */
  minimized: boolean;
  /** Distance of the window's right edge from the app window's right edge, in pixels. */
  right: number;
  /** Distance of its bottom edge from the app window's bottom edge, in pixels. */
  bottom: number;
  width: number;
  height: number;
}

export const PANEL_WIDTH = 352;
export const PANEL_HEIGHT = 512;
export const PANEL_MIN_WIDTH = 280;
export const PANEL_MIN_HEIGHT = 240;
/** The gap between two windows side by side. */
export const PANEL_GAP = 8;
/**
 * How far from the right edge the first window sits: beside the round button in the corner, not on top of it, so the
 * button and "new chat" stay in reach while chats are open.
 */
export const PANEL_EDGE = 80;
/** How many chats are open side by side before the one opened longest ago is rolled up. */
export const MAX_OPEN_PANELS = 3;

export const panels = writable<Panel[]>([]);

export const panelOf = (list: Panel[], chatId: string): Panel | undefined => list.find((panel) => panel.chatId === chatId);

/** The answers nobody has read, in the chats that have no window of their own: what the button in the corner says. */
export const unreadOutside = derived([chats, panels], ([all, open]) =>
  all.filter((chat) => !panelOf(open, chat.id)).reduce((count, chat) => count + chat.unread, 0)
);

/** Whether the chat is in front of the user: in an open window, or in the Assistant tab. */
export function showing(chatId: string): boolean {
  if (get(activeView) === 'assistant') return true;
  const panel = panelOf(get(panels), chatId);
  return panel !== undefined && !panel.minimized;
}

/** Where the next window goes: beside the ones already there, along the bottom right corner. */
function placeFor(list: Panel[]): Pick<Panel, 'right' | 'bottom' | 'width' | 'height'> {
  const right = PANEL_EDGE + list.length * (PANEL_WIDTH + PANEL_GAP);
  return { right, bottom: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT };
}

/** Opens the window of a chat, or expands and raises the one it already has. Its answers count as read from now on. */
export function showChat(chatId: string) {
  markRead(chatId);
  panels.update((list) => {
    const known = panelOf(list, chatId);
    if (known) return list.map((panel) => (panel.chatId === chatId ? { ...panel, minimized: false } : panel));
    const open = list.filter((panel) => !panel.minimized);
    // Only so many chats fit side by side: the one that has been open longest rolls up to make room.
    const crowded = open.length >= MAX_OPEN_PANELS ? open[0].chatId : null;
    const made = list.map((panel) => (panel.chatId === crowded ? { ...panel, minimized: true } : panel));
    return [...made, { chatId, minimized: false, ...placeFor(list) }];
  });
}

export function minimizePanel(chatId: string) {
  panels.update((list) => list.map((panel) => (panel.chatId === chatId ? { ...panel, minimized: true } : panel)));
}

/** Closes the window. The chat itself stays, with everything said in it, and is listed in the Assistant tab. */
export function closePanel(chatId: string) {
  panels.update((list) => list.filter((panel) => panel.chatId !== chatId));
}

/** The title bar does this: roll the window up, or open it again. */
export function togglePanel(chatId: string) {
  const panel = panelOf(get(panels), chatId);
  if (panel && !panel.minimized) minimizePanel(chatId);
  else showChat(chatId);
}

/** A window cannot be dragged or resized out of reach: part of its title bar stays on the screen. */
const KEEP_VISIBLE = 48;

export interface Viewport {
  width: number;
  height: number;
}

function clampPlace(place: { right: number; bottom: number }, size: { width: number; height: number }, view: Viewport) {
  return {
    right: Math.min(Math.max(place.right, -(size.width - KEEP_VISIBLE)), Math.max(view.width - KEEP_VISIBLE, 0)),
    bottom: Math.min(Math.max(place.bottom, 0), Math.max(view.height - KEEP_VISIBLE, 0)),
  };
}

/** Moves a window, keeping enough of it on the screen to drag it back. */
export function movePanel(chatId: string, place: { right: number; bottom: number }, view: Viewport) {
  panels.update((list) =>
    list.map((panel) => (panel.chatId === chatId ? { ...panel, ...clampPlace(place, panel, view) } : panel))
  );
}

/** Resizes a window, between the smallest useful size and the size of the app window. */
export function resizePanel(chatId: string, size: { width: number; height: number }, view: Viewport) {
  panels.update((list) =>
    list.map((panel) =>
      panel.chatId === chatId
        ? {
            ...panel,
            width: Math.min(Math.max(Math.round(size.width), PANEL_MIN_WIDTH), Math.max(view.width, PANEL_MIN_WIDTH)),
            height: Math.min(Math.max(Math.round(size.height), PANEL_MIN_HEIGHT), Math.max(view.height, PANEL_MIN_HEIGHT)),
          }
        : panel
    )
  );
}

/** Starts a chat and opens its window at once. */
export function startChatPanel(options: NewChat = {}): string {
  const id = startChat(options);
  showChat(id);
  return id;
}

/**
 * What the button in the corner and the keyboard shortcut do: bring up the chat the user is most likely to want. A
 * chat whose window is closed comes back first, then the newest chat of all, and with no chats at all a new one starts.
 */
export function openAssistant(): string {
  const all = get(chats);
  const open = get(panels);
  const closed = all.filter((chat) => !panelOf(open, chat.id));
  const wanted: Chat | undefined = newestChat(closed) ?? newestChat(all);
  if (!wanted) return startChatPanel();
  showChat(wanted.id);
  return wanted.id;
}

/** Back to no windows at all, for a test or a fresh window. */
export function resetDock() {
  panels.set([]);
  counted = {};
}

// --- The answers that are waiting to be read

const replyCount = (chat: Chat) => chat.messages.filter((message) => message.role === 'assistant').length;

/** How many answers each chat had when it was last looked at, by chat id. */
let counted: Record<string, number> = {};
/** True while this module is writing to the chats, so its own writes do not count as new answers. */
let counting = false;

chats.subscribe((all) => {
  if (counting) return;
  const arrived: Array<[string, number]> = [];
  const now: Record<string, number> = {};
  for (const chat of all) {
    const replies = replyCount(chat);
    now[chat.id] = replies;
    // A chat that was cleared starts its count again rather than counting its answers as new ones.
    const before = Math.min(counted[chat.id] ?? 0, replies);
    if (replies > before && !showing(chat.id)) arrived.push([chat.id, replies - before]);
  }
  counted = now;
  if (arrived.length === 0) return;
  counting = true;
  try {
    for (const [chatId, answers] of arrived) updateChat(chatId, (chat) => ({ unread: chat.unread + answers }));
  } finally {
    counting = false;
  }
});
