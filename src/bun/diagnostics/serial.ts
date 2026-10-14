/**
 * Runs async tasks one after another. The synchronous file calls this replaces could never
 * interleave; async ones can, and a log append that rotates the files must not.
 * A task that fails does not stop the ones queued behind it.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}
