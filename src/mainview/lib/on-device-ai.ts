// The model the device carries itself. Recent webviews offer a built-in model through the Prompt API: on Android that
// is Gemini Nano through the system's AICore, and on the desktop the browser's own built-in model. It needs no API key,
// no server and no network, and the system keeps it up to date, so nothing is downloaded with the app.
//
// What it cannot do is call the app's tools, so it answers from the conversation alone and never reads Redmine. The
// settings screen says so where it is offered, and the system prompt below tells the model to say so too.

import type { ChatMessage } from '../../bun/assistant/providers';

/** What the device says about its model. `missing` means this webview has no built-in model at all. */
export type OnDeviceState = 'missing' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface PromptSession {
  prompt(text: string): Promise<string>;
  destroy?(): void;
}

interface PromptTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The part of the Prompt API this app uses, as the webviews that have it offer it. */
interface PromptApi {
  /** The current webviews: one of the states above, without `missing`. */
  availability?(): Promise<string>;
  /** The earlier shape of the same question. */
  capabilities?(): Promise<{ available?: string }>;
  create(options?: { initialPrompts?: PromptTurn[] }): Promise<PromptSession>;
}

/**
 * The built-in model of this webview, or null where there is none. Both spellings are accepted: `LanguageModel` is the
 * current one, `window.ai.languageModel` the one the first webviews shipped.
 */
export function promptApi(): PromptApi | null {
  if (typeof window === 'undefined') return null;
  const global = window as unknown as { LanguageModel?: PromptApi; ai?: { languageModel?: PromptApi } };
  const api = global.LanguageModel ?? global.ai?.languageModel;
  return api && typeof api.create === 'function' ? api : null;
}

/** The older states, as the current ones. */
const STATES: Record<string, OnDeviceState> = {
  readily: 'available',
  available: 'available',
  'after-download': 'downloadable',
  downloadable: 'downloadable',
  downloading: 'downloading',
  no: 'unavailable',
  unavailable: 'unavailable',
};

/** Whether this device can answer by itself, and whether the model has to be fetched by the system first. */
export async function onDeviceState(): Promise<OnDeviceState> {
  const api = promptApi();
  if (!api) return 'missing';
  try {
    if (api.availability) return STATES[await api.availability()] ?? 'unavailable';
    if (api.capabilities) return STATES[(await api.capabilities()).available ?? ''] ?? 'unavailable';
  } catch {
    // A webview that has the API but refuses to say is treated as not having a model to offer.
    return 'unavailable';
  }
  return 'unavailable';
}

/** What the state means, for the settings screen. Null when there is nothing to offer. */
export function onDeviceStateText(state: OnDeviceState): string | null {
  switch (state) {
    case 'available':
      return 'This device can answer by itself, with no key and no network.';
    case 'downloadable':
      return 'This device can answer by itself once the system has fetched the model, which happens at the first question.';
    case 'downloading':
      return 'The system is fetching the model for this device. It can answer once that is done.';
    default:
      return null;
  }
}

export const ON_DEVICE_SYSTEM_PROMPT = [
  'You are the assistant of Gemiredmine, an app that shows the user’s Redmine tasks and time.',
  'You run on the user’s own device and cannot read their Redmine servers, tasks or time: answer from what the user writes in this conversation.',
  'When a question needs data from Redmine, say that the on-device model cannot read it and that a model service set up in Settings can.',
  'Answer briefly, in the language the user writes in.',
].join(' ');

/** The conversation as the Prompt API takes it. Tool results cannot occur: the on-device model is asked without tools. */
function turnsFrom(conversation: ChatMessage[]): PromptTurn[] {
  return conversation
    .filter((message): message is Extract<ChatMessage, { role: 'user' | 'assistant' }> => message.role !== 'tool')
    .map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Asks the device's own model the last question of the conversation. The turns before it are given to the session, so
 * the model has the conversation; the answer is its text.
 */
export async function askOnDevice(conversation: ChatMessage[]): Promise<string> {
  const api = promptApi();
  if (!api) throw new Error('This device has no built-in model. Choose a model service in Settings.');
  const turns = turnsFrom(conversation);
  const question = turns.pop();
  if (!question || question.role !== 'user') throw new Error('There is no question for the model on this device.');

  const session = await api.create({ initialPrompts: [{ role: 'system', content: ON_DEVICE_SYSTEM_PROMPT }, ...turns] });
  try {
    return await session.prompt(question.content);
  } finally {
    session.destroy?.();
  }
}
