import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    findLocalModelServers: vi.fn(),
    findSystemAiSetup: vi.fn(),
    openAssistantKeyPage: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);

const stored: Settings = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-5-5',
  voice: null,
};

/** A built-in model in this webview, as the Prompt API offers one. */
function withDeviceModel(availability: string, answer = 'From the device.') {
  const session = { prompt: vi.fn(async () => answer), destroy: vi.fn() };
  const api = { availability: vi.fn(async () => availability), create: vi.fn(async () => session) };
  (window as unknown as { LanguageModel?: unknown }).LanguageModel = api;
  return api;
}

describe('the assistant settings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getAssistantSettings.mockResolvedValue(stored);
    api.loadAssistantKey.mockResolvedValue(null);
    api.saveAssistantSettings.mockResolvedValue(undefined);
    api.saveAssistantKey.mockResolvedValue(undefined);
    api.findLocalModelServers.mockResolvedValue([]);
    api.findSystemAiSetup.mockResolvedValue([]);
    api.openAssistantKeyPage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (window as unknown as { LanguageModel?: unknown }).LanguageModel;
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
    expect(await view.findByText('Saved.')).toBeInTheDocument();
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

  it('opens the page where the chosen service hands out a key', async () => {
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');
    await fireEvent.change(view.getByLabelText('Service'), { target: { value: 'gemini' } });

    await fireEvent.click(view.getByRole('button', { name: 'Get a key from Google AI Studio' }));

    expect(api.openAssistantKeyPage).toHaveBeenCalledWith('gemini');
  });
});

describe('what the computer offers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getAssistantSettings.mockResolvedValue(stored);
    api.loadAssistantKey.mockResolvedValue(null);
    api.saveAssistantSettings.mockResolvedValue(undefined);
    api.saveAssistantKey.mockResolvedValue(undefined);
    api.findLocalModelServers.mockResolvedValue([]);
    api.findSystemAiSetup.mockResolvedValue([]);
  });

  afterEach(() => {
    delete (window as unknown as { LanguageModel?: unknown }).LanguageModel;
  });

  it('searches this computer as soon as it is shown, and says when it found nothing', async () => {
    const view = render(AssistantSettings);

    expect(await view.findByText(/Nothing was found here/)).toBeInTheDocument();
    expect(api.findLocalModelServers).toHaveBeenCalledTimes(1);
    expect(api.findSystemAiSetup).toHaveBeenCalledTimes(1);
  });

  it('offers a local server that is running, and puts its address and model in the form', async () => {
    api.findLocalModelServers.mockResolvedValue([
      { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b', 'llama3.1:8b', 'phi4'] },
    ]);
    const view = render(AssistantSettings);
    expect(await view.findByText(/qwen3:8b, llama3.1:8b and 1 more/)).toBeInTheDocument();

    await fireEvent.click(view.getByRole('button', { name: 'Use Ollama at http://127.0.0.1:11434/v1' }));

    expect(view.getByLabelText('Service')).toHaveValue('openai-compatible');
    expect(view.getByLabelText('Address')).toHaveValue('http://127.0.0.1:11434/v1');
    expect(view.getByLabelText('Model')).toHaveValue('qwen3:8b');
    expect(view.getByText(/Ollama is in the form/)).toBeInTheDocument();
  });

  it('offers a key this computer already holds, and keeps it out of sight until it is saved', async () => {
    api.findSystemAiSetup.mockResolvedValue([
      { provider: 'gemini', kind: 'key', source: 'the GEMINI_API_KEY environment variable', value: 'AIza-0123456789abcdef' },
    ]);
    const view = render(AssistantSettings);
    expect(await view.findByText(/Found in the GEMINI_API_KEY environment variable/)).toBeInTheDocument();
    expect(view.queryByText('AIza-0123456789abcdef')).toBeNull();

    await fireEvent.click(view.getByRole('button', { name: 'Use the key from the GEMINI_API_KEY environment variable' }));
    await fireEvent.input(view.getByLabelText('Model'), { target: { value: 'gemini-2.5-flash' } });
    await fireEvent.click(view.getByRole('button', { name: 'Save the assistant' }));

    expect(api.saveAssistantSettings).toHaveBeenCalledWith({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      voice: null,
    });
    expect(api.saveAssistantKey).toHaveBeenCalledWith('chat', 'AIza-0123456789abcdef');
  });

  it('offers the model of this device, which needs no address and no key', async () => {
    withDeviceModel('available');
    const view = render(AssistantSettings);
    await view.findByText(/This device can answer by itself/);

    await fireEvent.click(view.getByRole('button', { name: 'Use this device' }));

    expect(view.getByLabelText('Service')).toHaveValue('on-device');
    expect(view.queryByLabelText('Address')).toBeNull();
    expect(view.queryByLabelText('API key')).toBeNull();

    await fireEvent.click(view.getByRole('button', { name: 'Save the assistant' }));

    expect(api.saveAssistantSettings).toHaveBeenCalledWith({ provider: 'on-device', baseUrl: '', model: '', voice: null });
  });

  it('says next to the key box when the device or a local server could answer without a key', async () => {
    withDeviceModel('downloadable');
    api.findLocalModelServers.mockResolvedValue([{ label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', models: [] }]);
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');

    await fireEvent.change(view.getByLabelText('Service'), { target: { value: 'gemini' } });

    expect(view.getByText(/This device can also answer without any key/)).toBeInTheDocument();
    expect(view.getByText(/A local model server is running on this computer \(LM Studio\)/)).toBeInTheDocument();
  });

  it('does not treat a search that fails as a reason not to set the assistant up by hand', async () => {
    api.findLocalModelServers.mockRejectedValue(new Error('no HTTP client here'));
    const view = render(AssistantSettings);

    expect(await view.findByText(/This computer could not be searched for a model: no HTTP client here/)).toBeInTheDocument();
    expect(view.getByLabelText('Service')).toHaveValue('anthropic');
  });
});

describe('a setup link', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getAssistantSettings.mockResolvedValue(stored);
    api.loadAssistantKey.mockResolvedValue(null);
    api.saveAssistantSettings.mockResolvedValue(undefined);
    api.saveAssistantKey.mockResolvedValue(undefined);
    api.findLocalModelServers.mockResolvedValue([]);
    api.findSystemAiSetup.mockResolvedValue([]);
  });

  it('fills the form from a pasted link, with the key it carries', async () => {
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');

    await fireEvent.input(view.getByLabelText(/A setup link or the settings in JSON/), {
      target: { value: 'gemiredmine://assistant?provider=gemini&model=gemini-2.5-flash&key=AIza-0123456789abcdef' },
    });
    await fireEvent.click(view.getByRole('button', { name: 'Fill in the form' }));

    expect(view.getByLabelText('Service')).toHaveValue('gemini');
    expect(view.getByLabelText('Model')).toHaveValue('gemini-2.5-flash');
    expect(view.getByText(/with the key it carried/)).toBeInTheDocument();
  });

  it('says so when the pasted text is not a setup', async () => {
    const view = render(AssistantSettings);
    await view.findByLabelText('Service');

    await fireEvent.input(view.getByLabelText(/A setup link or the settings in JSON/), { target: { value: 'https://example.com' } });
    await fireEvent.click(view.getByRole('button', { name: 'Fill in the form' }));

    expect(view.getByRole('alert')).toHaveTextContent('That is not a setup link for the assistant.');
  });
});
