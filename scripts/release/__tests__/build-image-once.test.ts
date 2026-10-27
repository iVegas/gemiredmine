import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The script runs against a fake `docker`, which records each call and answers `buildx imagetools inspect` the way the
// registry does: a found tag, a missing tag, or an error that is not about the tag.

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const SCRIPT = join(ROOT, 'scripts', 'release', 'build-image-once.sh');
const TAG = 'ghcr.io/ivegas/gemiredmine-android-deps:369fcdb9c29d-64ad8203b153';

let dir: string;
let log: string;

function fakeDocker() {
  writeFileSync(
    join(dir, 'docker'),
    `#!/bin/sh
echo "$@" >> "$DOCKER_LOG"
if [ "$1" = buildx ] && [ "$2" = imagetools ]; then
  case "$INSPECT" in
    found) echo "Name: $3"; exit 0 ;;
    missing) echo "ERROR: $3: not found" >&2; exit 1 ;;
    *) echo "ERROR: unauthorized: authentication required" >&2; exit 1 ;;
  esac
fi
exit 0
`
  );
  chmodSync(join(dir, 'docker'), 0o755);
}

function run(inspect: 'found' | 'missing' | 'failed') {
  return spawnSync('bash', [SCRIPT, TAG, '-f', 'docker/android/deps.Dockerfile', '--build-arg', 'ENV_IMAGE=x'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DOCKER_LOG: log, INSPECT: inspect },
  });
}

/** The docker calls the script made, in order. None means docker was never called. */
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'build-image-once-'));
  log = join(dir, 'calls.log');
  fakeDocker();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('building an image only when its tag is not published', () => {
  it('does not build or push a tag the registry already has', () => {
    const result = run('found');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Already published, so not built again');
    expect(calls()).toEqual([`buildx imagetools inspect ${TAG}`]);
  });

  it('builds and pushes a tag the registry does not have', () => {
    const result = run('missing');

    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      `buildx imagetools inspect ${TAG}`,
      `buildx build -f docker/android/deps.Dockerfile --build-arg ENV_IMAGE=x -t ${TAG} --push .`,
    ]);
    expect(result.stdout).toContain(`Pushed ${TAG}`);
  });

  it('stops, without building, when the registry cannot be asked', () => {
    const result = run('failed');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unauthorized');
    expect(result.stderr).toContain('::error title=Image check::');
    expect(calls()).toEqual([`buildx imagetools inspect ${TAG}`]);
  });
});

describe('the image workflow', () => {
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'build-images.yml'), 'utf8');

  it('pushes every image through the script, and never with a bare docker buildx push', () => {
    expect(workflow).toContain('scripts/release/build-image-once.sh "$ENV" -f docker/android/env.Dockerfile');
    expect(workflow).toContain('scripts/release/build-image-once.sh "$DEPS" -f docker/android/deps.Dockerfile');
    expect(workflow).toContain('scripts/release/build-image-once.sh "$ENV" -f docker/flatpak/env.Dockerfile');
    expect(workflow).not.toMatch(/docker buildx build[^\n]*--push/);
  });
});
