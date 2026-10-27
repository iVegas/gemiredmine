import { describe, it, expect, vi } from 'vitest';
import { speak, transcribe } from '../assistant/voice';
import type { VoiceModel } from '../../shared/assistant';

const voice: VoiceModel = { baseUrl: 'http://127.0.0.1:8000/v1/', transcription: 'whisper-1', speech: 'tts-1', speechVoice: 'alloy' };

describe('speech into text', () => {
  it('uploads the recording to the transcription model of the attached server, with the key', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ text: '  Log one hour.  ' }), { status: 200 }));

    const text = await transcribe(new Blob(['audio'], { type: 'audio/webm' }), voice, 'secret', fetch);

    expect(text).toBe('Log one hour.');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8000/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    // The form sets its own content type, with the boundary of its parts, so the app must not set one.
    expect(init.headers).not.toHaveProperty('content-type');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('refuses an answer without text, in one sentence', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(transcribe(new Blob(), voice, null, fetch)).rejects.toThrow('The voice model answered in a format the app does not read.');
  });

  it('says a refused key for the voice model, not the chat model', async () => {
    const fetch = vi.fn(async () => new Response('denied', { status: 403 }));

    await expect(transcribe(new Blob(), voice, 'wrong', fetch)).rejects.toThrow('The model service refused the API key.');
  });
});

describe('replies read aloud', () => {
  it('asks the speech model for the audio of the text, in the chosen voice', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));

    const result = await speak('Done.', voice, 'secret', fetch);

    expect(result.size).toBe(3);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8000/v1/audio/speech');
    expect(JSON.parse(String(init.body))).toEqual({ model: 'tts-1', input: 'Done.', voice: 'alloy' });
  });

  it('sends nothing when no speech model is attached, so the replies stay on screen', async () => {
    const fetch = vi.fn();

    await expect(speak('Done.', { ...voice, speech: null }, null, fetch)).rejects.toThrow('No speech model is attached');
    expect(fetch).not.toHaveBeenCalled();
  });
});
