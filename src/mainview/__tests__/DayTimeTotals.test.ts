import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import DayTimeTotals from '../components/DayTimeTotals.svelte';
import { redmineApi } from '../lib/api';
import { noteRedmineChange } from '../lib/data-changes';
import { formatDueDate } from '../lib/todo';
import type { RedmineTimeEntry } from '../../bun/redmine/types';

vi.mock('../lib/api', () => ({
  redmineApi: {
    listTimeEntries: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);
const server = { id: '1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' };
const day = '2026-10-12';
const label = formatDueDate(day);
const shop = { id: 1, name: 'Shop' };
const internal = { id: 2, name: 'Internal' };

const entry = (id: number, hours: number, project: { id: number; name: string }): RedmineTimeEntry => ({
  id,
  hours,
  project,
  spent_on: day,
  user: { id: 1, name: 'Ana' },
  activity: { id: 9, name: 'Development' },
});

describe('DayTimeTotals Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows what is logged on the day across all projects, and what is logged in the project', async () => {
    api.listTimeEntries.mockResolvedValue([entry(1, 3, shop), entry(2, 1.5, internal)]);
    const view = render(DayTimeTotals, { props: { server, day, project: shop } });

    expect(await view.findByText(`Already logged on ${label}: 4.5 h across all projects.`)).toBeInTheDocument();
    expect(view.getByText('3 h of it in Shop.')).toBeInTheDocument();
    expect(api.listTimeEntries).toHaveBeenCalledWith({ baseUrl: 'https://dev.local', apiKey: 'key' }, { from: day, to: day });
  });

  it('does not mention the project when nothing is logged in it on the day', async () => {
    api.listTimeEntries.mockResolvedValue([entry(2, 1.5, internal)]);
    const view = render(DayTimeTotals, { props: { server, day, project: shop } });

    expect(await view.findByText(`Already logged on ${label}: 1.5 h across all projects.`)).toBeInTheDocument();
    expect(view.queryByText(/of it in/)).not.toBeInTheDocument();
  });

  it('says that nothing is logged yet, when nothing is', async () => {
    api.listTimeEntries.mockResolvedValue([]);
    const view = render(DayTimeTotals, { props: { server, day, project: shop } });

    expect(await view.findByText(`Already logged on ${label}: nothing yet.`)).toBeInTheDocument();
    expect(view.queryByText(/of it in/)).not.toBeInTheDocument();
  });

  it('leaves out the log entry that is being changed', async () => {
    api.listTimeEntries.mockResolvedValue([entry(1, 3, shop), entry(2, 1, shop)]);
    const view = render(DayTimeTotals, { props: { server, day, project: shop, excludeEntryId: 1 } });

    expect(await view.findByText(`Already logged on ${label}: 1 h across all projects, not counting this entry.`)).toBeInTheDocument();
    expect(view.getByText('1 h of it in Shop.')).toBeInTheDocument();
  });

  it('says nothing else is logged when the entry being changed is the only one', async () => {
    api.listTimeEntries.mockResolvedValue([entry(1, 3, shop)]);
    const view = render(DayTimeTotals, { props: { server, day, project: shop, excludeEntryId: 1 } });

    expect(await view.findByText(`Already logged on ${label}: nothing else yet.`)).toBeInTheDocument();
  });

  it('counts time logged in this window while it is shown', async () => {
    api.listTimeEntries.mockResolvedValueOnce([]).mockResolvedValueOnce([entry(1, 2, shop)]);
    const view = render(DayTimeTotals, { props: { server, day, project: shop } });
    await view.findByText(`Already logged on ${label}: nothing yet.`);

    noteRedmineChange();

    expect(await view.findByText(`Already logged on ${label}: 2 h across all projects.`)).toBeInTheDocument();
  });

  it('says why the time cannot be checked', async () => {
    api.listTimeEntries.mockRejectedValue(new Error('Redmine API request failed: 503 Service Unavailable'));
    const view = render(DayTimeTotals, { props: { server, day, project: shop } });

    expect(await view.findByRole('alert')).toHaveTextContent(
      `Could not check the time already logged on ${label}: Redmine API request failed: 503 Service Unavailable`
    );
  });
});
