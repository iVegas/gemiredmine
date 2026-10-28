import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ProjectSelector from '../ProjectSelector.svelte';
import { redmineApi } from '../lib/api';
import { activeProject, activeServerId, projectSelection, servers } from '../lib/store';

vi.mock('../lib/api', () => ({
  redmineApi: {
    listMyProjects: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);
const dev = { id: 's1', name: 'Dev', url: 'https://dev.local', apiToken: 'key' };
const projects = [
  { id: 2, name: 'Internal' },
  { id: 1, name: 'Shop' },
];

describe('ProjectSelector Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    projectSelection.set({});
    servers.set([dev]);
    activeServerId.set('s1');
    api.listMyProjects.mockResolvedValue(projects);
  });

  it('offers every project the user takes part in, and shows all projects by default', async () => {
    const view = render(ProjectSelector);

    const select = await view.findByRole('combobox', { name: 'Project' });
    expect(select).toHaveValue('');
    expect(view.getAllByRole('option').map((option) => option.textContent)).toEqual(['All projects', 'Internal', 'Shop']);
    expect(api.listMyProjects).toHaveBeenCalledWith({ baseUrl: 'https://dev.local', apiKey: 'key' });
  });

  it('shows the chosen project for the server, and every project when that is chosen again', async () => {
    const view = render(ProjectSelector);
    const select = await view.findByRole('combobox', { name: 'Project' });

    await fireEvent.change(select, { target: { value: '1' } });
    expect(get(activeProject)).toEqual({ id: 1, name: 'Shop' });
    expect(select).toHaveValue('1');

    await fireEvent.change(select, { target: { value: '' } });
    expect(get(activeProject)).toBeNull();
  });

  it('keeps the project chosen before, when it is still one the user takes part in', async () => {
    projectSelection.set({ s1: { id: 1, name: 'Shop' } });
    const view = render(ProjectSelector);

    expect(await view.findByRole('combobox', { name: 'Project' })).toHaveValue('1');
    expect(get(projectSelection)).toEqual({ s1: { id: 1, name: 'Shop' } });
  });

  it('goes back to every project when the chosen one is no longer one the user takes part in', async () => {
    projectSelection.set({ s1: { id: 9, name: 'Archive' } });
    const view = render(ProjectSelector);

    await vi.waitFor(() => expect(get(projectSelection)).toEqual({}));
    expect(await view.findByRole('combobox', { name: 'Project' })).toHaveValue('');
  });

  it('still lists the chosen project while the list of projects is not loaded', async () => {
    api.listMyProjects.mockReturnValue(new Promise(() => {}));
    projectSelection.set({ s1: { id: 1, name: 'Shop' } });
    const view = render(ProjectSelector);

    expect(await view.findByRole('combobox', { name: 'Project' })).toHaveValue('1');
    expect(view.getByRole('option', { name: 'Shop' })).toBeInTheDocument();
  });

  it('says so when the projects cannot be listed, and keeps the choice', async () => {
    api.listMyProjects.mockRejectedValueOnce(new Error('Redmine API request failed: 503 Service Unavailable'));
    const view = render(ProjectSelector);

    expect(await view.findByRole('status')).toHaveTextContent('Projects unavailable');
    expect(view.getByRole('combobox', { name: 'Project' })).toHaveValue('');
  });

  it('is not shown for a server the user has not signed in to', () => {
    servers.set([{ ...dev, apiToken: undefined }]);
    const view = render(ProjectSelector);

    expect(view.queryByRole('combobox', { name: 'Project' })).not.toBeInTheDocument();
    expect(api.listMyProjects).not.toHaveBeenCalled();
  });
});
