import { describe, it, expect, vi } from 'vitest';
import { ask, ASSISTANT_SYSTEM_PROMPT, MAX_MODEL_ROUNDS } from '../assistant/chat';
import { TOOLS } from '../mcp/tools';
import type { McpApi, McpDeps, McpHost } from '../mcp/host';
import type { AssistantSettings } from '../../shared/assistant';
import type { ChatMessage } from '../assistant/providers';

const openai: AssistantSettings = { provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'm', voice: null };

/** A model that answers with the given replies, one per request, in order. */
function model(replies: unknown[]) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(replies.shift()), { status: 200 }));
}

const toolCall = (name: string, args: unknown, id = 'c1') => ({
  choices: [{ message: { content: null, tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] } }],
});
const text = (content: string) => ({ choices: [{ message: { content, tool_calls: undefined } }] });

function deps(overrides: { propose?: McpHost['propose']; getTask?: McpApi['getTask'] } = {}) {
  const host = {
    servers: () => [{ id: 'dev', name: 'Dev', url: 'https://dev.local', signedIn: true, active: true }],
    access: () => ({ baseUrl: 'https://dev.local', apiKey: 'key' }),
    propose: vi.fn(
      overrides.propose ??
        ((input: { serverId: string; serverName: string; change: unknown; summary: string }) => ({
          id: 'p1',
          ...input,
          status: 'waiting',
          outcome: null,
          createdAt: '2026-10-27T10:00:00.000Z',
        }))
    ),
    proposal: vi.fn(() => null),
  } as unknown as McpHost & { propose: ReturnType<typeof vi.fn> };
  const api = {
    getTask: vi.fn(overrides.getTask ?? (async () => ({ issue: { id: 6137, subject: 'V3 backend' } }))),
    listTimeActivities: vi.fn(async () => [{ id: 9, name: 'Development' }]),
    createLogEntry: vi.fn(),
    updateTask: vi.fn(),
    listAssignedTasks: vi.fn(),
    listTaskLogEntries: vi.fn(),
    listTaskOptions: vi.fn(),
  } as unknown as McpApi & { createLogEntry: ReturnType<typeof vi.fn>; updateTask: ReturnType<typeof vi.fn> };
  const dependencies: McpDeps = { host, api, version: '1.0.0' };
  return { host, api, dependencies };
}

const question: ChatMessage[] = [{ role: 'user', content: 'Log three hours on 6137 for the V3 backend.' }];

describe('asking the assistant', () => {
  it('runs a tool the model asks for, and gives the answer after it', async () => {
    const { dependencies } = deps();
    const fetch = model([toolCall('list_servers', {}), text('You have one server: Dev.')]);

    const result = await ask({ settings: openai, apiKey: 'k', conversation: question, tools: TOOLS, deps: dependencies, fetch });

    expect(result.answer).toBe('You have one server: Dev.');
    expect(result.toolsUsed).toEqual(['list_servers']);
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(JSON.parse(second.messages.at(-1).content).servers[0]).toMatchObject({ id: 'dev', name: 'Dev' });
  });

  it('tells the model which project the user has selected, after the usual instructions', async () => {
    const { dependencies } = deps();
    const fetch = model([text('Two tasks in Shop.')]);

    await ask({ settings: openai, apiKey: 'k', conversation: question, tools: TOOLS, deps: dependencies, fetch, project: { id: 1, name: 'Shop' } });

    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(sent.messages[0].content).toContain(ASSISTANT_SYSTEM_PROMPT);
    expect(sent.messages[0].content).toContain('the project "Shop" (Redmine id 1)');
  });

  it('gives the model no project when every project is shown', async () => {
    const { dependencies } = deps();
    const fetch = model([text('Four tasks.')]);

    await ask({ settings: openai, apiKey: 'k', conversation: question, tools: TOOLS, deps: dependencies, fetch, project: null });

    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(sent.messages[0].content).toBe(ASSISTANT_SYSTEM_PROMPT);
  });

  it('turns a log of time into a proposal, and never writes it to Redmine', async () => {
    const { dependencies, host, api } = deps();
    const fetch = model([
      toolCall('log_time', { taskId: 6137, hours: 3, activityId: 9, comments: 'V3 backend API' }),
      text('I proposed the entry. Approve it in the app.'),
    ]);

    const result = await ask({ settings: openai, apiKey: 'k', conversation: question, tools: TOOLS, deps: dependencies, fetch });

    expect(result.answer).toBe('I proposed the entry. Approve it in the app.');
    expect(host.propose).toHaveBeenCalledTimes(1);
    expect(host.propose.mock.calls[0][0]).toMatchObject({ serverId: 'dev', summary: expect.stringContaining('Log 3 h on task #6137') });
    expect(api.createLogEntry).not.toHaveBeenCalled();
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('hands a failed tool back to the model as an error, so the model can say what went wrong', async () => {
    const { dependencies } = deps({ getTask: async () => { throw new Error('Redmine API request failed: 404 Not Found'); } });
    const fetch = model([
      toolCall('log_time', { taskId: 1, hours: 1, activityId: 9 }),
      text('Task 1 does not exist on Dev.'),
    ]);

    await ask({ settings: openai, apiKey: 'k', conversation: question, tools: TOOLS, deps: dependencies, fetch });

    const second = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(JSON.parse(second.messages.at(-1).content)).toEqual({ error: 'Redmine API request failed: 404 Not Found' });
  });

  it('tells the model when it asks for a tool that does not exist', async () => {
    const { dependencies } = deps();
    const fetch = model([toolCall('delete_everything', {}), text('That tool is not available.')]);

    const result = await ask({ settings: openai, apiKey: 'k', conversation: question, tools: TOOLS, deps: dependencies, fetch });

    expect(result.answer).toBe('That tool is not available.');
    const second = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(JSON.parse(second.messages.at(-1).content)).toEqual({ error: 'There is no tool named delete_everything.' });
  });

  it('stops a model that keeps calling tools, and says so', async () => {
    const { dependencies } = deps();
    const replies = Array.from({ length: MAX_MODEL_ROUNDS + 1 }, () => toolCall('list_servers', {}));
    const fetch = model(replies);

    const result = await ask({ settings: openai, apiKey: 'k', conversation: question, tools: TOOLS, deps: dependencies, fetch });

    expect(fetch).toHaveBeenCalledTimes(MAX_MODEL_ROUNDS + 1);
    expect(result.toolsUsed).toHaveLength(MAX_MODEL_ROUNDS + 1);
    expect(result.answer).toContain('too many tool calls');
  });

  it('reports a refused key with the sentence for it, and keeps the conversation as it was', async () => {
    const { dependencies } = deps();
    const fetch = vi.fn(async () => new Response('denied', { status: 401 }));

    await expect(
      ask({ settings: openai, apiKey: 'wrong', conversation: question, tools: TOOLS, deps: dependencies, fetch })
    ).rejects.toThrow('The model service refused the API key. Check the key in Settings.');
    expect(question).toHaveLength(1);
  });
});
