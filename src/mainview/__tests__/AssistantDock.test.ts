import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import AssistantDock from '../components/AssistantDock.svelte';
import { redmineApi } from '../lib/api';
import { askAssistant } from '../lib/assistant';
import { chatById, chats, resetChats, startChat, updateChat } from '../lib/chats';
import { panelOf, panels, resetDock, startChatPanel, PANEL_EDGE, PANEL_WIDTH } from '../lib/assistant-dock';
import { activeView, openViews, resetViews } from '../lib/views';

vi.mock('../lib/api', () => ({
  redmineApi: { getAssistantSettings: vi.fn() },
}));

vi.mock('../lib/assistant', () => ({
  askAssistant: vi.fn(async () => true),
  readAloud: vi.fn(),
  transcribeSpeech: vi.fn(),
}));

const api = vi.mocked(redmineApi);
const placeOf = (chatId: string) => panelOf(get(panels), chatId);

/** A pointer drag of `dx`, `dy` that starts on an element: the rest of it is followed on the window. */
async function drag(element: Element, dx: number, dy: number) {
  await fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: 600, clientY: 400 });
  await fireEvent.pointerMove(window, { pointerId: 1, clientX: 600 + dx / 2, clientY: 400 + dy / 2 });
  await fireEvent.pointerMove(window, { pointerId: 1, clientX: 600 + dx, clientY: 400 + dy });
  await fireEvent.pointerUp(window, { pointerId: 1 });
}

