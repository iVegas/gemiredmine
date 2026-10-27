// The AI assistant of the app: the model that chats with the user and calls the same tools as the MCP endpoint, and the
// optional voice model that turns speech into text and replies into speech. The settings are the same for the backend
// that keeps them and the screen that changes them, so the rules are written once, here.

/** The kinds of model service the assistant can talk to. */
export const ASSISTANT_PROVIDERS = ['openai-compatible', 'anthropic', 'gemini', 'on-device'] as const;
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number];

/** The model the device runs itself: no address, no key and no model name to type. */
export const ON_DEVICE_PROVIDER: AssistantProvider = 'on-device';

export interface AssistantProviderInfo {
  /** What the settings screen calls the service. */
  label: string;
  /** The address the screen starts from. Empty for a service that has no address of its own. */
  baseUrl: string;
  /** Whether the service needs an API key, can use one, or has none at all. */
  key: 'required' | 'optional' | 'none';
  /** The page where the service hands out a key, or null. */
  keyPage: string | null;
  /** What that page is called, for the link's text. */
  keyPageName: string | null;
  /** Models the service is known for, offered as suggestions. The user may name another one. */
  models: readonly string[];
  /** Whether the device itself answers: nothing to set up, and the model reads nothing from Redmine. */
  onDevice: boolean;
}

/** What the settings screen calls each service, the address it starts from, and how it is paid for. */
export const ASSISTANT_PROVIDER_INFO: Record<AssistantProvider, AssistantProviderInfo> = {
  'openai-compatible': {
    label: 'OpenAI-compatible (OpenAI, Lemonade, Ollama, LM Studio)',
    baseUrl: 'https://api.openai.com/v1',
    key: 'optional',
    keyPage: 'https://platform.openai.com/api-keys',
    keyPageName: 'the OpenAI dashboard',
    models: [],
    onDevice: false,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    key: 'required',
    keyPage: 'https://console.anthropic.com/settings/keys',
    keyPageName: 'the Anthropic console',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    onDevice: false,
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    key: 'required',
    keyPage: 'https://aistudio.google.com/apikey',
    keyPageName: 'Google AI Studio',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    onDevice: false,
  },
  'on-device': {
    label: 'On this device (no key, no network)',
    baseUrl: '',
    key: 'none',
    keyPage: null,
    keyPageName: null,
    models: [],
    onDevice: true,
  },
};

/** Whether the device itself answers for these settings, so there is no address and no key to fill in. */
export const isOnDeviceProvider = (provider: AssistantProvider): boolean => ASSISTANT_PROVIDER_INFO[provider].onDevice;

/** The voice the replies are read in when the user names none. */
export const DEFAULT_SPEECH_VOICE = 'alloy';

/**
 * A voice model the user attached: an OpenAI-compatible server that turns speech into text and, when it has one, text
 * into speech. A local server, such as Lemonade or whisper.cpp, works the same way as OpenAI.
 */
export interface VoiceModel {
  /** The address of the server, without the path, such as http://127.0.0.1:8000/v1. */
  baseUrl: string;
  /** The model that turns speech into text, such as whisper-1. */
  transcription: string;
  /** The model that reads replies aloud, or null when replies stay on screen. */
  speech: string | null;
  /** The voice the speech model uses. */
  speechVoice: string;
}

export interface AssistantSettings {
  provider: AssistantProvider;
  /** The address of the service, without the path. Local servers have their own address; the on-device model has none. */
  baseUrl: string;
  /** The model that answers, such as claude-sonnet-5-5. The user names it; the app does not guess one. */
  model: string;
  /** The voice model the user attached, or null. Voice is offered only when one is attached. */
  voice: VoiceModel | null;
}

/** The setting's key in the app's storage. The API keys are not part of it: they are in the system's credential store. */
export const ASSISTANT_SETTINGS_KEY = 'assistant';

/** The two API keys: the one of the chat model, and the one of the voice model, which may be another service's. */
export const ASSISTANT_KEY_SLOTS = ['chat', 'voice'] as const;
export type AssistantKeySlot = (typeof ASSISTANT_KEY_SLOTS)[number];

/**
 * The name of a key in the credential store. Server ids are UUIDs, so these names cannot collide with a server's key.
 */
export function assistantKeyId(slot: AssistantKeySlot): string {
  if (!ASSISTANT_KEY_SLOTS.includes(slot)) throw new Error(`"${slot}" is not a key of the assistant.`);
  return `assistant-${slot}`;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

function voiceModelFrom(value: unknown): VoiceModel | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    transcription: typeof record.transcription === 'string' ? record.transcription : '',
    speech: typeof record.speech === 'string' && record.speech ? record.speech : null,
    speechVoice: typeof record.speechVoice === 'string' && record.speechVoice ? record.speechVoice : DEFAULT_SPEECH_VOICE,
  };
}

