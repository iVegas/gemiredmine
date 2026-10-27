import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { redmineApi } from '../api';
import { askAssistant, assistantError, asking, conversation } from '../assistant';
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

describe('asking the assistant from the app', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    conversation.set([]);
    assistantError.set(null);
    asking.set(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to ask before the assistant is set up, and says what to do', async () => {
    api.getAssistantSettings.mockResolvedValue({ ...configured, model: '' });
    const fetch = stubModel([]);

    const answered = await askAssistant('What is due?');

    expect(answered).toBe(false);
    expect(get(assistantError)).toBe('Name the model that should answer. Set up the assistant in Settings.');
    expect(fetch).not.toHaveBeenCalled();
    expect(get(asking)).toBe(false);
  });

  it('adds the question and the answer to the conversation, with the key of the chat model', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    api.loadAssistantKey.mockResolvedValue('local-key');
    const fetch = stubModel([{ choices: [{ message: { content: 'Nothing is due today.', tool_calls: undefined } }] }]);

    const answered = await askAssistant('  What is due?  ');

    expect(answered).toBe(true);
    expect(api.loadAssistantKey).toHaveBeenCalledWith('chat');
    expect(get(conversation)).toEqual([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: 'Nothing is due today.', toolCalls: [] },
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer local-key');
    expect(get(assistantError)).toBeNull();
  });

  it('keeps the question and shows the reason when the model refuses the key', async () => {
    api.getAssistantSettings.mockResolvedValue({ ...configured, baseUrl: 'https://api.openai.com/v1', model: 'gpt' });
    api.loadAssistantKey.mockResolvedValue('wrong');
    stubModel([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));

    const answered = await askAssistant('What is due?');

    expect(answered).toBe(false);
    expect(get(assistantError)).toBe('The model service refused the API key. Check the key in Settings.');
    expect(get(conversation)).toEqual([{ role: 'user', content: 'What is due?' }]);
    expect(get(asking)).toBe(false);
  });

  it('ignores an empty question', async () => {
    const answered = await askAssistant('   ');

    expect(answered).toBe(false);
    expect(api.getAssistantSettings).not.toHaveBeenCalled();
  });
});
