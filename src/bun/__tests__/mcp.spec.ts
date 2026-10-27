// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerMcp, PROTOCOL_VERSION } from '../mcp/protocol';
import { MAX_WAITING_PROPOSALS, type McpApi, type McpDeps, type McpHost, type McpServerInfo, type Proposal } from '../mcp/host';
import { MAX_ITEMS, MAX_TEXT } from '../mcp/tools';
import { agentSettingsFrom, AGENT_DEFAULT_PORT, isAgentPort } from '../../shared/agents';

const SECRET = 'key-that-must-never-leave-the-app-0123456789';

const servers: McpServerInfo[] = [
  { id: 'srv-1', name: 'Work', url: 'https://redmine.work.example', signedIn: true, login: 'ana', active: true },
  { id: 'srv-2', name: 'Home', url: 'https://home.example', signedIn: false, active: false },
];

/** The changes proposed in the current test. */
let proposals: Proposal[] = [];

/** A host with two servers, one signed in. The key is kept here, as the app keeps it. */
function host(): McpHost {
  return {
    servers: () => servers,
    access: (id) => (id === 'srv-1' ? { baseUrl: 'https://redmine.work.example', apiKey: SECRET } : null),
    propose: ({ serverId, serverName, change, summary }) => {
      const proposal: Proposal = {
        id: `p${proposals.length + 1}`,
        serverId,
        serverName,
        change,
        summary,
        status: 'waiting',
        outcome: null,
        createdAt: '2026-10-26T00:00:00Z',
      };
      proposals.push(proposal);
      return proposal;
    },
    proposal: (id) => proposals.find((candidate) => candidate.id === id) ?? null,
  };
}

beforeEach(() => {
  proposals = [];
});

const issue = (id: number, subject = `Task ${id}`) => ({
  id,
  project: { id: 3, name: 'Platform' },
  tracker: { id: 1, name: 'Feature' },
  status: { id: 1, name: 'New' },
  priority: { id: 2, name: 'Normal' },
  subject,
  start_date: '2026-10-01',
  due_date: '2026-10-31',
  done_ratio: 40,
});

function api(overrides: Partial<McpApi> = {}): McpApi {
  return {
    listAssignedTasks: vi.fn(async () => [issue(7), issue(8)]),
    getTask: vi.fn(async (_access, taskId) => ({
      issue: {
        ...issue(taskId, 'Fix login'),
        description: 'Users cannot sign in.',
        author: { id: 1, name: 'Ana' },
        assigned_to: { id: 2, name: 'Bo' },
        estimated_hours: 4,
        spent_hours: 1.5,
        created_on: '2026-10-01T09:00:00Z',
        updated_on: '2026-10-02T09:00:00Z',
        closed_on: null,
      },
      names: {},
    })),
    listTimeActivities: vi.fn(async () => [
      { id: 9, name: 'Development' },
      { id: 10, name: 'Review' },
    ]),
    listTaskOptions: vi.fn(async () => ({
      statuses: [
        { id: 1, name: 'New' },
        { id: 2, name: 'In progress' },
      ],
      priorities: [{ id: 2, name: 'Normal' }],
    })),
    createLogEntry: vi.fn(async () => {}),
    updateTask: vi.fn(async () => {}),
    listTaskLogEntries: vi.fn(async () => [
      {
        id: 90,
        project: { id: 3, name: 'Platform' },
        issue: { id: 7 },
        user: { id: 1, name: 'Ana' },
        activity: { id: 9, name: 'Development' },
        hours: 1.25,
        comments: 'Reproduced',
        spent_on: '2026-10-20',
      },
      {
        id: 91,
        project: { id: 3, name: 'Platform' },
        issue: { id: 7 },
        user: { id: 2, name: 'Bo' },
        activity: { id: 9, name: 'Development' },
        hours: 0.75,
        spent_on: '2026-10-21',
      },
    ]),
    ...overrides,
  } as McpApi;
}

const deps = (overrides: Partial<McpDeps> = {}): McpDeps => ({ host: host(), api: api(), version: '1.0.0-unstable.9', ...overrides });

/** Sends one message and reads the answer back. */
async function ask(message: unknown, options: Partial<McpDeps> = {}) {
  const text = await answerMcp(typeof message === 'string' ? message : JSON.stringify(message), deps(options));
  return text === '' ? null : JSON.parse(text);
}

const call = (name: string, args: Record<string, unknown> = {}, id: number | string = 1) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

