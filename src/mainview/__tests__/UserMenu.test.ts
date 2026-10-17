import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import UserMenu from '../UserMenu.svelte';
import { servers, activeServerId } from '../lib/store';
import { openViews, activeView, resetViews } from '../lib/views';

const signedIn = {
  id: '1',
  name: 'Dev',
  url: 'https://dev.local',
  apiToken: 'k',
  user: { id: 1, login: 'ana', firstname: 'Ana', lastname: 'Kova' },
};
const signedOut = { id: '2', name: 'Prod', url: 'https://prod.local' };

describe('UserMenu Component', () => {
  beforeEach(() => {
    servers.set([signedIn, signedOut]);
    activeServerId.set('1');
    resetViews();
  });

  const trigger = () => screen.getByRole('button', { name: /Ana Kova/ });

  it('shows who is signed in on which server', () => {
    render(UserMenu);

    expect(trigger()).toHaveAccessibleName('Ana Kova on Dev');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens above the cards of the dashboard, whose task rows are layered too', async () => {
    render(UserMenu);

    await fireEvent.click(trigger());

    expect(screen.getByRole('region', { name: 'Account and servers' })).toHaveClass('z-50');
  });

  it('shows that the active server is not signed in', () => {
    activeServerId.set('2');
    const view = render(UserMenu);

    expect(view.getByRole('button', { name: 'Not signed in on Prod' })).toBeInTheDocument();
  });

  it('opens the server info and server context controls', async () => {
    const view = render(UserMenu);

    await fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const panel = view.getByRole('region', { name: 'Account and servers' });
    expect(panel).toHaveTextContent('Current server');
    expect(view.getByRole('link', { name: 'https://dev.local' })).toHaveAttribute('href', 'https://dev.local');
    expect(view.getByText('Signed in as ana')).toBeInTheDocument();
    expect(view.getByLabelText('Server context')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('switches the server context from the menu', async () => {
    const view = render(UserMenu);
    await fireEvent.click(trigger());

    await fireEvent.change(view.getByLabelText('Server context'), { target: { value: '2' } });

    expect(get(activeServerId)).toBe('2');
    expect(view.getByText('Not signed in', { selector: 'p' })).toBeInTheDocument();
  });

  it('does not render a link for a server URL that is not http(s)', async () => {
    servers.set([{ ...signedIn, url: 'javascript:alert(1)' }]);
    const view = render(UserMenu);
    await fireEvent.click(trigger());

    expect(view.queryByRole('link')).not.toBeInTheDocument();
    expect(view.getByText('javascript:alert(1)')).toBeInTheDocument();
  });

  it('opens Settings in a tab and closes the menu', async () => {
    const view = render(UserMenu);
    await fireEvent.click(trigger());

    await fireEvent.click(view.getByRole('button', { name: 'Manage servers…' }));

    expect(get(openViews)).toEqual(['dashboard', 'settings']);
    expect(get(activeView)).toBe('settings');
    expect(view.queryByRole('region', { name: 'Account and servers' })).not.toBeInTheDocument();
  });

  it('opens About in a tab', async () => {
    const view = render(UserMenu);
    await fireEvent.click(trigger());

    await fireEvent.click(view.getByRole('button', { name: 'About' }));

    expect(get(activeView)).toBe('about');
  });

  it('closes on Escape and returns focus to the menu button', async () => {
    const view = render(UserMenu);
    await fireEvent.click(trigger());

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(view.queryByRole('region', { name: 'Account and servers' })).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('closes when clicking outside', async () => {
    const view = render(UserMenu);
    await fireEvent.click(trigger());

    await fireEvent.click(document.body);

    expect(view.queryByRole('region', { name: 'Account and servers' })).not.toBeInTheDocument();
  });
});
