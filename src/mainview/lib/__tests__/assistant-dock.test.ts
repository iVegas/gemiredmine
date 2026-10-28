import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { chatById, chats, resetChats, startChat, updateChat } from '../chats';
import {
  closePanel,
  dockFits,
  minimizePanel,
  movePanel,
  openAssistant,
  panelOf,
  panels,
  resetDock,
  resizePanel,
  showChat,
  startChatPanel,
  togglePanel,
  unreadOutside,
  MAX_OPEN_PANELS,
  PANEL_EDGE,
  PANEL_GAP,
  PANEL_HEIGHT,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_WIDTH,
} from '../assistant-dock';
import { activeView, resetViews } from '../views';

const view = { width: 1280, height: 800 };
const placeOf = (chatId: string) => panelOf(get(panels), chatId);
const answered = (replies: number) => [
  { role: 'user' as const, content: 'What is due?' },
  ...Array.from({ length: replies }, (_, index) => ({ role: 'assistant' as const, content: `Answer ${index + 1}`, toolCalls: [] })),
];

describe('where the floating assistant belongs', () => {
  it('floats over the views of the user’s data, and not over its own settings or its own tab', () => {
    expect(dockFits('dashboard')).toBe(true);
    expect(dockFits('task:dev:42')).toBe(true);
    expect(dockFits('settings')).toBe(false);
    expect(dockFits('assistant')).toBe(false);
  });
});

describe('the chat windows', () => {
  beforeEach(() => {
    resetViews();
    resetChats();
    resetDock();
  });

  it('open beside each other along the bottom right corner', () => {
    const first = startChatPanel();
    const second = startChatPanel();

    expect(placeOf(first)).toMatchObject({ right: PANEL_EDGE, bottom: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT });
    expect(placeOf(second)?.right).toBe(PANEL_EDGE + PANEL_WIDTH + PANEL_GAP);
  });

  it('roll the one open longest up when there is no more room side by side', () => {
    const made = Array.from({ length: MAX_OPEN_PANELS + 1 }, () => startChatPanel());

    expect(placeOf(made[0])?.minimized).toBe(true);
    expect(made.slice(1).every((id) => placeOf(id)?.minimized === false)).toBe(true);
  });

  it('roll up and open again from the title bar, keeping where they are', () => {
    const id = startChatPanel();
    movePanel(id, { right: 200, bottom: 120 }, view);

    togglePanel(id);
    expect(placeOf(id)).toMatchObject({ minimized: true, right: 200, bottom: 120 });

    togglePanel(id);
    expect(placeOf(id)).toMatchObject({ minimized: false, right: 200, bottom: 120 });
  });

  it('close without forgetting the chat, which the Assistant tab still lists', () => {
    const id = startChatPanel();
    updateChat(id, { messages: [{ role: 'user', content: 'What is due?' }] });

    closePanel(id);

    expect(get(panels)).toEqual([]);
    expect(chatById(id)?.messages).toHaveLength(1);
  });
});

describe('dragging and resizing a chat window', () => {
  beforeEach(() => {
    resetViews();
    resetChats();
    resetDock();
  });

  it('moves it anywhere in the window', () => {
    const id = startChatPanel();

    movePanel(id, { right: 420, bottom: 260 }, view);

    expect(placeOf(id)).toMatchObject({ right: 420, bottom: 260 });
  });

  it('keeps a handle on the screen, however far it is dragged', () => {
    const id = startChatPanel();

    movePanel(id, { right: -5000, bottom: -5000 }, view);
    expect(placeOf(id)?.right).toBe(-(PANEL_WIDTH - 48));
    expect(placeOf(id)?.bottom).toBe(0);

    movePanel(id, { right: 9000, bottom: 9000 }, view);
    expect(placeOf(id)?.right).toBe(view.width - 48);
    expect(placeOf(id)?.bottom).toBe(view.height - 48);
  });

  it('resizes it, and not below the smallest useful size or beyond the app window', () => {
    const id = startChatPanel();

    resizePanel(id, { width: 500, height: 600 }, view);
    expect(placeOf(id)).toMatchObject({ width: 500, height: 600 });

    resizePanel(id, { width: 10, height: 10 }, view);
    expect(placeOf(id)).toMatchObject({ width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT });

    resizePanel(id, { width: 9000, height: 9000 }, view);
    expect(placeOf(id)).toMatchObject({ width: view.width, height: view.height });
  });
});

describe('bringing the assistant up', () => {
  beforeEach(() => {
    resetViews();
    resetChats();
    resetDock();
  });

  it('starts a chat when there is none', () => {
    const id = openAssistant();

    expect(get(chats)).toHaveLength(1);
    expect(placeOf(id)?.minimized).toBe(false);
  });

  it('brings back the chat whose window was closed, rather than starting another', () => {
    const id = startChatPanel();
    closePanel(id);

    expect(openAssistant()).toBe(id);
    expect(get(chats)).toHaveLength(1);
  });

  it('opens the newest chat again when every chat already has a window', () => {
    startChatPanel();
    const second = startChatPanel();
    minimizePanel(second);

    expect(openAssistant()).toBe(second);
    expect(placeOf(second)?.minimized).toBe(false);
  });
});

describe('the answers that are waiting to be read', () => {
  beforeEach(() => {
    resetViews();
    resetChats();
    resetDock();
  });

  it('are counted per chat while its window is rolled up or closed', () => {
    const open = startChatPanel();
    const rolled = startChatPanel();
    minimizePanel(rolled);
    const closed = startChat();

    updateChat(open, { messages: answered(1) });
    updateChat(rolled, { messages: answered(2) });
    updateChat(closed, { messages: answered(1) });

    expect(chatById(open)?.unread).toBe(0);
    expect(chatById(rolled)?.unread).toBe(2);
    expect(chatById(closed)?.unread).toBe(1);
  });

  it('are what the button in the corner counts, for the chats with no window of their own', () => {
    const rolled = startChatPanel();
    minimizePanel(rolled);
    const closed = startChat();

    updateChat(rolled, { messages: answered(2) });
    updateChat(closed, { messages: answered(3) });

    expect(get(unreadOutside)).toBe(3);
  });

  it('count as read when the chat’s window is opened', () => {
    const id = startChat();
    updateChat(id, { messages: answered(2) });
    expect(chatById(id)?.unread).toBe(2);

    showChat(id);

    expect(chatById(id)?.unread).toBe(0);
  });

  it('are not counted at all while the Assistant tab is the view', () => {
    const id = startChat();
    activeView.set('assistant');

    updateChat(id, { messages: answered(2) });

    expect(chatById(id)?.unread).toBe(0);
  });

  it('start again from nothing when a chat is emptied', () => {
    const id = startChat();
    updateChat(id, { messages: answered(2) });
    updateChat(id, { messages: [], unread: 0 });

    updateChat(id, { messages: answered(1) });

    expect(chatById(id)?.unread).toBe(1);
  });
});
