// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

// The backend also runs inside a webview, which has none of the Node or Bun APIs. A browser build only
// warns about such an import, and the failure would show up as a blank screen, so check it here.
// Code that needs a platform brings it in through BackendPlatform, see backend.ts.

const root = fileURLToPath(new URL('..', import.meta.url));

function sourcesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourcesIn(path);
    return path.endsWith('.ts') && !name.endsWith('.generated.ts') ? [path] : [];
  });
}

const portable = [
  join(root, 'backend.ts'),
  join(root, 'timeout.ts'),
  ...sourcesIn(join(root, 'redmine')),
  ...sourcesIn(join(root, 'diagnostics')),
  ...sourcesIn(join(root, 'storage')),
  // The window manager runs in the main window's webview.
  ...sourcesIn(join(root, 'windows')),
  // The endpoint for AI agents: its messages are answered from the app's own data, without a platform.
  ...sourcesIn(join(root, 'mcp')),
  // The AI assistant: its model requests and voice requests are built here and sent by the webview's HTTP client.
  ...sourcesIn(join(root, 'assistant')),
];

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const forbidden: Array<[string, RegExp]> = [
  ['a node: import', /from\s+['"]node:/],
  ['Buffer', /\bBuffer\b/],
  ['process', /\bprocess\./],
  ['a Bun API', /\bBun\./],
];

describe('portable backend sources', () => {
  it('cover the whole backend', () => {
    const names = portable.map((path) => relative(root, path).split(sep).join('/'));

    expect(names).toEqual(
      expect.arrayContaining([
        'backend.ts',
        'timeout.ts',
        'redmine/client.ts',
        'redmine/auth.ts',
        'diagnostics/service.ts',
        'diagnostics/store.ts',
        'diagnostics/fs.ts',
        'storage/app-storage.ts',
        'storage/migrations.ts',
        'windows/view-windows.ts',
      ])
    );
  });

  it.each(portable.map((path) => [relative(root, path).split(sep).join('/'), path]))(
    '%s uses no Node or Bun API',
    (_name, path) => {
      const source = withoutComments(readFileSync(path, 'utf8'));

      for (const [what, pattern] of forbidden) {
        expect(pattern.test(source), `${_name} uses ${what}`).toBe(false);
      }
    }
  );

  it('would notice a Node API', () => {
    const sample = "import { readFileSync } from 'node:fs';\nconst size = Buffer.byteLength(text);\nprocess.env.HOME;";

    expect(forbidden.filter(([, pattern]) => pattern.test(withoutComments(sample))).map(([what]) => what)).toEqual([
      'a node: import',
      'Buffer',
      'process',
    ]);
  });
});
