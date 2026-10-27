// The request and reply formats of the three kinds of model service. Nothing here sends a request: the requests are built
// and the replies read here, and the caller sends them. A test can therefore check every format without a network.
// Portable: it runs in the webview, so it uses no Node or Bun API.

import type { AssistantProvider, AssistantSettings } from '../../shared/assistant';

/** A tool the model may call, described as the model needs it. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A call the model asked for. `args` is what the model sent, parsed; arguments that are not an object become `{}`. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** The conversation as the app keeps it. Each service's own format is built from it. */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
}

export interface ModelRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const UNREADABLE = 'The model answered in a format the app does not read.';

const baseUrl = (settings: AssistantSettings) => settings.baseUrl.replace(/\/+$/, '');

/** The key as a header, when there is one. A local server may need none. */
const authorization = (apiKey: string | null): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});

/** Builds the request that asks the model for the next step: a text, or tool calls to run. */
export function buildModelRequest(
  settings: AssistantSettings,
  apiKey: string | null,
  conversation: ChatMessage[],
  tools: ToolSpec[],
  system: string
): ModelRequest {
  switch (settings.provider) {
    case 'openai-compatible':
      return openAiRequest(settings, apiKey, conversation, tools, system);
    case 'anthropic':
      return anthropicRequest(settings, apiKey, conversation, tools, system);
    case 'gemini':
      return geminiRequest(settings, apiKey, conversation, tools, system);
  }
}

/** Reads the text and the tool calls out of a reply. Throws when the reply has neither the expected shape nor a text. */
export function parseModelReply(provider: AssistantProvider, response: unknown): ModelReply {
  switch (provider) {
    case 'openai-compatible':
      return parseOpenAi(response);
    case 'anthropic':
      return parseAnthropic(response);
    case 'gemini':
      return parseGemini(response);
  }
}

// --- OpenAI-compatible: chat completions with function tools. OpenAI, Lemonade, Ollama and LM Studio speak it.

function openAiRequest(settings: AssistantSettings, apiKey: string | null, conversation: ChatMessage[], tools: ToolSpec[], system: string): ModelRequest {
  return {
    url: `${baseUrl(settings)}/chat/completions`,
    headers: { 'content-type': 'application/json', ...authorization(apiKey) },
    body: {
      model: settings.model,
      messages: [{ role: 'system', content: system }, ...conversation.flatMap(openAiMessages)],
      ...(tools.length > 0 && {
        tools: tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
        })),
      }),
    },
  };
}

function openAiMessages(message: ChatMessage): Record<string, unknown>[] {
  if (message.role === 'user') return [{ role: 'user', content: message.content }];
  if (message.role === 'tool') return [{ role: 'tool', tool_call_id: message.toolCallId, content: message.content }];
  return [
    {
      role: 'assistant',
      content: message.content || null,
      ...(message.toolCalls.length > 0 && {
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      }),
    },
  ];
}

function parseOpenAi(response: unknown): ModelReply {
  const message = field(field(field(response, 'choices'), 0), 'message');
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return {
    text: typeof message.content === 'string' ? message.content : '',
    toolCalls: calls.map((call, index) => {
      const fn = field(call, 'function');
      return { id: typeof call.id === 'string' ? call.id : `call-${index}`, name: String(fn.name), args: argumentsOf(fn.arguments) };
    }),
  };
}

// --- Anthropic: the Messages API, with tool_use and tool_result blocks.

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 2048;

function anthropicRequest(settings: AssistantSettings, apiKey: string | null, conversation: ChatMessage[], tools: ToolSpec[], system: string): ModelRequest {
  return {
    url: `${baseUrl(settings)}/messages`,
    headers: {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: {
      model: settings.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system,
      messages: anthropicMessages(conversation),
      ...(tools.length > 0 && {
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
      }),
    },
  };
}

/** Consecutive tool results share one user turn, as the Messages API asks. Their content is a list, a text is a string. */
function anthropicMessages(conversation: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const turns: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const message of conversation) {
    if (message.role === 'user') {
      turns.push({ role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      turns.push({
        role: 'assistant',
        content:
          message.toolCalls.length === 0
            ? message.content
            : [
                ...(message.content ? [{ type: 'text', text: message.content }] : []),
                ...message.toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.args })),
              ],
      });
    } else {
      const result = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content };
      const last = turns[turns.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(result);
      else turns.push({ role: 'user', content: [result] });
    }
  }
  return turns;
}

