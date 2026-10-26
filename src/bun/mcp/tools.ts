// The tools an agent can call. The reads answer at once. The two changes only propose: the user approves each one in the
// app, and nothing reaches Redmine before that (see proposals.ts).

import type { RedmineIssue, RedmineIssueDetails, RedmineReference, RedmineTimeEntry } from '../redmine/types';
import type { McpDeps, McpServerInfo, Proposal, ProposedChange } from './host';

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
/** A proposal changes the endpoint's own list of waiting changes, so it is not read-only, but it changes nothing in Redmine. */
const PROPOSES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date on this computer, as YYYY-MM-DD. */
function localToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The day that time is logged on: given, or today. It must be a real calendar day. */
function spentOn(args: Args): string {
  const value = args.spentOn ?? localToday();
  const real = typeof value === 'string' && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!real) throw new Error('The date is YYYY-MM-DD, such as 2026-10-26.');
  return value as string;
}

/** The hours of a log entry, to two decimals: above 0, up to a working day. */
function hours(args: Args): number {
  const value = args.hours;
  const rounded = typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
  if (!(rounded > 0 && rounded <= 24)) throw new Error('The hours are a number above 0 and up to 24, such as 1.5.');
  return rounded;
}

function positiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`${name} is a whole number from 1.`);
  return value;
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} is text of up to ${max} characters.`);
  return value;
}

function optionalInt(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} is a whole number from ${min} to ${max}.`);
  }
  return value;
}

/** What a proposing tool answers: the id to follow it with, and what the agent must tell the user. */
function waiting(proposal: Proposal) {
  return {
    proposalId: proposal.id,
    status: proposal.status,
    summary: proposal.summary,
    message: 'Waiting for the user to approve it in Gemiredmine. Nothing has changed in Redmine yet. Check it with get_proposal.',
  };
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

const timeActivities: McpTool = {
  name: 'list_time_activities',
  description: 'The activities that time can be logged under on one server. Use one of their ids for log_time.',
  inputSchema: schema(SERVER_ARGUMENT),
  annotations: READ_ONLY,
  async run(args, deps) {
    const { info, access } = resolveServer(deps.host, args.server);
    const activities = await deps.api.listTimeActivities(access);
    return { server: info.name, activities: activities.map(({ id, name }) => ({ id, name })) };
  },
};

const logTime: McpTool = {
  name: 'log_time',
  description:
    'Proposes a log entry of time on a task. The user approves it in the app before it is saved in Redmine. Use list_time_activities for the activity id. Follow it with get_proposal.',
  inputSchema: schema(
    {
      ...SERVER_ARGUMENT,
      ...TASK_ARGUMENT,
      hours: { type: 'number', exclusiveMinimum: 0, maximum: 24, description: 'The hours, such as 1.5. Up to two decimals.' },
      activityId: { type: 'integer', minimum: 1, description: 'The id of the activity, from list_time_activities.' },
      spentOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The day, YYYY-MM-DD. Today when it is left out.' },
      comments: { type: 'string', maxLength: 1000, description: 'A comment for the log entry.' },
    },
    ['taskId', 'hours', 'activityId']
  ),
  annotations: PROPOSES,
  async run(args, deps) {
    const { info, access } = resolveServer(deps.host, args.server);
    const id = taskId(args);
    const amount = hours(args);
    const activityId = positiveInt(args.activityId, 'activityId');
    const day = spentOn(args);
    const comments = optionalString(args.comments, 'comments', 1000) ?? '';

    // The task and the activity are checked now, so that the user is asked about a change that can be made.
    const [{ issue }, activities] = await Promise.all([deps.api.getTask(access, id), deps.api.listTimeActivities(access)]);
    const activity = activities.find((candidate) => candidate.id === activityId);
    if (!activity) {
      throw new Error(`Activity ${activityId} is not one of the activities of ${info.name}. Use list_time_activities to see them.`);
    }
    const change: ProposedChange = { kind: 'log_time', taskId: id, spentOn: day, hours: amount, activityId, comments };
    const summary =
      `Log ${amount} h on task #${id} “${issue.subject}”, activity ${activity.name}, on ${day}.` +
      (comments ? ` Comment: “${comments}”.` : '');
    return waiting(deps.host.propose({ serverId: info.id, serverName: info.name, change, summary }));
  },
};

const updateTask: McpTool = {
  name: 'update_task',
  description:
    'Proposes a change to a task: its status, its % done, or a note added to its history. The user approves it in the app before Redmine is changed. Follow it with get_proposal.',
  inputSchema: schema(
    {
      ...SERVER_ARGUMENT,
      ...TASK_ARGUMENT,
      status: { type: 'string', maxLength: 100, description: 'The new status, by its name, such as In progress.' },
      doneRatio: { type: 'integer', minimum: 0, maximum: 100, description: 'The new % done.' },
      notes: { type: 'string', maxLength: 2000, description: 'A note to add to the history of the task.' },
    },
    ['taskId']
  ),
  annotations: PROPOSES,
  async run(args, deps) {
    const { info, access } = resolveServer(deps.host, args.server);
    const id = taskId(args);
    const statusName = optionalString(args.status, 'status', 100);
    const doneRatio = optionalInt(args.doneRatio, 'doneRatio', 0, 100);
    const notes = optionalString(args.notes, 'notes', 2000) ?? '';
    if (statusName === undefined && doneRatio === undefined && notes === '') {
      throw new Error('Name at least one change: a status, a % done, or a note.');
    }

    const { issue } = await deps.api.getTask(access, id);
    const parts: string[] = [];
    let statusId: number | null = null;
    if (statusName !== undefined) {
      const { statuses } = await deps.api.listTaskOptions(access);
      const matches = statuses.filter((status) => status.name.toLowerCase() === statusName.toLowerCase());
      if (matches.length !== 1) {
        throw new Error(`No status is called ${statusName}. The statuses are: ${statuses.map((status) => status.name).join(', ')}.`);
      }
      statusId = matches[0].id;
      parts.push(`status ${issue.status.name} → ${matches[0].name}`);
    }
    if (doneRatio !== undefined) parts.push(`${doneRatio} % done`);
    if (notes !== '') parts.push(`a note “${notes}”`);

    const change: ProposedChange = { kind: 'update_task', taskId: id, statusId, doneRatio: doneRatio ?? null, notes };
    const summary = `Change task #${id} “${issue.subject}”: ${parts.join(', ')}.`;
    return waiting(deps.host.propose({ serverId: info.id, serverName: info.name, change, summary }));
  },
};

const followProposal: McpTool = {
  name: 'get_proposal',
  description: 'Whether a change you proposed is still waiting for the user, was approved and ran, failed, or was rejected, and what it did.',
  inputSchema: schema({ proposalId: { type: 'string', description: 'The proposalId that the proposing tool returned.' } }, ['proposalId']),
  annotations: READ_ONLY,
  async run(args, deps) {
    const id = args.proposalId;
    if (typeof id !== 'string' || id === '') throw new Error('The change is named by the proposalId that the proposing tool returned.');
    const proposal = deps.host.proposal(id);
    if (!proposal) throw new Error('There is no change with that proposalId.');
    return {
      proposalId: proposal.id,
      kind: proposal.change.kind,
      taskId: proposal.change.taskId,
      server: proposal.serverName,
      status: proposal.status,
      summary: proposal.summary,
      outcome: proposal.outcome,
    };
  },
};

/** Every tool the endpoint offers, in the order the agent sees them. */
export const TOOLS: readonly McpTool[] = [serverList, assignedTasks, getTask, taskTime, timeActivities, logTime, updateTask, followProposal];

