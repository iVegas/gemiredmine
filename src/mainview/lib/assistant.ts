// Asking the assistant: the calls that answer a question in one of the user's chats (chats.ts), or turn speech into
// words and words into speech. The model and the voice are reached through the app's HTTP client, and the tools are the
// ones of the MCP endpoint, so a change the assistant proposes waits in the approval notice like any other.

import { get } from 'svelte/store';
import { TOOLS } from '../../bun/mcp/tools';
import { ask } from '../../bun/assistant/chat';
import { transcribe, speak } from '../../bun/assistant/voice';
import type { FetchLike } from '../../bun/redmine/client';
import { assistantSettingsProblem, isOnDeviceProvider, type AssistantSettings } from '../../shared/assistant';
import { buildInfo } from '../../shared/build-info.generated';
import { redmineApi } from './api';
import { hasDesktopBackend } from './bridge';
import { chatById, titleFrom, updateChat, NEW_CHAT_TITLE } from './chats';
import { storeHost } from './mcp-host';
import { activeProject } from './store';
import { askOnDevice } from './on-device-ai';
import { tauriFetch } from './tauri-platform';

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
 * Asks the assistant in one chat. Resolves true when it answered, and false when the question could not be asked; the
 * reason is then on the chat, for its own window to show. The question stays in the chat either way, so the user can
 * see what was asked. Each chat waits for its own answer only: another chat can be asked at the same time.
 */
export async function askAssistant(chatId: string, question: string): Promise<boolean> {
  const text = question.trim();
  const chat = chatById(chatId);
  if (!text || !chat || chat.asking) return false;

  // A chat takes its name from the first question asked in it.
  updateChat(chatId, (current) => ({
    asking: true,
    error: null,
    draft: '',
    title: current.title === NEW_CHAT_TITLE ? titleFrom(text) : current.title,
    messages: [...current.messages, { role: 'user', content: text }],
  }));
  try {
    const settings = await usableSettings();
    const asked = chatById(chatId);
    if (!asked) return false;
    if (isOnDeviceProvider(settings.provider)) {
      // The device's own model is prompted in the webview, and it answers without the tools: it reads no Redmine data.
      const answer = await askOnDevice(asked.messages);
      updateChat(chatId, (current) => ({ messages: [...current.messages, { role: 'assistant', content: answer, toolCalls: [] }] }));
      return true;
    }
    const result = await ask({
      settings,
      apiKey: await redmineApi.loadAssistantKey('chat'),
      conversation: asked.messages,
      tools: TOOLS,
      deps: { host: storeHost, api: redmineApi, version: buildInfo.version },
      fetch: httpFetch,
      project: get(activeProject),
    });
    updateChat(chatId, { messages: result.conversation });
    return true;
  } catch (error) {
    updateChat(chatId, { error: sentence(error) });
    return false;
  } finally {
    updateChat(chatId, { asking: false });
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
