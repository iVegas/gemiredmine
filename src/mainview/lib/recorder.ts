// Records the microphone for voice input. The webview decides whether it can: Linux's WebKit may have no recorder, and then
// the caller says so instead of failing without a reason.

/**
 * Starts recording. The returned function stops the recording and gives what was said, as a Blob. Rejects with a sentence
 * for the user when this window cannot record, or when the user does not allow the microphone.
 */
export async function startRecording(): Promise<() => Promise<Blob>> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('This window cannot record sound, so voice input is not available here. Type the message instead.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('The microphone is not available. Allow it for Gemiredmine, then try again.');
  }

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.start();

  return async () => {
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  };
}
