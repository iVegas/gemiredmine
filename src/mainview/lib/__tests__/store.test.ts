import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { servers, activeServerId, activeServer, addServer, updateServer, removeServer, remembersSignIn } from '../store';
import { openLogEntry, openTask, openViews, resetViews } from '../views';

describe('Server Store', () => {
  beforeEach(() => {
    servers.set([]);
    activeServerId.set(null);
  });

  it('should add a new server with a generated id', () => {
    addServer({
      name: 'Test Server',
      url: 'https://test.redmine.com'
    });

    const currentServers = get(servers);
    expect(currentServers).toHaveLength(1);
    expect(currentServers[0].name).toBe('Test Server');
    expect(currentServers[0].url).toBe('https://test.redmine.com');
    expect(currentServers[0].id).toBeDefined();
  });

  it('should auto-select the first added server', () => {
    addServer({
      name: 'Server 1',
      url: 'https://1.com'
    });

    const currentServers = get(servers);
    const activeId = get(activeServerId);

    expect(activeId).toBe(currentServers[0].id);

    // Add second server, shouldn't change active server
    addServer({
      name: 'Server 2',
      url: 'https://2.com'
    });

    expect(get(activeServerId)).toBe(currentServers[0].id);
  });

  it('updates a server in place', () => {
    const id = addServer({ name: 'Dev', url: 'https://dev.local' });

    updateServer(id, { apiToken: 'key', user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'K' } });

    expect(get(servers)[0]).toMatchObject({ id, name: 'Dev', apiToken: 'key', user: { login: 'ana' } });
  });

  it('removes a server and keeps the active selection when another server was removed', () => {
    const first = addServer({ name: 'One', url: 'https://1.com' });
    const second = addServer({ name: 'Two', url: 'https://2.com' });

    removeServer(second);

    expect(get(servers).map(s => s.id)).toEqual([first]);
    expect(get(activeServerId)).toBe(first);
  });

  it('moves the selection to the first remaining server when the active one is removed', () => {
    const first = addServer({ name: 'One', url: 'https://1.com' });
    const second = addServer({ name: 'Two', url: 'https://2.com' });
    activeServerId.set(second);

    removeServer(second);

    expect(get(activeServerId)).toBe(first);
  });

  it('clears the selection when the last server is removed', () => {
    const only = addServer({ name: 'Only', url: 'https://only.com' });

    removeServer(only);

    expect(get(servers)).toHaveLength(0);
    expect(get(activeServerId)).toBeNull();
  });

  it('derives the active server object', () => {
    const id = addServer({ name: 'Dev', url: 'https://dev.local' });

    expect(get(activeServer)?.id).toBe(id);
    activeServerId.set(null);
    expect(get(activeServer)).toBeNull();
  });

  it('closes the tasks and log entries that were open of a server that is removed, and only of that one', () => {
    resetViews();
    const keep = addServer({ name: 'Keep', url: 'https://keep.com' });
    const drop = addServer({ name: 'Drop', url: 'https://drop.com' });
    openTask(drop, 1);
    openLogEntry(drop, 2);
    openTask(keep, 3);

    removeServer(drop);

    expect(get(openViews)).toEqual(['dashboard', `task:${keep}:3`]);
  });

  it('remembers the server by default, and keeps the choice not to', () => {
    const id = addServer({ name: 'Test', url: 'https://t.com' });
    expect(remembersSignIn(get(servers)[0])).toBe(true);

    updateServer(id, { remember: false });
    expect(remembersSignIn(get(servers)[0])).toBe(false);

    updateServer(id, { remember: true });
    expect(remembersSignIn(get(servers)[0])).toBe(true);
  });
});
