import { writable } from 'svelte/store';

/**
 * Counts the writes this window has made to Redmine: time entries and tasks, whether the user saved them or an approved
 * agent change did. A view reads Redmine when it mounts, and open tabs stay mounted, so without this count a change made
 * elsewhere in the window (such as an approval in the notice) would not show until the view was opened again.
 */
export const redmineChanges = writable(0);

/** Records one successful write. Called by the API wrapper, so every write counts. */
export function noteRedmineChange(): void {
  redmineChanges.update((count) => count + 1);
}
