import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeDataFs } from './support/node-data-fs';
import { describeDataFsContract } from './data-fs.contract';

describeDataFsContract('nodeDataFs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gemi-datafs-'));
  return {
    fs: nodeDataFs,
    root,
    // Windows has no permission bits; the data folder there is protected by the package identity.
    modeOf: process.platform === 'win32' ? undefined : async (path) => (await stat(path)).mode & 0o777,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
});
