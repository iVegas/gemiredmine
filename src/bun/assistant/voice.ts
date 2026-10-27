// The voice model the user attached: speech into text, and a reply out as speech. Both are OpenAI-compatible requests, so
// the same server can serve them, and so can a local one. Portable: the caller gives the HTTP client and the key.

import type { VoiceModel } from '../../shared/assistant';
import type { FetchLike } from '../redmine/client';
import { describeFailure } from './providers';

/** The text of a recording. The file name matters to some servers, which read the format from it. */
export async function transcribe(audio: Blob, voice: VoiceModel, apiKey: string | null, fetch: FetchLike): Promise<string> {
  const form = new FormData();
  form.append('file', audio, 'speech.webm');
  form.append('model', voice.transcription);
  const response = await fetch(`${address(voice)}/audio/transcriptions`, {
    method: 'POST',
    // No content type here: the form sets it, with the boundary of its parts.
    headers: authorization(apiKey),
    body: form,
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  const reply: unknown = await response.json();
  if (typeof reply !== 'object' || reply === null || typeof (reply as { text?: unknown }).text !== 'string') {
    throw new Error('The voice model answered in a format the app does not read.');
  }
  return (reply as { text: string }).text.trim();
}

/** The reply read aloud, as the audio the speech model made. Rejects when no speech model is attached. */
export async function speak(text: string, voice: VoiceModel, apiKey: string | null, fetch: FetchLike): Promise<Blob> {
  if (voice.speech === null) throw new Error('No speech model is attached, so the replies stay on screen.');
  const response = await fetch(`${address(voice)}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authorization(apiKey) },
    body: JSON.stringify({ model: voice.speech, input: text, voice: voice.speechVoice }),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  return response.blob();
}

const address = (voice: VoiceModel) => voice.baseUrl.replace(/\/+$/, '');

const authorization = (apiKey: string | null): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});
