import { describe, it, expect, vi, afterEach } from 'vitest';
import { ON_DEVICE_SYSTEM_PROMPT, askOnDevice, onDeviceState, onDeviceStateText, promptApi } from '../on-device-ai';
import type { ChatMessage } from '../../../bun/assistant/providers';

type Global = { LanguageModel?: unknown; ai?: unknown };

function withApi(api: unknown, spelling: 'LanguageModel' | 'ai' = 'LanguageModel') {
  if (spelling === 'LanguageModel') (window as unknown as Global).LanguageModel = api;
  else (window as unknown as Global).ai = { languageModel: api };
}

const session = (answer = 'Hello.') => ({ prompt: vi.fn(async () => answer), destroy: vi.fn() });

afterEach(() => {
  delete (window as unknown as Global).LanguageModel;
  delete (window as unknown as Global).ai;
});

describe('the model this device carries', () => {
  it('is missing where the webview has no built-in model', async () => {
    expect(promptApi()).toBeNull();
    expect(await onDeviceState()).toBe('missing');
    expect(onDeviceStateText('missing')).toBeNull();
  });

  it('reports what the webview says about it', async () => {
    withApi({ availability: async () => 'downloadable', create: async () => session() });

    expect(await onDeviceState()).toBe('downloadable');
    expect(onDeviceStateText('downloadable')).toContain('once the system has fetched the model');
  });

  it('reads the earlier spelling of the question and of the answer', async () => {
    withApi({ capabilities: async () => ({ available: 'readily' }), create: async () => session() }, 'ai');

    expect(await onDeviceState()).toBe('available');
  });

  it('is not offered when the webview has the model but refuses to say', async () => {
    withApi({
      availability: async () => {
        throw new Error('not allowed here');
      },
      create: async () => session(),
    });

    expect(await onDeviceState()).toBe('unavailable');
    expect(onDeviceStateText('unavailable')).toBeNull();
  });
});

describe('asking the model on this device', () => {
  const conversation: ChatMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hello to you', toolCalls: [] },
    { role: 'tool', toolCallId: 'c1', name: 'list_tasks', content: '[]' },
    { role: 'user', content: 'What can you do?' },
  ];

  it('hands the earlier turns to the session and asks the last question, then closes the session', async () => {
    const open = session('I answer from this conversation.');
    const api = { availability: async () => 'available', create: vi.fn(async () => open) };
    withApi(api);

    const answer = await askOnDevice(conversation);

    expect(answer).toBe('I answer from this conversation.');
    expect(api.create).toHaveBeenCalledWith({
      initialPrompts: [
        { role: 'system', content: ON_DEVICE_SYSTEM_PROMPT },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello to you' },
      ],
    });
    expect(open.prompt).toHaveBeenCalledWith('What can you do?');
    expect(open.destroy).toHaveBeenCalled();
  });

  it('tells the model that it cannot read Redmine, so it says so itself', () => {
    expect(ON_DEVICE_SYSTEM_PROMPT).toContain('cannot read their Redmine servers, tasks or time');
  });

  it('says where to set a model up when this device has none', async () => {
    await expect(askOnDevice(conversation)).rejects.toThrow('This device has no built-in model. Choose a model service in Settings.');
  });

  it('closes the session even when the model fails', async () => {
    const open = { prompt: vi.fn(async () => { throw new Error('the model stopped'); }), destroy: vi.fn() };
    withApi({ availability: async () => 'available', create: async () => open });

    await expect(askOnDevice(conversation)).rejects.toThrow('the model stopped');
    expect(open.destroy).toHaveBeenCalled();
  });

  it('refuses a conversation whose last turn is not a question', async () => {
    withApi({ availability: async () => 'available', create: async () => session() });

    await expect(askOnDevice([{ role: 'assistant', content: 'Hello', toolCalls: [] }])).rejects.toThrow(
      'There is no question for the model on this device.'
    );
  });
});
