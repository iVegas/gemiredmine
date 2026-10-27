import { describe, it, expect } from 'vitest';
import { assistantKeyId, assistantSettingsFrom, assistantSettingsProblem, DEFAULT_SPEECH_VOICE, type AssistantSettings } from '../assistant';

const ready: AssistantSettings = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-5-5',
  voice: null,
};

describe('the stored assistant settings', () => {
  it('start from the first service, with no model and no voice, when nothing is stored', () => {
    expect(assistantSettingsFrom(undefined)).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: '',
      voice: null,
    });
  });

  it('fall back to the first service when the stored provider is not one of them', () => {
    expect(assistantSettingsFrom({ provider: 'unknown', model: 'x' }).provider).toBe('openai-compatible');
  });

  it('keep an attached voice model, and read the voice of the replies when it is missing', () => {
    const settings = assistantSettingsFrom({
      ...ready,
      voice: { baseUrl: 'http://127.0.0.1:8000/v1', transcription: 'whisper-1', speech: null, speechVoice: '' },
    });

    expect(settings.voice).toEqual({ baseUrl: 'http://127.0.0.1:8000/v1', transcription: 'whisper-1', speech: null, speechVoice: DEFAULT_SPEECH_VOICE });
  });
});

describe('whether the settings can be used', () => {
  it('accepts settings with an address and a model', () => {
    expect(assistantSettingsProblem(ready)).toBeNull();
  });

  it('asks for a model, and for an address that is web or local', () => {
    expect(assistantSettingsProblem({ ...ready, model: '  ' })).toBe('Name the model that should answer.');
    expect(assistantSettingsProblem({ ...ready, baseUrl: 'api.anthropic.com' })).toBe('The address of the model must start with http:// or https://.');
  });

  it('checks an attached voice model too', () => {
    const voice = { baseUrl: 'http://127.0.0.1:8000/v1', transcription: 'whisper-1', speech: null, speechVoice: 'alloy' };

    expect(assistantSettingsProblem({ ...ready, voice })).toBeNull();
    expect(assistantSettingsProblem({ ...ready, voice: { ...voice, transcription: '' } })).toBe('Name the voice model that turns speech into text.');
    expect(assistantSettingsProblem({ ...ready, voice: { ...voice, baseUrl: 'ftp://x' } })).toBe(
      'The address of the voice model must start with http:// or https://.'
    );
  });
});

describe('the credential names of the assistant', () => {
  it('keeps the chat key and the voice key apart, and apart from every server key', () => {
    expect(assistantKeyId('chat')).toBe('assistant-chat');
    expect(assistantKeyId('voice')).toBe('assistant-voice');
  });

  it('refuses a slot that is not one of the two', () => {
    expect(() => assistantKeyId('server' as never)).toThrow('"server" is not a key of the assistant.');
  });
});
