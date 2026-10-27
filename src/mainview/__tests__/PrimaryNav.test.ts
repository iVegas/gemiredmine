import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import PrimaryNav from '../PrimaryNav.svelte';
import { activeView, openViews, resetViews } from '../lib/views';

describe('the navigation of the app', () => {
  beforeEach(() => resetViews());

  it('shows every view the app is for, so none of them is behind a menu', () => {
    const view = render(PrimaryNav);

    expect(
      view
        .getAllByRole('button')
        .map((button) => button.textContent?.trim())
    ).toEqual(['Dashboard', 'Calendar', 'To-do', 'Assistant', 'Settings']);
  });

  it('opens a view in a tab and switches to it', async () => {
    const view = render(PrimaryNav);

    await fireEvent.click(view.getByRole('button', { name: 'Assistant' }));

    expect(get(openViews)).toEqual(['dashboard', 'assistant']);
    expect(get(activeView)).toBe('assistant');
  });

  it('switches to the tab of a view that is already open, without opening it twice', async () => {
    const view = render(PrimaryNav);
    await fireEvent.click(view.getByRole('button', { name: 'Settings' }));
    await fireEvent.click(view.getByRole('button', { name: 'Dashboard' }));

    await fireEvent.click(view.getByRole('button', { name: 'Settings' }));

    expect(get(openViews)).toEqual(['dashboard', 'settings']);
    expect(get(activeView)).toBe('settings');
  });

  it('says which view is showing', async () => {
    const view = render(PrimaryNav);
    expect(view.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');

    await fireEvent.click(view.getByRole('button', { name: 'Calendar' }));

    expect(view.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
    expect(view.getByRole('button', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });
});
