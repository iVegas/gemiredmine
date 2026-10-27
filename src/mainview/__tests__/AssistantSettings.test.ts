import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import AssistantSettings from '../components/AssistantSettings.svelte';
import { redmineApi } from '../lib/api';
import type { AssistantSettings as Settings } from '../../shared/assistant';

vi.mock('../lib/api', () => ({
  redmineApi: {
    getAssistantSettings: vi.fn(),
    saveAssistantSettings: vi.fn(),
    loadAssistantKey: vi.fn(),
    saveAssistantKey: vi.fn(),
    deleteAssistantKey: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);

const stored: Settings = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-5-5',
  voice: null,
};

describe('the assistant settings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getAssistantSettings.mockResolvedValue(stored);
    api.loadAssistantKey.mockResolvedValue(null);
    api.saveAssistantSettings.mockResolvedValue(undefined);
    api.saveAssistantKey.mockResolvedValue(undefined);
  });

  it('shows the saved service and model, and says when a key is kept, without showing it', async () => {
    api.loadAssistantKey.mockImplementation(async (slot) => (slot === 'chat' ? 'secret-key' : null));

    const view = render(AssistantSettings);

    expect(await view.findByLabelText('Service')).toHaveValue('anthropic');
    expect(view.getByLabelText('Model')).toHaveValue('claude-sonnet-5-5');
    expect(view.getByLabelText(/API key \(kept\)/)).toHaveValue('');
    expect(view.queryByText('secret-key')).toBeNull();
  });

  it('moves the address to the new service when the address was the old service’s', async () => {
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');

    await fireEvent.change(view.getByLabelText('Service'), { target: { value: 'gemini' } });

    expect(view.getByLabelText('Address')).toHaveValue('https://generativelanguage.googleapis.com/v1beta');
  });

  it('will not save without a model, and says why', async () => {
    api.getAssistantSettings.mockResolvedValue({ ...stored, model: '' });
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');

    await fireEvent.click(view.getByRole('button', { name: 'Save the assistant' }));

    expect(view.getByRole('alert')).toHaveTextContent('Name the model that should answer.');
    expect(api.saveAssistantSettings).not.toHaveBeenCalled();
  });

  it('saves the settings and the typed key, and clears the key field once it is kept', async () => {
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');
    await fireEvent.input(view.getByLabelText('API key'), { target: { value: 'new-key' } });

    await fireEvent.click(view.getByRole('button', { name: 'Save the assistant' }));

    expect(api.saveAssistantSettings).toHaveBeenCalledWith({ ...stored, voice: null });
    expect(api.saveAssistantKey).toHaveBeenCalledWith('chat', 'new-key');
    expect(await view.findByRole('status')).toHaveTextContent('Saved.');
    expect(view.getByLabelText(/API key \(kept\)/)).toHaveValue('');
  });

  it('asks for a speech-to-text model when a voice model is attached', async () => {
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');
    await fireEvent.click(view.getByRole('checkbox', { name: /Attach a voice model/ }));
    await fireEvent.input(view.getByLabelText('Address', { selector: '#assistant-voice-url' }), {
      target: { value: 'http://127.0.0.1:8000/v1' },
    });

    await fireEvent.click(view.getByRole('button', { name: 'Save the assistant' }));

    expect(view.getByRole('alert')).toHaveTextContent('Name the voice model that turns speech into text.');
    expect(api.saveAssistantSettings).not.toHaveBeenCalled();
  });
});
