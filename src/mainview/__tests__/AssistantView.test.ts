import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import AssistantView from '../AssistantView.svelte';
import { redmineApi } from '../lib/api';
import { askAssistant, assistantError, asking, conversation, readAloud } from '../lib/assistant';
import { openViews, activeView, resetViews } from '../lib/views';
import { RecordingUnsupportedError, startRecording } from '../lib/recorder';
import type { AssistantSettings } from '../../shared/assistant';

vi.mock('../lib/api', () => ({
  redmineApi: { getAssistantSettings: vi.fn() },
}));

vi.mock('../lib/recorder', async () => {
  const actual = await vi.importActual<typeof import('../lib/recorder')>('../lib/recorder');
  return { ...actual, startRecording: vi.fn() };
});

vi.mock('../lib/assistant', async () => {
  const { writable } = await import('svelte/store');
  return {
    conversation: writable([]),
    asking: writable(false),
    assistantError: writable(null),
    askAssistant: vi.fn(),
    readAloud: vi.fn(),
    transcribeSpeech: vi.fn(),
  };
});

const api = vi.mocked(redmineApi);

const configured: AssistantSettings = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-5-5',
  voice: null,
};

const withVoice: AssistantSettings = {
  ...configured,
  voice: { baseUrl: 'http://127.0.0.1:8000/v1', transcription: 'whisper-1', speech: 'tts-1', speechVoice: 'alloy' },
};

describe('the assistant view', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetViews();
    conversation.set([]);
    asking.set(false);
    assistantError.set(null);
  });

  it('asks the user to set the assistant up, and sends the user to Settings, when no model is set', async () => {
    api.getAssistantSettings.mockResolvedValue({ ...configured, model: '' });
    const view = render(AssistantView);

    await view.findByText(/not set up yet/);
    expect(view.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    await fireEvent.click(view.getByRole('button', { name: 'Open Settings' }));

    expect(get(openViews)).toContain('settings');
    expect(get(activeView)).toBe('settings');
  });

  it('sends the message on Enter, and clears the box once it is answered', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    vi.mocked(askAssistant).mockResolvedValue(true);
    const view = render(AssistantView);
    const box = (await view.findByRole('textbox', { name: 'Message' })) as HTMLTextAreaElement;

    await fireEvent.input(box, { target: { value: 'What is due?' } });
    await fireEvent.keyDown(box, { key: 'Enter' });

    expect(askAssistant).toHaveBeenCalledWith('What is due?');
    await vi.waitFor(() => expect(box.value).toBe(''));
  });

  it('keeps a new line on Shift+Enter, so the message is not sent', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    const view = render(AssistantView);
    const box = await view.findByRole('textbox', { name: 'Message' });

    await fireEvent.input(box, { target: { value: 'Two' } });
    await fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });

    expect(askAssistant).not.toHaveBeenCalled();
  });

  it('shows the conversation, with the tools each answer used, and no tool results', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    conversation.set([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_assigned_tasks', args: {} }] },
      { role: 'tool', toolCallId: 'c1', name: 'list_assigned_tasks', content: '{"tasks":[]}' },
      { role: 'assistant', content: 'Nothing is due.', toolCalls: [] },
    ]);

    const view = render(AssistantView);

    const list = await view.findByRole('list', { name: 'Conversation' });
    expect(list.textContent).toContain('What is due?');
    expect(list.textContent).toContain('Checked: list_assigned_tasks');
    expect(list.textContent).toContain('Nothing is due.');
    expect(list.textContent).not.toContain('{"tasks"');
  });

  it('offers voice only with a voice model attached', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    const plain = render(AssistantView);
    await plain.findByRole('textbox', { name: 'Message' });
    expect(plain.queryByRole('button', { name: 'Speak' })).toBeNull();
    plain.unmount();

    api.getAssistantSettings.mockResolvedValue(withVoice);
    const voiced = render(AssistantView);
    expect(await voiced.findByRole('button', { name: 'Speak' })).toBeInTheDocument();
    expect(voiced.getByRole('checkbox', { name: 'Read replies aloud' })).toBeInTheDocument();
  });

  it('reads the answer aloud when that is turned on', async () => {
    api.getAssistantSettings.mockResolvedValue(withVoice);
    vi.mocked(askAssistant).mockImplementation(async () => {
      conversation.set([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello.', toolCalls: [] }]);
      return true;
    });
    vi.mocked(readAloud).mockResolvedValue(undefined);
    const view = render(AssistantView);
    const box = await view.findByRole('textbox', { name: 'Message' });
    await fireEvent.click(view.getByRole('checkbox', { name: 'Read replies aloud' }));

    await fireEvent.input(box, { target: { value: 'Hi' } });
    await fireEvent.click(view.getByRole('button', { name: 'Send' }));

    await vi.waitFor(() => expect(readAloud).toHaveBeenCalledWith('Hello.'));
  });

  it('shows the reason of a problem in an alert', async () => {
    api.getAssistantSettings.mockResolvedValue(configured);
    assistantError.set('The model service answered 500.');

    const view = render(AssistantView);

    expect(await view.findByRole('alert')).toHaveTextContent('The model service answered 500.');
  });

  it('says that the model on this device answers without reading Redmine', async () => {
    api.getAssistantSettings.mockResolvedValue({ provider: 'on-device', baseUrl: '', model: '', voice: null });
    const view = render(AssistantView);

    expect(await view.findByText(/answers without reading your tasks or your time/)).toBeInTheDocument();
    expect(view.queryByText(/The assistant is not set up yet/)).toBeNull();
  });

  it('stops offering to speak in a window whose recorder is only a name, and says so once', async () => {
    api.getAssistantSettings.mockResolvedValue(withVoice);
    vi.mocked(startRecording).mockRejectedValue(new RecordingUnsupportedError());
    const view = render(AssistantView);

    await fireEvent.click(await view.findByRole('button', { name: 'Speak' }));

    expect(view.getByRole('alert')).toHaveTextContent('This window cannot record sound');
    expect(view.queryByRole('button', { name: 'Speak' })).toBeNull();
    // The replies can still be read aloud: that needs no microphone.
    expect(view.getByRole('checkbox', { name: 'Read replies aloud' })).toBeInTheDocument();
  });
});
