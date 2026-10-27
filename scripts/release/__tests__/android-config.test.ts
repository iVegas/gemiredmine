import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Dockerfile of the Android build takes its Tauri overlay from this script. The overlay carries the copyright, which
// needs the build date, so the script has to supply the date as the other entry points do. Run it as the Dockerfile does.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../android-config.mjs');

function androidConfig(env: Record<string, string>) {
  const result = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, encoding: 'utf8' });

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { bundle: { copyright: string; publisher: string } };
}

describe('the Android configuration script', () => {
  it('prints the overlay when no build date is given, so the build does not stop', () => {
    const overlay = androidConfig({ CHANNEL: 'unstable', GITHUB_RUN_NUMBER: '7', BUILD_DATE: '' });

    expect(overlay.bundle.copyright).toMatch(/^Copyright © \d{4} iVegas$/);
    expect(overlay.bundle.publisher).toBe('iVegas');
  });

  it('takes the copyright year from BUILD_DATE when it is given', () => {
    const overlay = androidConfig({ CHANNEL: 'unstable', GITHUB_RUN_NUMBER: '7', BUILD_DATE: '2031-02-03T04:05:06.000Z' });

    expect(overlay.bundle.copyright).toBe('Copyright © 2031 iVegas');
  });
});
