#!/usr/bin/env node
// Waits for the Build images run of one commit, so a release starts only after the images it pulls are pushed.
// Usage: node scripts/release/await-image-build.mjs <commit>. `gh` authenticates through GH_TOKEN.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WORKFLOW = 'build-images.yml';
// A push starts the image build and the release together, but the image run can be listed a little later.
export const APPEAR_GRACE_MS = 10_000;
export const TIMEOUT_MS = 40 * 60_000;
export const POLL_MS = 20_000;

/**
 * Decides what a release does, given the image runs listed for its commit and the time since it started waiting.
 * Returns { action: 'wait' | 'proceed' | 'fail', note? , message? }.
 */
export function decide(runs, elapsedMs) {
  const unfinished = runs.some((run) => run.status !== 'completed');
  if (unfinished || (runs.length === 0 && elapsedMs < APPEAR_GRACE_MS)) {
    if (elapsedMs >= TIMEOUT_MS) {
      return { action: 'fail', message: 'The image build did not finish within 40 minutes, so the release stopped.' };
    }
    return { action: 'wait' };
  }
  if (runs.length === 0) {
    return { action: 'proceed', note: 'No image build for this commit, so there is nothing to wait for.' };
  }
  const failed = runs.find((run) => run.conclusion !== 'success');
  if (failed) {
    return { action: 'fail', message: `The image build failed (${failed.url}), so the release cannot pull its images.` };
  }
  return { action: 'proceed', note: 'The image build of this commit succeeded.' };
}

function listImageRuns(commit) {
  const output = execFileSync(
    'gh',
    ['run', 'list', '--workflow', WORKFLOW, '--commit', commit, '--json', 'status,conclusion,url', '--limit', '10'],
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

async function main(commit) {
  const started = Date.now();
  for (;;) {
    const decision = decide(listImageRuns(commit), Date.now() - started);
    if (decision.action === 'proceed') {
      console.log(decision.note);
      return;
    }
    if (decision.action === 'fail') {
      console.error(`::error title=Image build::${decision.message}`);
      process.exit(1);
    }
    console.log(`Waiting for the image build of ${commit.slice(0, 7)}.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const commit = process.argv[2];
  if (!commit) {
    console.error('Usage: node scripts/release/await-image-build.mjs <commit>');
    process.exit(2);
  }
  await main(commit);
}
