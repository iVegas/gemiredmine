// The tools an agent can call. Every one of them reads: nothing here changes Redmine, so each is marked read-only.
// A write (logging time, changing a task) needs the user's approval in the app first, and is not offered yet.

import type { RedmineIssue, RedmineIssueDetails, RedmineReference, RedmineTimeEntry } from '../redmine/types';
import type { McpDeps, McpServerInfo } from './host';

/** Lists longer than this are cut, so that one answer stays small enough for an agent to read. */
export const MAX_ITEMS = 100;
/** A description longer than this is cut. The full text is one click away in Redmine. */
export const MAX_TEXT = 4000;

type Args = Record<string, unknown>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  run(args: Args, deps: McpDeps): Promise<unknown>;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const SERVER_ARGUMENT = {
  server: {
    type: 'string',
    description: 'The server, by its id or its name. Without it, the server the app shows is used.',
  },
};

const TASK_ARGUMENT = {
  taskId: { type: 'integer', minimum: 1, description: 'The Redmine id of the task, such as 42.' },
};

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** Cuts text to the limit, and says so. Missing text is an empty string. */
export function clip(text: string | null | undefined, limit = MAX_TEXT): string {
  const value = text ?? '';
  return value.length > limit ? `${value.slice(0, limit)}… (cut, ${value.length - limit} more characters)` : value;
}

const named = (reference: RedmineReference | null | undefined): string | null => reference?.name ?? null;

/** The names of servers, for a sentence an agent can read. */
const names = (servers: McpServerInfo[]) => (servers.length ? servers.map((server) => server.name).join(', ') : 'none');

/** The server an agent means: by id, by name, or the one the app shows. Throws a sentence the agent can act on. */
export function resolveServer(host: McpDeps['host'], reference: unknown) {
  const servers = host.servers();
  let info: McpServerInfo | undefined;
  if (reference === undefined || reference === '') {
    info = servers.find((server) => server.active);
    if (!info) throw new Error('No server is shown in the app. Name a server, such as one of: ' + names(servers) + '.');
  } else {
    if (typeof reference !== 'string') throw new Error('The server must be named by its id or its name.');
    const byId = servers.filter((server) => server.id === reference);
    const byName = servers.filter((server) => server.name.toLowerCase() === reference.toLowerCase());
    const matches = byId.length > 0 ? byId : byName;
    if (matches.length > 1) throw new Error(`More than one server is called ${reference}. Name it by its id.`);
    info = matches[0];
    if (!info) throw new Error(`No server is called ${reference}. The servers are: ${names(servers)}.`);
  }
  const access = host.access(info.id);
  if (!access) throw new Error(`You are not signed in to ${info.name}. Sign in to it in the app first.`);
  return { info, access };
}

function taskId(args: Args): number {
  const value = args.taskId;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('The task is named by its Redmine id, a whole number from 1.');
  }
  return value;
}

function taskSummary(issue: RedmineIssue) {
  return {
    id: issue.id,
    subject: issue.subject,
    project: named(issue.project),
    tracker: named(issue.tracker),
    status: named(issue.status),
    priority: named(issue.priority),
    startDate: issue.start_date ?? null,
    dueDate: issue.due_date ?? null,
    doneRatio: issue.done_ratio ?? null,
  };
}

function timeSummary(entry: RedmineTimeEntry) {
  return {
    id: entry.id,
    spentOn: entry.spent_on,
    hours: entry.hours,
    user: named(entry.user),
    activity: named(entry.activity),
    taskId: entry.issue?.id ?? null,
    comments: clip(entry.comments, 1000),
  };
}

function detailsSummary(issue: RedmineIssueDetails) {
  return {
    ...taskSummary(issue),
    description: clip(issue.description),
    author: named(issue.author),
    assignedTo: named(issue.assigned_to),
    estimatedHours: issue.estimated_hours ?? null,
    spentHours: issue.spent_hours ?? null,
    createdOn: issue.created_on ?? null,
    updatedOn: issue.updated_on ?? null,
    closedOn: issue.closed_on ?? null,
  };
}

const serverList: McpTool = {
  name: 'list_servers',
  description:
    'The Redmine servers the user has added to the app, with whether the user is signed in to each. The active server is the one the app shows. The answer never includes an API key.',
  inputSchema: schema({}),
  annotations: READ_ONLY,
  async run(_args, { host }) {
    return {
      servers: host.servers().map((server) => ({
        id: server.id,
        name: server.name,
        url: server.url,
        signedIn: server.signedIn,
        login: server.login ?? null,
        active: server.active,
      })),
    };
  },
};

const assignedTasks: McpTool = {
  name: 'list_assigned_tasks',
  description: 'The open tasks assigned to the user on one server, as Redmine lists them. Tasks are summaries; use get_task for one in full.',
  inputSchema: schema(SERVER_ARGUMENT),
  annotations: READ_ONLY,
  async run(args, deps) {
    const { info, access } = resolveServer(deps.host, args.server);
    const issues = await deps.api.listAssignedTasks(access);
    return {
      server: info.name,
      count: issues.length,
      truncated: issues.length > MAX_ITEMS,
      tasks: issues.slice(0, MAX_ITEMS).map(taskSummary),
    };
  },
};

const getTask: McpTool = {
  name: 'get_task',
  description: 'One task in full: its description, people, estimate, time spent and dates. The description is cut when it is very long.',
  inputSchema: schema({ ...SERVER_ARGUMENT, ...TASK_ARGUMENT }, ['taskId']),
  annotations: READ_ONLY,
  async run(args, deps) {
    const { info, access } = resolveServer(deps.host, args.server);
    const { issue } = await deps.api.getTask(access, taskId(args));
    return { server: info.name, task: detailsSummary(issue) };
  },
};

const taskTime: McpTool = {
  name: 'list_task_time',
  description: 'The time logged on one task, by anyone the user may see, the latest day first, with the total hours.',
  inputSchema: schema({ ...SERVER_ARGUMENT, ...TASK_ARGUMENT }, ['taskId']),
  annotations: READ_ONLY,
  async run(args, deps) {
    const { info, access } = resolveServer(deps.host, args.server);
    const id = taskId(args);
    const entries = await deps.api.listTaskLogEntries(access, id);
    return {
      server: info.name,
      taskId: id,
      totalHours: Math.round(entries.reduce((sum, entry) => sum + entry.hours, 0) * 100) / 100,
      count: entries.length,
      truncated: entries.length > MAX_ITEMS,
      entries: entries.slice(0, MAX_ITEMS).map(timeSummary),
    };
  },
};

/** Every tool the endpoint offers, in the order the agent sees them. */
export const TOOLS: readonly McpTool[] = [serverList, assignedTasks, getTask, taskTime];
