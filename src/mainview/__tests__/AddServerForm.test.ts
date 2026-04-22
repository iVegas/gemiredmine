import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import AddServerForm from '../AddServerForm.svelte';
import { servers } from '../lib/store';
import { get } from 'svelte/store';

describe('AddServerForm Component', () => {
  beforeEach(() => {
    servers.set([]);
  });

  it('submits form and adds server to store', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    const { getByLabelText, getByText } = render(AddServerForm, {
      props: { onSuccess, onCancel }
    });

    const nameInput = getByLabelText('Server Name');
    const urlInput = getByLabelText('URL');

    await fireEvent.input(nameInput, { target: { value: 'My Redmine' } });
    await fireEvent.input(urlInput, { target: { value: 'https://my.redmine.com' } });

    const submitBtn = getByText('Add Server');
    await fireEvent.click(submitBtn);

    expect(onSuccess).toHaveBeenCalled();

    const currentServers = get(servers);
    expect(currentServers).toHaveLength(1);
    expect(currentServers[0].name).toBe('My Redmine');
    expect(currentServers[0].url).toBe('https://my.redmine.com');
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();

    const { getByText } = render(AddServerForm, {
      props: { onSuccess, onCancel }
    });

    const cancelBtn = getByText('Cancel');
    await fireEvent.click(cancelBtn);

    expect(onCancel).toHaveBeenCalled();
  });
});
