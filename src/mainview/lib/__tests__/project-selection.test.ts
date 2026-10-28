import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { activeProject, activeServerId, projectSelection, removeServer, selectProject, servers } from '../store';

const dev = { id: 's1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' };
const prod = { id: 's2', name: 'Prod', url: 'https://prod.local', apiToken: 'key2' };
const shop = { id: 1, name: 'Shop' };
const internal = { id: 2, name: 'Internal' };
const KEY = 'gemiredmine.projects';

describe('Project selection', () => {
  beforeEach(() => {
    localStorage.clear();
    servers.set([dev, prod]);
    activeServerId.set('s1');
    projectSelection.set({});
  });

  it('shows every project until one is chosen', () => {
    expect(get(activeProject)).toBeNull();
  });

  it('shows the chosen project for the active server only', () => {
    selectProject('s1', shop);

    expect(get(activeProject)).toEqual(shop);
    activeServerId.set('s2');
    expect(get(activeProject)).toBeNull();
    activeServerId.set('s1');
    expect(get(activeProject)).toEqual(shop);
  });

  it('shows every project again when none is chosen', () => {
    selectProject('s1', shop);
    selectProject('s1', null);

    expect(get(activeProject)).toBeNull();
    expect(get(projectSelection)).toEqual({});
  });

  it('remembers the choice on this computer, and starts from it again', async () => {
    selectProject('s1', internal);
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({ s1: internal });

    // A new start of the app reads what the last one left.
    vi.resetModules();
    const again = await import('../store');
    expect(get(again.projectSelection)).toEqual({ s1: internal });
  });

  it('starts with every project when the remembered choice cannot be read', async () => {
    localStorage.setItem(KEY, '{"s1": "Shop"}');
    vi.resetModules();
    const again = await import('../store');

    expect(get(again.projectSelection)).toEqual({});
  });

  it('forgets the choice of a server that is removed', () => {
    selectProject('s1', shop);
    selectProject('s2', internal);

    removeServer('s1');

    expect(get(projectSelection)).toEqual({ s2: internal });
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({ s2: internal });
  });
});
