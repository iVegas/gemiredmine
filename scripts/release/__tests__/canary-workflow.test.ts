import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANDIDATE_CHOICES } from '../candidate.mjs';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('the Canary workflow', () => {
  const canary = read('.github/workflows/canary.yml');

  it('offers the candidate choices that candidate.mjs accepts', () => {
    const options = /candidate:[\s\S]*?options: \[([^\]]+)\]/.exec(canary);

    expect(options?.[1].split(',').map((option) => option.trim())).toEqual([...CANDIDATE_CHOICES]);
  });

  it('sets the version and pushes it before any build starts', () => {
    expect(canary).toContain('node scripts/release/publish.mjs bump-candidate --candidate "$CANDIDATE"');
    expect(canary).toContain('git push origin "HEAD:refs/heads/$GITHUB_REF_NAME"');
    for (const job of ['build-linux', 'build-windows', 'build-android']) {
      expect(canary, job).toContain(`${job}:\n    needs: prepare\n`);
    }
  });

  it('builds and tags the commit it pushed', () => {
    expect(canary).toContain('commit=$(git rev-parse HEAD)');
    expect(canary.match(/commit: \$\{\{ needs\.prepare\.outputs\.commit \}\}/g)).toHaveLength(3);
    expect(canary).toContain('needs: [build-linux, build-windows, build-android]');
  });
});

describe('the build workflows', () => {
  // Each build reports the commit it was given as GITHUB_SHA, which the packaging scripts record in the release.
  const reports = {
    'build-linux': 'GITHUB_SHA="$RELEASE_COMMIT" node scripts/release/package-flatpak.mjs',
    'build-windows': '$env:GITHUB_SHA = $env:RELEASE_COMMIT',
    'build-android': 'GITHUB_SHA="$RELEASE_COMMIT" node scripts/release/package-android.mjs',
  } as const;

  for (const [name, report] of Object.entries(reports)) {
    it(`${name} builds the commit it is given and reports it as GITHUB_SHA`, () => {
      const workflow = read(`.github/workflows/${name}.yml`);

      expect(workflow).toContain('      commit:\n        description: Commit to build.');
      expect(workflow).toContain('RELEASE_COMMIT: ${{ inputs.commit || github.sha }}');
      expect(workflow).toContain('ref: ${{ inputs.commit }}');
      expect(workflow).toContain(report);
    });
  }
});
