import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The endpoint for AI agents is written on both sides of the webview: the Rust side (src-tauri/src/mcp.rs and lib.rs)
// receives the requests and offers the commands, and the TypeScript side (src/mainview/lib/mcp-host.ts) calls them and
// answers the requests. The names that cross between them must agree, so they are checked here.

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const mcpRs = read('src-tauri', 'src', 'mcp.rs');
const libRs = read('src-tauri', 'src', 'lib.rs');
const mcpHost = read('src', 'mainview', 'lib', 'mcp-host.ts');
const agents = read('src', 'shared', 'agents.ts');

describe('the endpoint commands', () => {
  it('are all offered to the webview', () => {
    const handler = /generate_handler!\[([\s\S]*?)\]/.exec(libRs)![1];
    for (const command of ['mcp_token', 'mcp_reset_token', 'mcp_start', 'mcp_stop', 'mcp_respond']) {
      expect(handler, command).toContain(command);
    }
  });

  it('are the ones the webview calls, by the same names', () => {
    const called = [...mcpHost.matchAll(/invoke(?:<[^>]*>)?\('(mcp_\w+)'/g)].map((match) => match[1]);

    expect(new Set(called)).toEqual(new Set(['mcp_token', 'mcp_reset_token', 'mcp_start', 'mcp_stop', 'mcp_respond']));
  });

  it('send the arguments the commands take', () => {
    expect(libRs).toMatch(/async fn mcp_start\([\s\S]*?port: u16,/);
    expect(libRs).toMatch(/fn mcp_respond\([\s\S]*?id: u64,\s*body: String/);
    expect(mcpHost).toContain("invoke('mcp_start', { port })");
    expect(mcpHost).toContain("invoke('mcp_respond', { id: payload.id, body: reply })");
  });
});

describe('the requests the endpoint forwards', () => {
  it('travel on one event name, which the webview listens for', () => {
    expect(mcpRs).toContain('pub const REQUEST_EVENT: &str = "mcp-request";');
    expect(mcpHost).toContain("const REQUEST_EVENT = 'mcp-request';");
    expect(mcpHost).toContain("listen<{ id: number; body: string }>(REQUEST_EVENT");
  });

  it('carry an id and a body, as the webview reads them', () => {
    expect(mcpRs).toMatch(/pub struct Forwarded \{\s*id: u64,\s*body: String,\s*\}/);
    expect(mcpRs).toContain('#[serde(rename_all = "camelCase")]');
  });

  it('are answered at the path the agents are told to use', () => {
    expect(mcpRs).toContain('pub const ENDPOINT: &str = "/mcp";');
    expect(read('src', 'mainview', 'SettingsView.svelte')).toContain('/mcp');
  });
});

describe('the port', () => {
  it('is refused below 1024 on both sides, and the same bounds are shown', () => {
    expect(libRs).toContain('if port < 1024 {');
    expect(agents).toContain('export const AGENT_MIN_PORT = 1024;');
    expect(agents).toContain('export const AGENT_MAX_PORT = 65535;');
  });

  it('listens on this computer only', () => {
    expect(mcpRs).toContain('Server::http(("127.0.0.1", port))');
    expect(mcpRs).not.toMatch(/0\.0\.0\.0/);
  });
});