const parsed = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The text an agent reads from a tool result, parsed. */
async function toolResult(name: string, args: Record<string, unknown> = {}, options: Partial<McpDeps> = {}) {
  const reply = await ask(call(name, args), options);
  const raw = reply.result.content[0].text as string;
  // A failed call says so in words, which are not JSON.
  return { isError: reply.result.isError === true, data: parsed(raw), raw };
}

describe('the protocol handshake', () => {
  it('answers initialize with the version the agent asked for, when this endpoint knows it', async () => {
    const reply = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });

    expect(reply.result.protocolVersion).toBe('2025-03-26');
    expect(reply.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(reply.result.serverInfo).toEqual({ name: 'Gemiredmine', version: '1.0.0-unstable.9' });
  });

  it('answers with its own latest version when the agent asks for one it does not know', async () => {
    const reply = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });

    expect(reply.result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('answers ping, and sends nothing back for a notification', async () => {
    expect(await ask({ jsonrpc: '2.0', id: 'p', method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 'p', result: {} });
    expect(await ask({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await ask({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } })).toBeNull();
  });

  it('refuses a message that is not JSON, a batch, and a method it does not have, each with its code', async () => {
    expect((await ask('not json')).error.code).toBe(-32700);
    expect((await ask([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).error.code).toBe(-32600);
    expect((await ask({ jsonrpc: '2.0', id: 4, method: 'resources/read' })).error).toEqual({
      code: -32601,
      message: 'The endpoint has no method resources/read.',
    });
    expect((await ask({ jsonrpc: '1.0', id: 5, method: 'ping' })).error.code).toBe(-32600);
  });
});

describe('the tools an agent sees', () => {
  it('lists every tool, each with a schema and an honest read-only mark', async () => {
    const { result } = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'list_servers',
      'list_assigned_tasks',
      'get_task',
      'list_task_time',
      'list_time_activities',
      'log_time',
      'update_task',
      'get_proposal',
    ]);
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  it('lists the servers the user added, and never the API key', async () => {
    const { data, raw } = await toolResult('list_servers');

    expect(data.servers).toEqual([
      { id: 'srv-1', name: 'Work', url: 'https://redmine.work.example', signedIn: true, login: 'ana', active: true },
      { id: 'srv-2', name: 'Home', url: 'https://home.example', signedIn: false, login: null, active: false },
    ]);
    expect(raw).not.toContain(SECRET);
  });

  it('lists the assigned tasks of the active server when no server is named', async () => {
    const { data } = await toolResult('list_assigned_tasks');

    expect(data.server).toBe('Work');
    expect(data.count).toBe(2);
    expect(data.tasks[0]).toEqual({
      id: 7,
      subject: 'Task 7',
      project: 'Platform',
      tracker: 'Feature',
      status: 'New',
      priority: 'Normal',
      startDate: '2026-10-01',
      dueDate: '2026-10-31',
      doneRatio: 40,
    });
  });

  it('finds a server by its name, in any case, as well as by its id', async () => {
    expect((await toolResult('list_assigned_tasks', { server: 'work' })).data.server).toBe('Work');
    expect((await toolResult('list_assigned_tasks', { server: 'srv-1' })).data.server).toBe('Work');
  });

  it('gives the task in full, with its description cut when it is very long', async () => {
    const { data, raw } = await toolResult('get_task', { taskId: 7 });

    expect(data.task).toMatchObject({ id: 7, subject: 'Fix login', author: 'Ana', assignedTo: 'Bo', estimatedHours: 4, spentHours: 1.5 });
    expect(data.task.description).toBe('Users cannot sign in.');
    expect(raw).not.toContain(SECRET);
  });

  it('cuts a description that is longer than the limit, and says how much was cut', async () => {
    const long = 'x'.repeat(MAX_TEXT + 50);
    const getTask = vi.fn(async (_access: unknown, taskId: number) => ({ issue: { ...issue(taskId), description: long }, names: {} }));

    const { data } = await toolResult('get_task', { taskId: 7 }, { api: api({ getTask: getTask as McpApi['getTask'] }) });

    expect(data.task.description.startsWith('x'.repeat(MAX_TEXT))).toBe(true);
    expect(data.task.description).toContain('(cut, 50 more characters)');
  });

  it('totals the time logged on a task, and lists the entries', async () => {
    const { data } = await toolResult('list_task_time', { taskId: 7 });

    expect(data.totalHours).toBe(2);
    expect(data.count).toBe(2);
    expect(data.entries[0]).toEqual({
      id: 90,
      spentOn: '2026-10-20',
      hours: 1.25,
      user: 'Ana',
      activity: 'Development',
      taskId: 7,
      comments: 'Reproduced',
    });
  });

  it('cuts a long list to the limit, and says that it did', async () => {
    const many = Array.from({ length: MAX_ITEMS + 5 }, (_, index) => issue(index + 1));
    const { data } = await toolResult('list_assigned_tasks', {}, { api: api({ listAssignedTasks: vi.fn(async () => many) }) });

    expect(data.count).toBe(MAX_ITEMS + 5);
    expect(data.truncated).toBe(true);
    expect(data.tasks).toHaveLength(MAX_ITEMS);
  });
});

describe('the answers an agent gets when a call cannot be made', () => {
  it('says so, in the result, when the server is not signed in', async () => {
    const { isError, data } = await toolResult('list_assigned_tasks', { server: 'Home' });

    expect(isError).toBe(true);
    expect(data).toBeUndefined();
  });

  it('says why in words an agent can act on', async () => {
    const home = await ask(call('list_assigned_tasks', { server: 'Home' }));
    expect(home.result.content[0].text).toBe('You are not signed in to Home. Sign in to it in the app first.');

    const unknown = await ask(call('list_assigned_tasks', { server: 'Office' }));
    expect(unknown.result.content[0].text).toBe('No server is called Office. The servers are: Work, Home.');

    const none = await ask(call('list_assigned_tasks'), { host: { ...host(), servers: () => [], access: () => null } });
    expect(none.result.content[0].text).toBe('No server is shown in the app. Name a server, such as one of: none.');
  });

  it('refuses a task that is not named by a whole positive id', async () => {
    for (const taskId of [0, -3, 1.5, '7', undefined]) {
      const reply = await ask(call('get_task', { taskId }));
      expect(reply.result.isError, String(taskId)).toBe(true);
      expect(reply.result.content[0].text).toBe('The task is named by its Redmine id, a whole number from 1.');
    }
  });

  it('passes on a Redmine failure, such as a task that cannot be seen', async () => {
    const getTask = vi.fn(async () => {
      throw new Error('Redmine could not find that task.');
    });

    const reply = await ask(call('get_task', { taskId: 9 }), { api: api({ getTask: getTask as McpApi['getTask'] }) });

    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toBe('Redmine could not find that task.');
  });

  it('answers an unknown tool with a protocol error, not a result', async () => {
    const reply = await ask(call('delete_everything'));

    expect(reply.error).toEqual({ code: -32602, message: 'There is no tool called delete_everything.' });
  });

  it('declares that a tool takes only the arguments it names', async () => {
    const { result } = await ask({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const getTask = result.tools.find((tool: { name: string }) => tool.name === 'get_task');

    expect(getTask.inputSchema.additionalProperties).toBe(false);
    expect(getTask.inputSchema.required).toEqual(['taskId']);
  });
});

describe('the changes an agent may propose', () => {
  it('lists the activities that time can be logged under', async () => {
    const { data } = await toolResult('list_time_activities');

    expect(data.activities).toEqual([
      { id: 9, name: 'Development' },
      { id: 10, name: 'Review' },
    ]);
  });

  it('proposes a log entry, and does not save it in Redmine', async () => {
    const writes = api();
    const { isError, data } = await toolResult(
      'log_time',
      { taskId: 7, hours: 1.5, activityId: 9, spentOn: '2026-10-20', comments: 'Reproduced' },
      { api: writes }
    );

    expect(isError).toBe(false);
    expect(data).toMatchObject({ proposalId: 'p1', status: 'waiting' });
    expect(data.summary).toBe('Log 1.5 h on task #7 “Fix login”, activity Development, on 2026-10-20. Comment: “Reproduced”.');
    expect(writes.createLogEntry).not.toHaveBeenCalled();
    expect(proposals[0].change).toEqual({
      kind: 'log_time',
      taskId: 7,
      spentOn: '2026-10-20',
      hours: 1.5,
      activityId: 9,
      comments: 'Reproduced',
    });
  });

  it('dates a log entry today when no day is given', async () => {
    const { data } = await toolResult('log_time', { taskId: 7, hours: 1, activityId: 9 });

    expect(proposals[0].change).toMatchObject({ kind: 'log_time', spentOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(data.status).toBe('waiting');
  });

  it('refuses a log entry that cannot be made, before it proposes anything', async () => {
    for (const args of [
      { taskId: 7, hours: 0, activityId: 9 },
      { taskId: 7, hours: 25, activityId: 9 },
      { taskId: 7, hours: '2', activityId: 9 },
      { taskId: 7, hours: 1, activityId: 9, spentOn: '2026-02-30' },
      { taskId: 7, hours: 1, activityId: 9, comments: 'x'.repeat(1001) },
    ]) {
      const reply = await ask(call('log_time', args));
      expect(reply.result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(proposals).toHaveLength(0);
  });

  it('refuses an activity that the server does not have, and says where to look', async () => {
    const reply = await ask(call('log_time', { taskId: 7, hours: 1, activityId: 99 }));

    expect(reply.result.content[0].text).toBe(
      'Activity 99 is not one of the activities of Work. Use list_time_activities to see them.'
    );
    expect(proposals).toHaveLength(0);
  });

  it('proposes a status, a % done and a note on a task, by the status name', async () => {
    const { data } = await toolResult('update_task', { taskId: 7, status: 'in progress', doneRatio: 60, notes: 'Found the cause' });

    expect(data).toMatchObject({ proposalId: 'p1', status: 'waiting' });
    expect(data.summary).toBe('Change task #7 “Fix login”: status New → In progress, 60 % done, a note “Found the cause”.');
    expect(proposals[0].change).toEqual({ kind: 'update_task', taskId: 7, statusId: 2, doneRatio: 60, notes: 'Found the cause' });
  });

  it('refuses an update that names no change, and a status that the task does not have', async () => {
    const empty = await ask(call('update_task', { taskId: 7 }));
    expect(empty.result.content[0].text).toBe('Name at least one change: a status, a % done, or a note.');

    const unknown = await ask(call('update_task', { taskId: 7, status: 'Done' }));
    expect(unknown.result.content[0].text).toBe('No status is called Done. The statuses are: New, In progress.');
    expect(proposals).toHaveLength(0);
  });

  it('follows a proposal to its outcome, and says when there is none', async () => {
    await toolResult('log_time', { taskId: 7, hours: 1, activityId: 9 });
    proposals[0].status = 'done';
    proposals[0].outcome = 'Logged 1 h on task #7.';

    const { data } = await toolResult('get_proposal', { proposalId: 'p1' });
    expect(data).toEqual({
      proposalId: 'p1',
      kind: 'log_time',
      taskId: 7,
      server: 'Work',
      status: 'done',
      summary: proposals[0].summary,
      outcome: 'Logged 1 h on task #7.',
    });

    const unknown = await ask(call('get_proposal', { proposalId: 'p9' }));
    expect(unknown.result.content[0].text).toBe('There is no change with that proposalId.');
  });

  it('passes on the refusal of the app when too many changes are waiting', async () => {
    const full = {
      ...host(),
      propose: () => {
        throw new Error(`${MAX_WAITING_PROPOSALS} changes are already waiting for the user.`);
      },
    };

    const reply = await ask(call('log_time', { taskId: 7, hours: 1, activityId: 9 }), { host: full });

    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toBe(`${MAX_WAITING_PROPOSALS} changes are already waiting for the user.`);
  });

  it('lists the write tools as not read-only, and the reads as read-only', async () => {
    const { result } = await ask({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const annotations = Object.fromEntries(result.tools.map((tool: { name: string; annotations: { readOnlyHint: boolean } }) => [tool.name, tool.annotations.readOnlyHint]));

    expect(annotations).toMatchObject({ log_time: false, update_task: false, get_proposal: true, list_time_activities: true });
  });
});

describe('the settings of the endpoint', () => {
  it('is off, on the default port, when nothing was saved or what was saved is wrong', () => {
    expect(agentSettingsFrom(undefined)).toEqual({ enabled: false, port: AGENT_DEFAULT_PORT });
    expect(agentSettingsFrom({ enabled: 'yes', port: 80 })).toEqual({ enabled: false, port: AGENT_DEFAULT_PORT });
    expect(agentSettingsFrom({ enabled: true, port: 1.5 })).toEqual({ enabled: false, port: AGENT_DEFAULT_PORT });
  });

  it('keeps a port from 1024 to 65535, and no other', () => {
    expect(isAgentPort(1024)).toBe(true);
    expect(isAgentPort(65535)).toBe(true);
    expect(isAgentPort(1023)).toBe(false);
    expect(isAgentPort(65536)).toBe(false);
    expect(isAgentPort('47831')).toBe(false);
    expect(agentSettingsFrom({ enabled: true, port: 50000 })).toEqual({ enabled: true, port: 50000 });
  });
});
