// The MCP endpoint's messages, the Model Context Protocol over JSON-RPC 2.0. A message comes in as text and the answer
// goes out as text; a notification has no answer, and then the text is empty. The app's webview hands each message
// here, so this module makes no request and reads no file itself.

import { TOOLS } from './tools';
import type { McpDeps } from './host';

/** The protocol version this endpoint speaks. Older versions it knows are answered in kind. */
export const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS: readonly string[] = [PROTOCOL_VERSION, '2025-03-26'];

const INSTRUCTIONS =
  'Reads the Redmine servers the user has added to the Gemiredmine app: their tasks and the time logged on them. ' +
  'A server is named by its id or its name; without one, the server the app shows is used. Nothing here changes Redmine.';

type Id = string | number | null;

interface Reply {
  jsonrpc: '2.0';
  id: Id;
  result?: unknown;
  error?: { code: number; message: string };
}

/** A failure that the caller gets as a JSON-RPC error, with its code. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const errorReply = (id: Id, code: number, message: string): Reply => ({ jsonrpc: '2.0', id, error: { code, message } });

/** The answer to one message, as text: empty when the message is a notification. Never throws. */
export async function answerMcp(text: string, deps: McpDeps): Promise<string> {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return JSON.stringify(errorReply(null, -32700, 'The message is not valid JSON.'));
  }
  // Batches were removed from the protocol in 2025-06-18, so an array is refused rather than answered.
  if (Array.isArray(message)) return JSON.stringify(errorReply(null, -32600, 'Batches are not supported.'));
  const reply = await answerOne(message, deps);
  return reply ? JSON.stringify(reply) : '';
}

async function answerOne(message: unknown, deps: McpDeps): Promise<Reply | null> {
  if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    const id = isObject(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
    return errorReply(id, -32600, 'The message is not a JSON-RPC 2.0 request.');
  }
  // A message without an id is a notification. Nothing is sent back for it, whether or not it succeeds.
  if (!('id' in message)) return null;
  const id = message.id;
  if (typeof id !== 'string' && typeof id !== 'number' && id !== null) {
    return errorReply(null, -32600, 'The id must be a string, a number or null.');
  }
  try {
    return { jsonrpc: '2.0', id, result: await call(message.method, message.params, deps) };
  } catch (failure) {
    if (failure instanceof RpcError) return errorReply(id, failure.code, failure.message);
    return errorReply(id, -32603, 'The app could not answer the request.');
  }
}

async function call(method: string, params: unknown, deps: McpDeps): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return initialize(params, deps);
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
      };
    case 'tools/call':
      return callTool(params, deps);
    default:
      throw new RpcError(-32601, `The endpoint has no method ${method}.`);
  }
}

function initialize(params: unknown, deps: McpDeps) {
  const asked = isObject(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
  return {
    protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'Gemiredmine', version: deps.version },
    instructions: INSTRUCTIONS,
  };
}

async function callTool(params: unknown, deps: McpDeps) {
  if (!isObject(params) || typeof params.name !== 'string') throw new RpcError(-32602, 'A tool call needs the name of a tool.');
  const tool = TOOLS.find((candidate) => candidate.name === params.name);
  if (!tool) throw new RpcError(-32602, `There is no tool called ${params.name}.`);
  const args = isObject(params.arguments) ? params.arguments : {};
  try {
    const result = await tool.run(args, deps);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (failure) {
    // A tool that fails is an answer the agent can read, so the failure goes in the result, not in a protocol error.
    const text = failure instanceof Error ? failure.message : 'The tool failed.';
    return { content: [{ type: 'text', text }], isError: true };
  }
}
