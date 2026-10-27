// What happens when the user approves a change an agent proposed. It runs with the user's own API key, through the same
// Redmine calls the app makes itself, so Redmine decides what is allowed and says so when it refuses.

import type { ServerAccess, TaskChanges } from '../../shared/backend';
import type { McpApi, Proposal } from './host';

/** The Redmine calls a proposal makes. */
export type ProposalApi = Pick<McpApi, 'getTask' | 'createLogEntry' | 'updateTask'>;

/**
 * The complete task that an update sends. Redmine replaces every field it is given, so the fields that the change does
 * not name keep the values the task has now.
 */
export function buildTaskChanges(
  issue: {
    subject: string;
    description?: string;
    priority: { id: number };
    start_date?: string | null;
    due_date?: string | null;
    done_ratio?: number;
    estimated_hours?: number | null;
    status: { id: number };
  },
  change: { statusId: number | null; doneRatio: number | null; notes: string }
): TaskChanges {
  return {
    subject: issue.subject,
    description: issue.description ?? '',
    statusId: change.statusId ?? issue.status.id,
    priorityId: issue.priority.id,
    startDate: issue.start_date ?? null,
    dueDate: issue.due_date ?? null,
    doneRatio: change.doneRatio ?? issue.done_ratio ?? 0,
    estimatedHours: issue.estimated_hours ?? null,
    notes: change.notes,
  };
}

/** Runs an approved change. Returns what it did, in words; throws the reason it could not. */
export async function runProposal(proposal: Proposal, access: ServerAccess, api: ProposalApi): Promise<string> {
  const { change } = proposal;
  if (change.kind === 'log_time') {
    await api.createLogEntry(access, {
      taskId: change.taskId,
      spentOn: change.spentOn,
      hours: change.hours,
      activityId: change.activityId,
      comments: change.comments,
    });
    return `Logged ${change.hours} h on task #${change.taskId}.`;
  }
  // The task is read again now, so that the update keeps whatever changed since the agent looked at it.
  const { issue } = await api.getTask(access, change.taskId);
  await api.updateTask(access, change.taskId, buildTaskChanges(issue, change));
  return `Updated task #${change.taskId}.`;
}
