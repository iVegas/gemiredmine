// SHA-256 of a file, as the SHA256SUMS files list it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
