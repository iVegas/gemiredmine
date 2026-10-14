import { createMemoryDataFs } from './support/memory-data-fs';
import { describeDataFsContract } from './data-fs.contract';

// The in-memory fake stands in for real files in other tests, so it has to behave like the real thing.
describeDataFsContract('memory', async () => {
  const fs = createMemoryDataFs();
  await fs.mkdirp('/data');
  return { fs, root: '/data' };
});
