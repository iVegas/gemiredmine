// The AI assistant of the app: the model that chats with the user and calls the same tools as the MCP endpoint, and the
// optional voice model that turns speech into text and replies into speech. The settings are the same for the backend
// that keeps them and the screen that changes them, so the rules are written once, here.

/** The kinds of model service the assistant can talk to. */
export const ASSISTANT_PROVIDERS = ['openai-compatible', 'anthropic', 'gemini'] as const;
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number];

/** What the settings screen calls each service, and the address it starts from. */
export const ASSISTANT_PROVIDER_INFO: Record<AssistantProvider, { label: string; baseUrl: string }> = {
  'openai-compatible': {
    label: 'OpenAI-compatible (OpenAI, Lemonade, Ollama, LM Studio)',
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
};

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
  /** The address of the service, without the path. Local servers have their own address. */
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
  if (!isHttpUrl(settings.baseUrl)) return 'The address of the model must start with http:// or https://.';
  if (!settings.model.trim()) return 'Name the model that should answer.';
  const voice = settings.voice;
  if (!voice) return null;
  if (!isHttpUrl(voice.baseUrl)) return 'The address of the voice model must start with http:// or https://.';
  if (!voice.transcription.trim()) return 'Name the voice model that turns speech into text.';
  if (voice.speech !== null && !voice.speechVoice.trim()) return 'Name the voice the replies are read in.';
  return null;
}
