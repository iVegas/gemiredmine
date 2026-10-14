import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ViewTabs from '../ViewTabs.svelte';
import { openViews, activeView, openView, resetViews } from '../lib/views';

describe('ViewTabs Component', () => {
  beforeEach(() => {
    resetViews();
  });

  it('shows the dashboard as a pinned first tab without a close control', () => {
    openView('calendar');
    const view = render(ViewTabs);

    const tabs = view.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent?.replace('✕', '').trim())).toEqual(['Dashboard', 'Calendar']);
    expect(tabs[0]).toHaveAttribute('title', 'Pinned tab');
    expect(view.getByTestId('pinned-icon')).toBeInTheDocument();
    expect(view.queryByTestId('close-dashboard')).not.toBeInTheDocument();
    expect(view.getByTestId('close-calendar')).toBeInTheDocument();
  });

  it('marks the active tab as selected and links each tab to its panel', () => {
    openView('calendar');
    const view = render(ViewTabs);

    const calendar = view.getByRole('tab', { name: 'Calendar' });
    expect(calendar).toHaveAttribute('aria-selected', 'true');
    expect(calendar).toHaveAttribute('tabindex', '0');
    expect(calendar).toHaveAttribute('aria-controls', 'view-panel-calendar');
    expect(view.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('tabindex', '-1');
  });

  it('switches views when a tab is clicked', async () => {
    openView('calendar');
    const view = render(ViewTabs);

    await fireEvent.click(view.getByRole('tab', { name: 'Dashboard' }));

    expect(get(activeView)).toBe('dashboard');
  });

  it('closes a tab with its close control without selecting it first', async () => {
    openView('calendar');
    openView('todo');
    const view = render(ViewTabs);

    await fireEvent.click(view.getByTestId('close-calendar'));

    expect(get(openViews)).toEqual(['dashboard', 'todo']);
    expect(get(activeView)).toBe('todo');
    expect(view.queryByRole('tab', { name: 'Calendar' })).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow, Home and End keys', async () => {
    openView('calendar');
    openView('todo');
    const view = render(ViewTabs);

    await fireEvent.keyDown(view.getByRole('tab', { name: 'To-do' }), { key: 'ArrowRight' });
    expect(get(activeView)).toBe('dashboard');

    await fireEvent.keyDown(view.getByRole('tab', { name: 'Dashboard' }), { key: 'ArrowLeft' });
    expect(get(activeView)).toBe('todo');

    await fireEvent.keyDown(view.getByRole('tab', { name: 'To-do' }), { key: 'Home' });
    expect(get(activeView)).toBe('dashboard');

    await fireEvent.keyDown(view.getByRole('tab', { name: 'Dashboard' }), { key: 'End' });
    expect(get(activeView)).toBe('todo');
    await vi.waitFor(() => expect(view.getByRole('tab', { name: 'To-do' })).toHaveFocus());
  });

  it('closes a closable tab with Delete and keeps focus on the tab strip', async () => {
    openView('calendar');
    const view = render(ViewTabs);
    const calendar = view.getByRole('tab', { name: 'Calendar' });
    expect(calendar).toHaveAttribute('aria-keyshortcuts', 'Delete');

    await fireEvent.keyDown(calendar, { key: 'Delete' });

    expect(get(openViews)).toEqual(['dashboard']);
    await vi.waitFor(() => expect(view.getByRole('tab', { name: 'Dashboard' })).toHaveFocus());
  });

  it('does not close the dashboard with Delete', async () => {
    const view = render(ViewTabs);
    const dashboard = view.getByRole('tab', { name: 'Dashboard' });
    expect(dashboard).not.toHaveAttribute('aria-keyshortcuts');

    await fireEvent.keyDown(dashboard, { key: 'Delete' });

    expect(get(openViews)).toEqual(['dashboard']);
  });
});
