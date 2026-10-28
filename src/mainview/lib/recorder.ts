// Records the microphone for voice input. The webview decides whether it can: Linux's WebKit may have no recorder, and then
// the caller says so instead of failing without a reason.

/**
 * What the user is told when the microphone cannot be opened. The system's own reason decides the sentence: a missing
 * device, a refused permission, and anything else each need a different fix.
 */
export function microphoneProblem(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect one, then try again.';
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'The app may not use the microphone. Allow the microphone for Gemiredmine in the system’s settings, then try again. A Flatpak app needs audio access, which the bundle asks for.';
  }
  return `The microphone could not be started${name ? ` (${name})` : ''}. Type the message instead.`;
}

/** What a window without a recorder is told. The caller stops offering voice input once it has seen this. */
export const NO_RECORDER = 'This window cannot record sound, so voice input is not available here. Type the message instead.';

/**
 * This window has no recorder at all. It is its own kind of error because it never gets better in this window: the
 * caller hides the voice input rather than letting the user try again.
 */
export class RecordingUnsupportedError extends Error {
  constructor() {
    super(NO_RECORDER);
    this.name = 'RecordingUnsupportedError';
  }
}

/**
 * Starts recording. The returned function stops the recording and gives what was said, as a Blob. Rejects with a sentence
 * for the user when this window cannot record, or when the microphone cannot be opened.
 */
export async function startRecording(): Promise<() => Promise<Blob>> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new RecordingUnsupportedError();
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw new Error(microphoneProblem(error));
  }

  // WebKitGTK has the class but no recorder behind it: making one throws "The MediaRecorder is unsupported on this
  // platform". The microphone is already open by then, so it is released before the caller is told.
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new RecordingUnsupportedError();
  }

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
