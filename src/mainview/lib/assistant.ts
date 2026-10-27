// The assistant in the main window: the conversation the user sees, and the calls that answer a question or read a reply
// aloud. The model and the voice are reached through the app's HTTP client, and the tools are the ones of the MCP
// endpoint, so a change the assistant proposes waits in the approval notice like any other.

import { get, writable } from 'svelte/store';
import { TOOLS } from '../../bun/mcp/tools';
import { ask } from '../../bun/assistant/chat';
import { transcribe, speak } from '../../bun/assistant/voice';
import type { ChatMessage } from '../../bun/assistant/providers';
import type { FetchLike } from '../../bun/redmine/client';
import { assistantSettingsProblem, type AssistantSettings } from '../../shared/assistant';
import { buildInfo } from '../../shared/build-info.generated';
import { redmineApi } from './api';
import { hasDesktopBackend } from './bridge';
import { storeHost } from './mcp-host';
import { tauriFetch } from './tauri-platform';

/** The conversation, as the assistant view shows it. It lasts while the app runs; it is not saved. */
export const conversation = writable<ChatMessage[]>([]);

/** Whether a question is being answered, so that a second one waits its turn. */
export const asking = writable(false);

/** The last problem, in a sentence for the user, or null. */
export const assistantError = writable<string | null>(null);

/**
 * The desktop app sends the model's requests through its own HTTP client, which is not limited by the webview's cross-origin
 * rules; a browser has none, so it uses the browser's.
 */
const httpFetch: FetchLike = (url, init) => (hasDesktopBackend() ? tauriFetch(url, init) : fetch(url, init));

const sentence = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The settings, when they can be used. Otherwise the reason, as the settings screen words it. */
async function usableSettings(): Promise<AssistantSettings> {
  const settings = await redmineApi.getAssistantSettings();
  const problem = assistantSettingsProblem(settings);
  if (problem) throw new Error(`${problem} Set up the assistant in Settings.`);
  return settings;
}

/**
 * Asks the assistant. Resolves true when it answered, and false when the question could not be asked; the reason is then
 * in `assistantError`. The question stays in the conversation either way, so the user can see what was asked.
 */
export async function askAssistant(question: string): Promise<boolean> {
  const text = question.trim();
  if (!text || get(asking)) return false;

  assistantError.set(null);
  asking.set(true);
  conversation.update((messages) => [...messages, { role: 'user', content: text }]);
  try {
    const settings = await usableSettings();
    const result = await ask({
      settings,
      apiKey: await redmineApi.loadAssistantKey('chat'),
      conversation: get(conversation),
      tools: TOOLS,
      deps: { host: storeHost, api: redmineApi, version: buildInfo.version },
      fetch: httpFetch,
    });
    conversation.set(result.conversation);
    return true;
  } catch (error) {
    assistantError.set(sentence(error));
    return false;
  } finally {
    asking.set(false);
  }
}

/** The words of a recording, from the attached voice model. */
export async function transcribeSpeech(audio: Blob): Promise<string> {
  const settings = await usableSettings();
  if (!settings.voice) throw new Error('No voice model is attached. Attach one in Settings.');
  return transcribe(audio, settings.voice, await redmineApi.loadAssistantKey('voice'), httpFetch);
}

/** Reads a reply aloud, when the attached voice model has a speech model. Otherwise it does nothing. */
export async function readAloud(text: string): Promise<void> {
  const settings = await usableSettings();
  if (!settings.voice?.speech) return;
  const audio = await speak(text, settings.voice, await redmineApi.loadAssistantKey('voice'), httpFetch);
  const url = URL.createObjectURL(audio);
  const player = new Audio(url);
  player.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  await player.play();
}
