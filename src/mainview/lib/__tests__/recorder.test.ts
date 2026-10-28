import { describe, it, expect, vi, afterEach } from 'vitest';
import { NO_RECORDER, RecordingUnsupportedError, microphoneProblem, startRecording } from '../recorder';

/** The browser's microphone and recorder, as far as the recorder uses them. */
function stubMicrophone(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal(
    'MediaRecorder',
    class {
      mimeType = 'audio/webm';
      addEventListener() {}
      start() {}
      stop() {}
    }
  );
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
}

/** An error as the browser makes it: a DOMException with a name. */
const failure = (name: string) => Object.assign(new Error(`${name} from the system`), { name });

describe('the reason a microphone cannot be used', () => {
  it('says there is no microphone when none is found', () => {
    expect(microphoneProblem(failure('NotFoundError'))).toBe('No microphone was found. Connect one, then try again.');
  });

  it('says the app may not use the microphone when the system refuses it', () => {
    expect(microphoneProblem(failure('NotAllowedError'))).toContain('The app may not use the microphone.');
  });

  it('names any other reason, and offers the typed message', () => {
    expect(microphoneProblem(failure('OverconstrainedError'))).toBe(
      'The microphone could not be started (OverconstrainedError). Type the message instead.'
    );
    expect(microphoneProblem('something')).toBe('The microphone could not be started. Type the message instead.');
  });
});

describe('starting a recording', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it('gives the reason from the system, not a guess of its own', async () => {
    stubMicrophone(async () => {
      throw failure('NotFoundError');
    });

    await expect(startRecording()).rejects.toThrow('No microphone was found. Connect one, then try again.');
  });

  it('says so when the window has no recorder at all', async () => {
    vi.stubGlobal('MediaRecorder', undefined);

    await expect(startRecording()).rejects.toThrow('This window cannot record sound');
  });
});

describe('a window whose recorder is only a name', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says voice input is not available, and releases the microphone it had opened', async () => {
    const track = { stop: vi.fn() };
    stubMicrophone(async () => ({ getTracks: () => [track] }));
    // WebKitGTK has the class but throws when one is made.
    vi.stubGlobal(
      'MediaRecorder',
      class {
        constructor() {
          throw new TypeError('The MediaRecorder is unsupported on this platform');
        }
      }
    );

    await expect(startRecording()).rejects.toThrow(NO_RECORDER);
    await expect(startRecording()).rejects.toBeInstanceOf(RecordingUnsupportedError);
    expect(track.stop).toHaveBeenCalledTimes(2);
  });

  it('says the same where there is no recorder at all', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
    vi.stubGlobal('MediaRecorder', undefined);

    await expect(startRecording()).rejects.toBeInstanceOf(RecordingUnsupportedError);
  });
});
