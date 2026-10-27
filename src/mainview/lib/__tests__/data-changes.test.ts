import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { redmineApi } from '../api';
import { redmineChanges } from '../data-changes';

const fake = vi.hoisted(() => ({
  createLogEntry: vi.fn(),
  updateLogEntry: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('../bridge', () => ({ backend: () => fake }));

const access = { baseUrl: 'https://dev.local', apiKey: 'key' };

// The writes that change what the views show. An approved agent change goes through the same functions.
describe('the writes that change Redmine data', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redmineChanges.set(0);
  });

  it.each([
    ['createLogEntry', () => redmineApi.createLogEntry(access, {} as Parameters<typeof redmineApi.createLogEntry>[1])],
    ['updateLogEntry', () => redmineApi.updateLogEntry(access, 1, {} as Parameters<typeof redmineApi.updateLogEntry>[2])],
    ['updateTask', () => redmineApi.updateTask(access, 1, {} as Parameters<typeof redmineApi.updateTask>[2])],
  ])('count as one change when %s succeeds, and return what the backend returned', async (name, call) => {
    fake[name as keyof typeof fake].mockResolvedValue({ id: 7 });

    await expect(call()).resolves.toEqual({ id: 7 });
    expect(get(redmineChanges)).toBe(1);
  });

  it('do not count when the write fails, since nothing changed in Redmine', async () => {
    fake.createLogEntry.mockRejectedValue(new Error('Redmine API request failed: 422 Unprocessable Entity'));

    await expect(redmineApi.createLogEntry(access, {} as Parameters<typeof redmineApi.createLogEntry>[1])).rejects.toThrow('422');
    expect(get(redmineChanges)).toBe(0);
  });
});