function parseAnthropic(response: unknown): ModelReply {
  const blocks = field(response, 'content');
  if (!Array.isArray(blocks)) throw new Error(UNREADABLE);
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of blocks as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') text.push(block.text);
    if (block.type === 'tool_use') toolCalls.push({ id: String(block.id), name: String(block.name), args: objectOf(block.input) });
  }
  return { text: text.join('\n'), toolCalls };
}

// --- Google Gemini: generateContent, with function declarations and function responses.

function geminiRequest(settings: AssistantSettings, apiKey: string | null, conversation: ChatMessage[], tools: ToolSpec[], system: string): ModelRequest {
  const model = settings.model.replace(/^models\//, '');
  return {
    url: `${baseUrl(settings)}/models/${encodeURIComponent(model)}:generateContent`,
    headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-goog-api-key': apiKey } : {}) },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: geminiContents(conversation),
      ...(tools.length > 0 && {
        tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: geminiSchema(tool.inputSchema) })) }],
      }),
    },
  };
}

function geminiContents(conversation: ChatMessage[]): Array<{ role: 'user' | 'model'; parts: unknown[] }> {
  const turns: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];
  for (const message of conversation) {
    if (message.role === 'user') {
      turns.push({ role: 'user', parts: [{ text: message.content }] });
    } else if (message.role === 'assistant') {
      turns.push({
        role: 'model',
        parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...message.toolCalls.map((call) => ({ functionCall: { name: call.name, args: call.args } })),
        ],
      });
    } else {
      const part = { functionResponse: { name: message.name, response: { result: message.content } } };
      const last = turns[turns.length - 1];
      if (last && last.role === 'user' && last.parts.every((item) => typeof item === 'object' && item !== null && 'functionResponse' in item)) {
        last.parts.push(part);
      } else {
        turns.push({ role: 'user', parts: [part] });
      }
    }
  }
  return turns;
}

/**
 * The tool schemas are JSON Schema; Gemini takes the OpenAPI subset of it, which refuses two keywords that the tools use.
 * They are removed here, from every level, so the tools themselves stay as written.
 */
const GEMINI_UNSUPPORTED = new Set(['$schema', 'additionalProperties']);

export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (typeof schema !== 'object' || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([key]) => !GEMINI_UNSUPPORTED.has(key))
      .map(([key, value]) => [key, geminiSchema(value)])
  );
}

function parseGemini(response: unknown): ModelReply {
  const parts = field(field(field(response, 'candidates'), 0), 'content');
  const items = Array.isArray(parts.parts) ? (parts.parts as Array<Record<string, unknown>>) : null;
  if (!items) throw new Error(UNREADABLE);
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  items.forEach((item, index) => {
    if (typeof item.text === 'string') text.push(item.text);
    if (typeof item.functionCall === 'object' && item.functionCall !== null) {
      const call = item.functionCall as Record<string, unknown>;
      // Gemini gives no id to a call; its response is matched by name, so the id only needs to be unique in the reply.
      toolCalls.push({ id: `${String(call.name)}-${index}`, name: String(call.name), args: objectOf(call.args) });
    }
  });
  return { text: text.join('\n'), toolCalls };
}

// --- Reading a reply

/** A field of a reply, which must be there. Throws the one sentence the user can read when it is not. */
function field(value: unknown, key: string | number): Record<string, any> {
  if (typeof value !== 'object' || value === null || !(key in value)) throw new Error(UNREADABLE);
  return (value as Record<string | number, any>)[key];
}

/** The arguments of an OpenAI-style call: a JSON text. Text that is not an object is read as no arguments. */
function argumentsOf(text: unknown): Record<string, unknown> {
  if (typeof text === 'object' && text !== null) return objectOf(text);
  if (typeof text !== 'string' || text.trim() === '') return {};
  try {
    return objectOf(JSON.parse(text));
  } catch {
    return {};
  }
}

const objectOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * What a failed request says, for the user. A refused key gets its own sentence, since that is what the user must fix.
 * The body is shortened, so a long page from a proxy does not fill the screen.
 */
export async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) return 'The model service refused the API key. Check the key in Settings.';
  const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  return `The model service answered ${response.status}${detail ? `: ${detail}` : '.'}`;
}
