import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('../../shared/build-info.generated', () => ({
  buildInfo: {
    version: '1.0.0.0',
    channel: 'stable',
    label: 'Stable',
    appName: 'Gemiredmine',
    productName: 'Gemiredmine',
    identifier: 'com.gemiredmine.app',
    dataDirName: 'gemiredmine',
    devPreviewAvailable: false,
    platform: 'windows',
    repositoryUrl: 'https://github.com/iVegas/gemiredmine',
    commit: 'abc1234',
    buildDate: '2026-10-13T00:00:00.000Z',
  },
}));
vi.mock('../dev-preview.generated', () => ({ DevPreviewPanel: null, installDiagnosticsHooks: null }));
vi.mock('../lib/api', () => ({ redmineApi: {} }));

import AboutView from '../AboutView.svelte';

describe('AboutView on Windows', () => {
  it('describes App Installer updates instead of the Flatpak command', () => {
    const { getByText, queryByText } = render(AboutView, { props: { onClose: vi.fn() } });

    expect(getByText(/App Installer file/)).toBeInTheDocument();
    expect(queryByText(/flatpak install/)).not.toBeInTheDocument();
  });
});
