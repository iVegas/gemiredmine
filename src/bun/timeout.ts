/**
 * Runs `run` with an abort signal and gives up after `ms`. The timer is the authority: it rejects
 * with a message the user can act on, whatever shape the HTTP client's own abort error has (Bun
 * throws an AbortError, the desktop HTTP plugin an Error saying the request was cancelled).
 */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first: aborting makes `run` fail too, and the timeout message has to win that race.
      reject(new Error(`The Redmine server did not answer within ${ms / 1000} seconds.`));
      controller.abort();
    }, ms);
  });

  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}
