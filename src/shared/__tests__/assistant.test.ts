import { describe, it, expect } from 'vitest';
import {
  ASSISTANT_PROVIDER_INFO,
  assistantKeyId,
  assistantSettingsFrom,
  assistantSettingsProblem,
  assistantSetupFrom,
  assistantSetupLink,
  DEFAULT_SPEECH_VOICE,
  isOnDeviceProvider,
  type AssistantSettings,
} from '../assistant';

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

describe('the model on the device', () => {
  const onDevice: AssistantSettings = { provider: 'on-device', baseUrl: '', model: '', voice: null };

  it('is the one service with no address and no key to fill in', () => {
    expect(isOnDeviceProvider('on-device')).toBe(true);
    expect(isOnDeviceProvider('gemini')).toBe(false);
    expect(ASSISTANT_PROVIDER_INFO['on-device'].key).toBe('none');
    expect(ASSISTANT_PROVIDER_INFO['on-device'].baseUrl).toBe('');
  });

  it('can be used without an address or a model, and is still checked for its voice model', () => {
    expect(assistantSettingsProblem(onDevice)).toBeNull();
    expect(
      assistantSettingsProblem({ ...onDevice, voice: { baseUrl: 'nowhere', transcription: 'whisper-1', speech: null, speechVoice: 'alloy' } })
    ).toBe('The address of the voice model must start with http:// or https://.');
  });

  it('keeps its empty address when the settings are read back', () => {
    expect(assistantSettingsFrom({ provider: 'on-device' })).toEqual(onDevice);
  });
});

describe('each service in the settings screen', () => {
  it('says where its key comes from, or that it needs none', () => {
    expect(ASSISTANT_PROVIDER_INFO.gemini.keyPage).toBe('https://aistudio.google.com/apikey');
    expect(ASSISTANT_PROVIDER_INFO.gemini.keyPageName).toBe('Google AI Studio');
    expect(ASSISTANT_PROVIDER_INFO.anthropic.key).toBe('required');
    expect(ASSISTANT_PROVIDER_INFO['openai-compatible'].key).toBe('optional');
  });
});

describe('a setup link', () => {
  const settings: AssistantSettings = {
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    voice: null,
  };

  it('carries the service, the address and the model, and never a key', () => {
    const link = assistantSetupLink({ ...settings, voice: { baseUrl: 'http://127.0.0.1:8000/v1', transcription: 'whisper-1', speech: 'tts-1', speechVoice: 'alloy' } });

    expect(link).toBe(
      'gemiredmine://assistant?provider=gemini&address=https%3A%2F%2Fgenerativelanguage.googleapis.com%2Fv1beta&model=gemini-2.5-flash' +
        '&voiceAddress=http%3A%2F%2F127.0.0.1%3A8000%2Fv1&voiceTranscription=whisper-1&voiceSpeech=tts-1&voiceSpeechVoice=alloy'
    );
    expect(link).not.toContain('key');
  });

  it('is read back as the same settings', () => {
    expect(assistantSetupFrom(assistantSetupLink(settings))).toEqual({ settings, key: null });
  });

  it('hands over a key that somebody put in it on purpose', () => {
    expect(assistantSetupFrom('gemiredmine://assistant?provider=gemini&model=gemini-2.5-flash&key=AIza-1').key).toBe('AIza-1');
  });

  it('reads the settings in JSON too, with either name for the address', () => {
    expect(assistantSetupFrom('{"provider":"anthropic","baseUrl":"https://api.anthropic.com/v1","model":"claude-sonnet-5-5"}').settings).toEqual({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
      voice: null,
    });
    expect(assistantSetupFrom('{"provider":"gemini","address":"https://g/v1","model":"m","apiKey":"k"}')).toEqual({
      settings: { provider: 'gemini', baseUrl: 'https://g/v1', model: 'm', voice: null },
      key: 'k',
    });
  });

  it('reads an attached voice model out of a link', () => {
    const setup = assistantSetupFrom(
      'gemiredmine://assistant?provider=on-device&voiceAddress=http://127.0.0.1:8000/v1&voiceTranscription=whisper-1'
    );

    expect(setup.settings.voice).toEqual({
      baseUrl: 'http://127.0.0.1:8000/v1',
      transcription: 'whisper-1',
      speech: null,
      speechVoice: DEFAULT_SPEECH_VOICE,
    });
  });

  it('refuses anything that is not a setup, and a service the app does not have', () => {
    for (const text of ['', 'hello', 'https://example.com/?provider=gemini', '{"model":"m"}', '{not json}']) {
      expect(() => assistantSetupFrom(text)).toThrow('That is not a setup link for the assistant.');
    }
    expect(() => assistantSetupFrom('gemiredmine://assistant?provider=mistral')).toThrow('"mistral" is not a service this app can use.');
  });
});
