import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import AboutView from '../AboutView.svelte';
import { buildInfo } from '../../shared/build-info.generated';
import { DevPreviewPanel } from '../dev-preview.generated';
import { redmineApi } from '../lib/api';

vi.mock('../lib/api', () => ({
  redmineApi: {
    getDevPreviewStatus: vi.fn().mockResolvedValue({ available: true, enabled: false, dataDir: '', logBytes: 0, pendingEntries: 0 }),
    setDevPreviewEnabled: vi.fn(),
    createFeedback: vi.fn(),
    openIssueLink: vi.fn(),
    recordDiagnostic: vi.fn(),
  },
}));

describe('AboutView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the version, channel and build details from the single build source', () => {
    const { getByTestId, getByText } = render(AboutView, { props: { onClose: vi.fn() } });

    expect(getByTestId('app-version')).toHaveTextContent(buildInfo.version);
    expect(getByText(buildInfo.productName)).toBeInTheDocument();
    expect(getByText(buildInfo.commit)).toBeInTheDocument();
    expect(getByText(buildInfo.identifier)).toBeInTheDocument();
    expect(getByText(buildInfo.dataDirName)).toBeInTheDocument();
  });

  it('offers the developer preview only in builds that include it', async () => {
    const { queryByRole, findByRole } = render(AboutView, { props: { onClose: vi.fn() } });

    const panelIncluded = Boolean(DevPreviewPanel);
    if (panelIncluded) {
      expect(await findByRole('switch')).toBeInTheDocument();
    } else {
      expect(queryByRole('switch')).not.toBeInTheDocument();
    }
  });

  it('returns to the previous screen when Back is pressed', async () => {
    const onClose = vi.fn();
    const { getByText } = render(AboutView, { props: { onClose } });

    await fireEvent.click(getByText('Back'));

    expect(onClose).toHaveBeenCalled();
  });
});
