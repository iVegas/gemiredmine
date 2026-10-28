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
  'What the app is showing is written below. Answer from it instead of asking the user for it, and ask a question back only when the answer would be wrong without it.',
  '“I”, “me” and “my” are the user who is signed in. A question that names no server is about the server the app is showing, which every tool uses when it is given none.',
  'Work dates out from today yourself: “this week” is Monday to today, “this month” is the first of the month to today.',
  'Answer briefly, in the language the user writes in.',
].join(' ');

/** A server of the user, as the assistant is told about it: no address and no key, only what it needs to choose one. */
export interface ContextServer {
  name: string;
  /** Whether this is the server the app is showing. */
  active: boolean;
  /** Whether the user is signed in, so the tools can read it. */
  signedIn: boolean;
  /** The user's login on that server, when it is known. */
  login?: string | null;
}

/** What the app is showing while the question is asked. Everything in it is optional: a test, or a stripped-down app, may know none of it. */
export interface AssistantContext {
  /** The day on the user's computer, such as "2026-10-28 (Wednesday)". */
  today?: string;
  /** The servers the user has added, the active one among them. */
  servers?: readonly ContextServer[];
  /** The project the user has selected in the app, or null for every project. */
  project?: { id: number; name: string } | null;
}

/** The sentences that say what the app is showing, in the order the model reads them. Empty when nothing is known. */
export function assistantContextLines(context: AssistantContext): string[] {
  const lines: string[] = [];
  if (context.today) lines.push(`Today is ${context.today}.`);

  const servers = context.servers ?? [];
  const active = servers.find((server) => server.active);
  if (active) {
    const signed = active.signedIn
      ? `, signed in${active.login ? ` as "${active.login}"` : ''}`
      : ', where the user is not signed in: say so instead of reading it';
    lines.push(`The app is showing the server "${active.name}"${signed}.`);
  } else if (servers.length > 0) {
    lines.push(`The app is showing no server. The user’s servers are: ${servers.map((server) => `"${server.name}"`).join(', ')}.`);
  }
  const others = servers.filter((server) => !server.active);
  if (active && others.length > 0) {
    lines.push(`The user’s other servers are ${others.map((server) => `"${server.name}"`).join(', ')}. Read one of them only when the user names it.`);
  }

  if (context.project) {
    lines.push(
      `The user has selected the project "${context.project.name}" (Redmine id ${context.project.id}) in the app. Questions about their tasks and time mean that project, unless they name another one. list_assigned_tasks lists the tasks of every project: count only those whose project is that one.`
    );
  }
  return lines;
}

/** The instructions for one question: the ones above, and what the app is showing while it is asked. */
export function assistantSystemPrompt(context: AssistantContext = {}): string {
  const lines = assistantContextLines(context);
  return lines.length === 0 ? ASSISTANT_SYSTEM_PROMPT : [ASSISTANT_SYSTEM_PROMPT, ...lines].join(' ');
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The day on the user's computer, as the context names it: "2026-10-28 (Wednesday)". */
export function assistantToday(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${day} (${WEEKDAYS[now.getDay()]})`;
}

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
  /** What the app is showing while the question is asked, which the model is told before it answers. */
  context?: AssistantContext;
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
  const request = buildModelRequest(input.settings, input.apiKey, conversation, specs, assistantSystemPrompt(input.context ?? {}));
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
