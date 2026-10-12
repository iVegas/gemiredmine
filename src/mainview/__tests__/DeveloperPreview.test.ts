import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import DeveloperPreview from '../components/DeveloperPreview.svelte';
import { redmineApi } from '../lib/api';

vi.mock('../lib/api', () => ({
  redmineApi: {
    getDevPreviewStatus: vi.fn(),
    setDevPreviewEnabled: vi.fn(),
    createFeedback: vi.fn(),
    openIssueLink: vi.fn(),
    recordDiagnostic: vi.fn(),
  },
}));

const api = vi.mocked(redmineApi);
const off = { available: true, enabled: false, dataDir: '/data/gemiredmine-unstable', logBytes: 0, pendingEntries: 0 };
const on = { ...off, enabled: true };
const issueUrl = 'https://github.com/iVegas/gemiredmine/issues/new?title=x';

describe('DeveloperPreview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getDevPreviewStatus.mockResolvedValue(off);
  });

  it('is off by default and turns on through the switch', async () => {
    api.setDevPreviewEnabled.mockResolvedValueOnce(on);
    const view = render(DeveloperPreview);

    const toggle = await view.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await fireEvent.click(toggle);

    await waitFor(() => expect(api.setDevPreviewEnabled).toHaveBeenCalledWith(true));
    expect(await view.findByText('Send feedback')).toBeInTheDocument();
  });

  it('creates feedback, opens the prefilled issue and shows where the full report is', async () => {
    api.getDevPreviewStatus.mockResolvedValue(on);
    api.createFeedback.mockResolvedValueOnce({ issueUrl, reportPath: '/data/feedback/r.md', logsIncluded: 'all' });
    api.openIssueLink.mockResolvedValueOnce(true as never);
    const view = render(DeveloperPreview);

    await fireEvent.input(await view.findByLabelText('Title'), { target: { value: 'Calendar is empty' } });
    await fireEvent.input(view.getByLabelText('What happened?'), { target: { value: 'After switching months' } });
    await fireEvent.click(view.getByText('Create GitHub issue'));

    await waitFor(() =>
      expect(api.createFeedback).toHaveBeenCalledWith({
        title: 'Calendar is empty',
        description: 'After switching months',
        includeLogs: true,
      })
    );
    expect(api.openIssueLink).toHaveBeenCalledWith(issueUrl);
    expect(await view.findByRole('status')).toHaveTextContent('/data/feedback/r.md');
    expect(view.getByRole('status')).toHaveTextContent('The prefilled issue is open in your browser');
  });

  it('says so when the browser did not open and keeps the link available', async () => {
    api.getDevPreviewStatus.mockResolvedValue(on);
    api.createFeedback.mockResolvedValueOnce({ issueUrl, reportPath: '/data/feedback/r.md', logsIncluded: 'all' });
    api.openIssueLink.mockRejectedValueOnce(new Error('no browser'));
    const view = render(DeveloperPreview);

    await fireEvent.input(await view.findByLabelText('Title'), { target: { value: 'No browser' } });
    await fireEvent.click(view.getByText('Create GitHub issue'));

    expect(await view.findByText(/did not open the prefilled issue/)).toBeInTheDocument();
    expect(view.getByText('Open the prefilled issue')).toHaveAttribute('href', issueUrl);
  });

  it('tells the user to attach the full report when logs had to be shortened', async () => {
    api.getDevPreviewStatus.mockResolvedValue(on);
    api.createFeedback.mockResolvedValueOnce({ issueUrl, reportPath: '/data/feedback/r.md', logsIncluded: 'partial' });
    api.openIssueLink.mockResolvedValueOnce(true as never);
    const view = render(DeveloperPreview);

    await fireEvent.input(await view.findByLabelText('Title'), { target: { value: 'Big log' } });
    await fireEvent.click(view.getByText('Create GitHub issue'));

    expect(await view.findByText(/logs were shortened/)).toBeInTheDocument();
  });

  it('shows feedback failures without losing what the user typed', async () => {
    api.getDevPreviewStatus.mockResolvedValue(on);
    api.createFeedback.mockRejectedValueOnce(new Error('Turn on the developer preview before sending feedback.'));
    const view = render(DeveloperPreview);

    const title = await view.findByLabelText('Title');
    await fireEvent.input(title, { target: { value: 'Keep me' } });
    await fireEvent.click(view.getByText('Create GitHub issue'));

    expect(await view.findByRole('alert')).toHaveTextContent('Turn on the developer preview');
    expect(title).toHaveValue('Keep me');
  });
});
