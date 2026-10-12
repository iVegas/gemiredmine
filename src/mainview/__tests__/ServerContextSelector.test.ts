import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ServerContextSelector from '../ServerContextSelector.svelte';
import { servers, activeServerId } from '../lib/store';

const signedIn = { id: '1', name: 'Dev', url: 'https://dev.local', apiToken: 'k', user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'K' } };
const signedOut = { id: '2', name: 'Prod', url: 'https://prod.local' };

describe('ServerContextSelector Component', () => {
  beforeEach(() => {
    servers.set([signedIn, signedOut]);
    activeServerId.set('1');
  });

  it('lists the configured servers with the active one selected', () => {
    const { getByLabelText } = render(ServerContextSelector);
    const select = getByLabelText('Server context') as HTMLSelectElement;

    expect(select.value).toBe('1');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Dev', 'Prod']);
  });

  it('switches the active server when a different one is chosen', async () => {
    const { getByLabelText } = render(ServerContextSelector);

    await fireEvent.change(getByLabelText('Server context'), { target: { value: '2' } });

    expect(get(activeServerId)).toBe('2');
  });

  it('offers sign out only for a signed-in server and clears its API key', async () => {
    const { getByText, queryByText } = render(ServerContextSelector);

    await fireEvent.click(getByText('Sign out'));

    expect(get(servers)[0]).toMatchObject({ id: '1', apiToken: undefined, user: undefined });
    expect(queryByText('Sign out')).not.toBeInTheDocument();
  });

  it('hides sign out when the active server is not signed in', () => {
    activeServerId.set('2');
    const { queryByText } = render(ServerContextSelector);

    expect(queryByText('Sign out')).not.toBeInTheDocument();
  });
});
