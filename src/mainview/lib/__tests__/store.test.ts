import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { servers, activeServerId, addServer } from '../store';

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
});
