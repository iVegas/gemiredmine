import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('../../shared/build-info.generated', () => ({
  buildInfo: {
    version: '1.0.0-unstable.12',
    channel: 'unstable',
    label: 'Unstable',
    appName: 'Gemiredmine',
    productName: 'Gemiredmine Unstable',
    identifier: 'com.gemiredmine.app.unstable',
    dataDirName: 'gemiredmine-unstable',
    devPreviewAvailable: true,
    platform: 'android',
    repositoryUrl: 'https://github.com/iVegas/gemiredmine',
    commit: 'abc1234',
    buildDate: '2026-10-21T00:00:00.000Z',
  },
}));
vi.mock('../dev-preview.generated', () => ({ DevPreviewPanel: null, installDiagnosticsHooks: null }));
vi.mock('../lib/api', () => ({ redmineApi: {} }));

import AboutView from '../AboutView.svelte';

describe('AboutView on Android', () => {
  it('says the app does not update itself, and names neither App Installer nor the Flatpak command', () => {
    const { getByText, queryByText } = render(AboutView, { props: { onClose: vi.fn() } });

    expect(getByText(/does not update itself on Android/)).toBeInTheDocument();
    expect(queryByText(/App Installer/)).not.toBeInTheDocument();
    expect(queryByText(/flatpak install/)).not.toBeInTheDocument();
  });
});