/** The settings as they were stored. Anything missing falls back to the first service, with no model and no voice. */
export function assistantSettingsFrom(value: unknown): AssistantSettings {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const provider = ASSISTANT_PROVIDERS.find((candidate) => candidate === record.provider) ?? 'openai-compatible';
  return {
    provider,
    baseUrl: typeof record.baseUrl === 'string' && record.baseUrl ? record.baseUrl : ASSISTANT_PROVIDER_INFO[provider].baseUrl,
    model: typeof record.model === 'string' ? record.model : '',
    voice: voiceModelFrom(record.voice),
  };
}

/** Why the settings cannot be used yet, written for the settings screen, or null when they can be saved and used. */
export function assistantSettingsProblem(settings: AssistantSettings): string | null {
  // The on-device model has no address and no name: the device answers with the model it carries.
  if (!isOnDeviceProvider(settings.provider)) {
    if (!isHttpUrl(settings.baseUrl)) return 'The address of the model must start with http:// or https://.';
    if (!settings.model.trim()) return 'Name the model that should answer.';
  }
  const voice = settings.voice;
  if (!voice) return null;
  if (!isHttpUrl(voice.baseUrl)) return 'The address of the voice model must start with http:// or https://.';
  if (!voice.transcription.trim()) return 'Name the voice model that turns speech into text.';
  if (voice.speech !== null && !voice.speechVoice.trim()) return 'Name the voice the replies are read in.';
  return null;
}

// --- What this computer is already set up for

/**
 * A model service this computer is already set up for, found without asking the user: a key in the environment or in
 * the configuration file of another tool, or the address of a local server. The settings screen offers to use it.
 */
export interface SystemAiSetup {
  provider: AssistantProvider;
  /** What was found: a key for the service, or the address of a server. */
  kind: 'key' | 'address';
  /** Where it was found, in words for the user, such as "the GEMINI_API_KEY environment variable". */
  source: string;
  /** The key or the address. A key is never shown on screen: the screen only offers to use it. */
  value: string;
}

// --- Setup links

/**
 * A setup link carries the settings of the assistant, so that one person can set the app up and the others paste a
 * line: `gemiredmine://assistant?provider=gemini&model=gemini-2.5-flash`. The app writes no key into a link it hands
 * out, but it reads a `key` that somebody added deliberately.
 */
export const ASSISTANT_SETUP_LINK_PREFIX = 'gemiredmine://assistant?';

export interface AssistantSetup {
  settings: AssistantSettings;
  /** The key the link carried, or null when it carried none. */
  key: string | null;
}

const NOT_A_SETUP =
  'That is not a setup link for the assistant. Paste a link that starts with gemiredmine://assistant, or the settings in JSON.';

/** The settings as a link to paste elsewhere. The API keys stay in the credential store and are never part of it. */
export function assistantSetupLink(settings: AssistantSettings): string {
  const fields = new URLSearchParams({ provider: settings.provider });
  if (settings.baseUrl) fields.set('address', settings.baseUrl);
  if (settings.model) fields.set('model', settings.model);
  const voice = settings.voice;
  if (voice) {
    fields.set('voiceAddress', voice.baseUrl);
    fields.set('voiceTranscription', voice.transcription);
    if (voice.speech) fields.set('voiceSpeech', voice.speech);
    fields.set('voiceSpeechVoice', voice.speechVoice);
  }
  return `${ASSISTANT_SETUP_LINK_PREFIX}${fields.toString()}`;
}

/** The fields of a pasted setup, from a link or from JSON. Null when the text is neither. */
function setupFieldsFrom(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const voice = typeof record.voice === 'object' && record.voice !== null ? (record.voice as Record<string, unknown>) : {};
    const fields: Record<string, unknown> = {
      provider: record.provider,
      address: record.address ?? record.baseUrl,
      model: record.model,
      key: record.key ?? record.apiKey,
      voiceAddress: voice.baseUrl ?? voice.address,
      voiceTranscription: voice.transcription,
      voiceSpeech: voice.speech,
      voiceSpeechVoice: voice.speechVoice,
    };
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'gemiredmine:') return null;
  return Object.fromEntries(url.searchParams.entries());
}

/**
 * The settings a pasted link or JSON asks for, ready to show in the form. Throws a sentence for the user when the text
 * is not a setup, or names a service the app does not have.
 */
export function assistantSetupFrom(text: string): AssistantSetup {
  const fields = setupFieldsFrom(text);
  if (!fields || !fields.provider) throw new Error(NOT_A_SETUP);
  const provider = ASSISTANT_PROVIDERS.find((candidate) => candidate === fields.provider);
  if (!provider) throw new Error(`"${fields.provider}" is not a service this app can use.`);
  const voiceAddress = fields.voiceAddress ?? '';
  const voiceTranscription = fields.voiceTranscription ?? '';
  return {
    settings: assistantSettingsFrom({
      provider,
      baseUrl: fields.address ?? '',
      model: fields.model ?? '',
      voice:
        voiceAddress || voiceTranscription
          ? {
              baseUrl: voiceAddress,
              transcription: voiceTranscription,
              speech: fields.voiceSpeech ?? null,
              speechVoice: fields.voiceSpeechVoice ?? DEFAULT_SPEECH_VOICE,
            }
          : null,
    }),
    key: fields.key ? fields.key : null,
  };
}
