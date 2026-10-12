import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Sidebar from '../Sidebar.svelte';
import { get } from 'svelte/store';
import { servers, activeServerId } from '../lib/store';

describe('Sidebar Component', () => {
  beforeEach(() => {
    servers.set([]);
    activeServerId.set(null);
  });

  it('renders "No servers added yet" when store is empty', () => {
    const { getByText } = render(Sidebar, { props: { onAddServerClick: vi.fn() } });
    expect(getByText('No servers added yet.')).toBeInTheDocument();
  });

  it('renders a list of servers', () => {
    servers.set([
      { id: '1', name: 'Dev Server', url: 'https://dev.local' },
      { id: '2', name: 'Prod Server', url: 'https://prod.local' }
    ]);

    const { getByText } = render(Sidebar, { props: { onAddServerClick: vi.fn() } });

    expect(getByText('Dev Server')).toBeInTheDocument();
    expect(getByText('https://dev.local')).toBeInTheDocument();
    expect(getByText('Prod Server')).toBeInTheDocument();
    expect(getByText('https://prod.local')).toBeInTheDocument();
  });

  it('calls onAddServerClick when Add Server button is clicked', async () => {
    const onAddServerClick = vi.fn();
    const { getByText } = render(Sidebar, { props: { onAddServerClick } });

    const button = getByText('+ Add Server');
    await fireEvent.click(button);

    expect(onAddServerClick).toHaveBeenCalled();
  });

  it('shows the sign-in state of each server', () => {
    servers.set([
      { id: '1', name: 'Dev Server', url: 'https://dev.local', apiToken: 'k', user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'K' } },
      { id: '2', name: 'Prod Server', url: 'https://prod.local' }
    ]);

    const { getByText } = render(Sidebar, { props: { onAddServerClick: vi.fn() } });

    expect(getByText('Signed in as ana')).toBeInTheDocument();
    expect(getByText('Not signed in')).toBeInTheDocument();
  });

  it('removes a server when its remove button is clicked', async () => {
    servers.set([
      { id: '1', name: 'Dev Server', url: 'https://dev.local' },
      { id: '2', name: 'Prod Server', url: 'https://prod.local' }
    ]);
    activeServerId.set('1');

    const { getByLabelText, queryByText } = render(Sidebar, { props: { onAddServerClick: vi.fn() } });
    await fireEvent.click(getByLabelText('Remove Dev Server'));

    expect(queryByText('Dev Server')).not.toBeInTheDocument();
    expect(get(servers).map(s => s.id)).toEqual(['2']);
    expect(get(activeServerId)).toBe('2');
  });

  it('selects a server when it is clicked', async () => {
    servers.set([
      { id: '1', name: 'Dev Server', url: 'https://dev.local' },
      { id: '2', name: 'Prod Server', url: 'https://prod.local' }
    ]);
    activeServerId.set('1');

    const { getByText } = render(Sidebar, { props: { onAddServerClick: vi.fn() } });
    await fireEvent.click(getByText('Prod Server'));

    expect(get(activeServerId)).toBe('2');
  });
});

