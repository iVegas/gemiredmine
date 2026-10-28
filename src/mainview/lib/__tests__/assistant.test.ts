import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { redmineApi } from '../api';
import { askAssistant } from '../assistant';
import { chatById, resetChats, startChat, updateChat } from '../chats';
import type { AssistantSettings } from '../../../shared/assistant';

vi.mock('../api', () => ({
  redmineApi: {
    getAssistantSettings: vi.fn(),
    loadAssistantKey: vi.fn(),
    listAssignedTasks: vi.fn(),
    getTask: vi.fn(),
    listTimeActivities: vi.fn(),
  },
}));

vi.mock('../bridge', () => ({ hasDesktopBackend: () => false }));

vi.mock('../tauri-platform', () => ({ tauriFetch: vi.fn() }));

vi.mock('../mcp-host', () => ({
  storeHost: {
    servers: () => [{ id: 'dev', name: 'Dev', url: 'https://dev.local', signedIn: true, active: true }],
    access: () => null,
    propose: vi.fn(),
    proposal: () => null,
  },
}));

const api = vi.mocked(redmineApi);

const configured: AssistantSettings = {
  provider: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:8000/v1',
  model: 'local-model',
  voice: null,
};

/** A model that answers with the given replies, in order, and records each request. */
function stubModel(replies: unknown[]) {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(replies.shift()), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

let chat: string;

describe('asking the assistant from the app', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetChats();
    chat = startChat();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to ask before the assistant is set up, and says what to do', async () => {
    api.getAssistantSettings.mockResolvedValue({ ...configured, model: '' });
    const fetch = stubModel([]);

    const answered = await askAssistant(chat, 'What is due?');

    expect(answered).toBe(false);
    expect(chatById(chat)?.error).toBe('Name the model that should answer. Set up the assistant in Settings.');
    expect(fetch).not.toHaveBeenCalled();
    expect(chatById(chat)?.asking).toBe(false);
  });

  it('adds the question and the answer to the conversation, with the key of the chat model', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    api.loadAssistantKey.mockResolvedValue('local-key');
    const fetch = stubModel([{ choices: [{ message: { content: 'Nothing is due today.', tool_calls: undefined } }] }]);

    const answered = await askAssistant(chat, '  What is due?  ');

    expect(answered).toBe(true);
    expect(api.loadAssistantKey).toHaveBeenCalledWith('chat');
    expect(chatById(chat)?.messages).toEqual([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: 'Nothing is due today.', toolCalls: [] },
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer local-key');
    expect(chatById(chat)?.error).toBeNull();
  });

  it('keeps the question and shows the reason when the model refuses the key', async () => {
    api.getAssistantSettings.mockResolvedValue({ ...configured, baseUrl: 'https://api.openai.com/v1', model: 'gpt' });
    api.loadAssistantKey.mockResolvedValue('wrong');
    stubModel([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));

    const answered = await askAssistant(chat, 'What is due?');

    expect(answered).toBe(false);
    expect(chatById(chat)?.error).toBe('The model service refused the API key. Check the key in Settings.');
    expect(chatById(chat)?.messages).toEqual([{ role: 'user', content: 'What is due?' }]);
    expect(chatById(chat)?.asking).toBe(false);
  });

  it('ignores an empty question', async () => {
    const answered = await askAssistant(chat, '   ');

    expect(answered).toBe(false);
    expect(api.getAssistantSettings).not.toHaveBeenCalled();
  });
});

describe('asking the model on this device', () => {
  const onDevice: AssistantSettings = { provider: 'on-device', baseUrl: '', model: '', voice: null };

  beforeEach(() => {
    vi.resetAllMocks();
    resetChats();
    chat = startChat();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { LanguageModel?: unknown }).LanguageModel;
  });

  it('prompts the built-in model of the webview instead of a server, and keeps the answer', async () => {
    api.getAssistantSettings.mockResolvedValue(onDevice);
    const fetch = stubModel([]);
    const session = { prompt: vi.fn(async () => 'I cannot read Redmine from here.'), destroy: vi.fn() };
    (window as unknown as { LanguageModel?: unknown }).LanguageModel = { availability: async () => 'available', create: async () => session };

    const answered = await askAssistant(chat, 'What is due?');

    expect(answered).toBe(true);
    expect(session.prompt).toHaveBeenCalledWith('What is due?');
    expect(fetch).not.toHaveBeenCalled();
    expect(chatById(chat)?.messages).toEqual([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: 'I cannot read Redmine from here.', toolCalls: [] },
    ]);
    expect(api.loadAssistantKey).not.toHaveBeenCalled();
  });

  it('says where to set a model up when this webview has no built-in one', async () => {
    api.getAssistantSettings.mockResolvedValue(onDevice);

    const answered = await askAssistant(chat, 'What is due?');

    expect(answered).toBe(false);
    expect(chatById(chat)?.error).toBe('This device has no built-in model. Choose a model service in Settings.');
  });
});

describe('several chats at once', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetChats();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps each question and each answer in the chat it was asked in', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    api.loadAssistantKey.mockResolvedValue(null);
    stubModel([
      { choices: [{ message: { content: 'Two tasks.' } }] },
      { choices: [{ message: { content: 'Six hours.' } }] },
    ]);
    const due = startChat();
    const time = startChat();

    expect(await askAssistant(due, 'What is due?')).toBe(true);
    expect(await askAssistant(time, 'How long did I work?')).toBe(true);

    expect(chatById(due)?.messages).toEqual([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: 'Two tasks.', toolCalls: [] },
    ]);
    expect(chatById(time)?.messages).toEqual([
      { role: 'user', content: 'How long did I work?' },
      { role: 'assistant', content: 'Six hours.', toolCalls: [] },
    ]);
  });

  it('names a chat after its first question, and leaves a name it was given alone', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    api.loadAssistantKey.mockResolvedValue(null);
    stubModel([{ choices: [{ message: { content: 'Two tasks.' } }] }, { choices: [{ message: { content: 'Yes.' } }] }]);
    const plain = startChat();
    const named = startChat({ title: 'Task #42' });

    await askAssistant(plain, 'What is due today?');
    await askAssistant(named, 'Who is this assigned to?');

    expect(chatById(plain)?.title).toBe('What is due today?');
    expect(chatById(named)?.title).toBe('Task #42');
  });

  it('clears what was typed once the question is asked, and only in that chat', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    api.loadAssistantKey.mockResolvedValue(null);
    stubModel([{ choices: [{ message: { content: 'Two tasks.' } }] }]);
    const asked = startChat();
    const other = startChat();
    updateChat(asked, { draft: 'What is due?' });
    updateChat(other, { draft: 'half a question' });

    await askAssistant(asked, 'What is due?');

    expect(chatById(asked)?.draft).toBe('');
    expect(chatById(other)?.draft).toBe('half a question');
  });

  it('refuses a second question in a chat that is still being answered', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    const id = startChat();
    updateChat(id, { asking: true });

    expect(await askAssistant(id, 'What is due?')).toBe(false);
    expect(api.getAssistantSettings).not.toHaveBeenCalled();
  });

  it('answers nothing into a chat the user has forgotten in the meantime', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    const id = startChat();

    expect(await askAssistant('chat-gone', 'What is due?')).toBe(false);
    expect(chatById(id)?.messages).toEqual([]);
  });
});