describe('the floating assistant', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getAssistantSettings.mockResolvedValue({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
      voice: null,
    });
    vi.mocked(askAssistant).mockResolvedValue(true);
    resetViews();
    resetChats();
    resetDock();
  });

  it('starts as one button in the corner, with no chat window yet', () => {
    const view = render(AssistantDock);

    expect(view.getByRole('button', { name: 'Open the assistant' })).toBeInTheDocument();
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view.queryByRole('button', { name: 'Start another chat with the assistant' })).toBeNull();
  });

  it('opens a chat over the view, with the message box ready for the question', async () => {
    const view = render(AssistantDock);

    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));

    expect(view.getByRole('dialog', { name: 'Assistant: New chat' })).toBeInTheDocument();
    expect(await view.findByLabelText('Message')).toBe(document.activeElement);
  });

  it('opens a second chat beside the first, each with its own question', async () => {
    const view = render(AssistantDock);
    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));

    await fireEvent.click(view.getByRole('button', { name: 'Start another chat with the assistant' }));

    expect(get(chats)).toHaveLength(2);
    expect(view.getAllByRole('dialog')).toHaveLength(2);
    const [first, second] = get(panels);
    expect(placeOf(first.chatId)?.right).toBe(PANEL_EDGE);
    expect(placeOf(second.chatId)?.right).toBeGreaterThanOrEqual(PANEL_EDGE + PANEL_WIDTH);
  });

  it('keeps what is typed in each chat apart', async () => {
    const first = startChatPanel();
    const second = startChatPanel();
    const view = render(AssistantDock);

    const boxes = await view.findAllByLabelText('Message');
    await fireEvent.input(boxes[0], { target: { value: 'What is due?' } });
    await fireEvent.input(boxes[1], { target: { value: 'How long did I work?' } });

    expect(chatById(first)?.draft).toBe('What is due?');
    expect(chatById(second)?.draft).toBe('How long did I work?');
  });

  it('rolls a chat up into its title bar, keeping the question that was typed', async () => {
    const id = startChatPanel();
    const view = render(AssistantDock);
    await fireEvent.input(await view.findByLabelText('Message'), { target: { value: 'What is due today?' } });

    await fireEvent.click(view.getByRole('button', { name: 'Minimize New chat' }));
    expect(placeOf(id)?.minimized).toBe(true);

    await fireEvent.click(view.getByRole('button', { name: 'Expand New chat' }));

    expect(view.getByLabelText('Message')).toHaveValue('What is due today?');
  });

  it('rolls up on Escape rather than closing, so nothing typed is lost by a stray key', async () => {
    const id = startChatPanel();
    const view = render(AssistantDock);

    await fireEvent.keyDown(view.getByRole('dialog', { name: 'Assistant: New chat' }), { key: 'Escape' });

    expect(placeOf(id)?.minimized).toBe(true);
  });

  it('closes a chat window without forgetting what was said in it', async () => {
    const id = startChatPanel();
    updateChat(id, { messages: [{ role: 'user', content: 'What is due?' }] });
    const view = render(AssistantDock);

    await fireEvent.click(view.getByRole('button', { name: 'Close New chat' }));

    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
    expect(chatById(id)?.messages).toHaveLength(1);
    // The button brings that same chat back rather than starting another.
    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));
    expect(get(chats)).toHaveLength(1);
    expect(placeOf(id)?.minimized).toBe(false);
  });

  it('is dragged by its title bar and resized by the grip in its corner', async () => {
    const id = startChatPanel();
    const before = placeOf(id)!;
    const view = render(AssistantDock);

    await drag(view.getByTestId(`title-${id}`), -120, -80);

    // The window is anchored by its bottom right corner, so a drag to the left and up moves it away from both edges.
    expect(placeOf(id)?.right).toBe(before.right + 120);
    expect(placeOf(id)?.bottom).toBe(before.bottom + 80);

    await drag(view.getByTestId(`resize-${id}`), -60, -40);

    expect(placeOf(id)?.width).toBe(before.width + 60);
    expect(placeOf(id)?.height).toBe(before.height + 40);
  });

  it('does not drag the window when a button in its title bar is pressed', async () => {
    const id = startChatPanel();
    const before = placeOf(id)!;
    const view = render(AssistantDock);

    await fireEvent.pointerDown(view.getByRole('button', { name: 'Close New chat' }), { pointerId: 2, button: 0, clientX: 600, clientY: 400 });
    await fireEvent.pointerMove(window, { pointerId: 2, clientX: 400, clientY: 200 });

    expect(placeOf(id)).toMatchObject({ right: before.right, bottom: before.bottom });
  });

  it('hands a chat to the Assistant tab, which shows the same chats', async () => {
    const id = startChatPanel();
    const view = render(AssistantDock);

    await fireEvent.click(view.getByRole('button', { name: 'Open New chat in a tab' }));

    expect(get(openViews)).toEqual(['dashboard', 'assistant']);
    expect(get(activeView)).toBe('assistant');
    expect(placeOf(id)).toBeUndefined();
    expect(chatById(id)).toBeDefined();
  });

  it('counts on the button the answers that arrived in chats with no window', async () => {
    const id = startChat();
    const view = render(AssistantDock);

    updateChat(id, { messages: [{ role: 'user', content: 'What is due?' }, { role: 'assistant', content: 'Two tasks.', toolCalls: [] }] });

    expect(await view.findByRole('button', { name: 'Open the assistant, 1 new answer' })).toBeInTheDocument();

    await fireEvent.click(view.getByRole('button', { name: /^Open the assistant/ }));

    expect(chatById(id)?.unread).toBe(0);
  });

  it('says that an answer is on its way while the user works on', async () => {
    const id = startChat();
    const view = render(AssistantDock);

    updateChat(id, { asking: true });

    expect(await view.findByText('Thinking…')).toBeInTheDocument();
  });
});

describe('a press on the title bar that is not a drag', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getAssistantSettings.mockResolvedValue({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
      voice: null,
    });
    resetViews();
    resetChats();
    resetDock();
  });

  it('rolls the window up, because the name of the chat is both the handle and the button', async () => {
    const id = startChatPanel();
    const view = render(AssistantDock);
    const title = view.getByRole('button', { name: /^New chat/ });

    // A press that hardly moves is a click, not a drag.
    await fireEvent.pointerDown(title, { pointerId: 3, button: 0, clientX: 600, clientY: 400 });
    await fireEvent.pointerMove(window, { pointerId: 3, clientX: 601, clientY: 400 });
    await fireEvent.pointerUp(window, { pointerId: 3 });
    await fireEvent.click(title);

    expect(placeOf(id)?.minimized).toBe(true);
    expect(placeOf(id)).toMatchObject({ right: PANEL_EDGE, bottom: 0 });
  });

  it('moves the window and leaves it open when the pointer travels', async () => {
    const id = startChatPanel();
    const view = render(AssistantDock);
    const title = view.getByRole('button', { name: /^New chat/ });

    await drag(title, -100, -60);
    await fireEvent.click(title);

    expect(placeOf(id)?.minimized).toBe(false);
    expect(placeOf(id)).toMatchObject({ right: PANEL_EDGE + 100, bottom: 60 });
  });
});
