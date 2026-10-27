// One question of the user, answered with the model and the app's tools. The tools are the ones of the MCP endpoint, so the
// assistant reads Redmine the same way an agent does, and a change it proposes waits for the user's approval like any
// other. Portable: it runs in the webview, and it gets its HTTP client and its tools from the caller.

import type { AssistantSettings } from '../../shared/assistant';
import type { FetchLike } from '../redmine/client';
import type { McpDeps } from '../mcp/host';
import type { McpTool } from '../mcp/tools';
import { buildModelRequest, describeFailure, parseModelReply, type ChatMessage, type ModelReply, type ToolCall, type ToolSpec } from './providers';

/** The most model replies one question may take. A model that keeps calling tools is stopped, and the user is told. */
export const MAX_MODEL_ROUNDS = 8;

export const ASSISTANT_SYSTEM_PROMPT = [
  'You are the assistant of Gemiredmine, an app that shows the user’s Redmine tasks and time.',
  'Use the tools to read the user’s servers, tasks, time and activities. Use them when the answer depends on Redmine, not from memory.',
  'A change you propose with log_time or update_task is not saved yet: the user approves or rejects it in the app, and only an approved change is written to Redmine. Say so when you propose one.',
  'Answer briefly, in the language the user writes in.',
].join(' ');

export interface AskInput {
  settings: AssistantSettings;
  /** The key of the chat model, or null when the service needs none. */
  apiKey: string | null;
  /** The conversation so far, ending with the user's new question. */
  conversation: ChatMessage[];
  tools: readonly McpTool[];
  /** The same dependencies as the MCP endpoint: the servers, the Redmine calls and the app's version. */
  deps: McpDeps;
  fetch: FetchLike;
}

export interface AskResult {
  /** The conversation with the answer and every tool result added. */
  conversation: ChatMessage[];
  /** The answer as text, for the user. */
  answer: string;
  /** The names of the tools that ran, in order. */
  toolsUsed: string[];
}

/** Asks the model, runs the tools it calls, and repeats until it answers with text or the rounds run out. */
export async function ask(input: AskInput): Promise<AskResult> {
  const specs: ToolSpec[] = input.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const conversation = [...input.conversation];
  const toolsUsed: string[] = [];

  for (let round = 0; round <= MAX_MODEL_ROUNDS; round++) {
    const reply = await askModel(input, specs, conversation);
    conversation.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls });
    if (reply.toolCalls.length === 0) return { conversation, answer: reply.text, toolsUsed };

    for (const call of reply.toolCalls) {
      toolsUsed.push(call.name);
      conversation.push({ role: 'tool', toolCallId: call.id, name: call.name, content: await runTool(call, input) });
    }
  }

  const answer = 'I stopped because this question needed too many tool calls. Ask it again in a narrower form.';
  conversation.push({ role: 'assistant', content: answer, toolCalls: [] });
  return { conversation, answer, toolsUsed };
}

async function askModel(input: AskInput, specs: ToolSpec[], conversation: ChatMessage[]): Promise<ModelReply> {
  const request = buildModelRequest(input.settings, input.apiKey, conversation, specs, ASSISTANT_SYSTEM_PROMPT);
  const response = await input.fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  return parseModelReply(input.settings.provider, await response.json());
}

/** A tool's result, as the model reads it. A failure is handed back as an error, so the model can say what went wrong. */
async function runTool(call: ToolCall, input: AskInput): Promise<string> {
  const tool = input.tools.find((candidate) => candidate.name === call.name);
  if (!tool) return JSON.stringify({ error: `There is no tool named ${call.name}.` });
  try {
    return JSON.stringify(await tool.run(call.args, input.deps));
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}
