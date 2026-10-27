// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildTaskChanges, runProposal, type ProposalApi } from '../mcp/proposals';
import type { Proposal } from '../mcp/host';

const access = { baseUrl: 'https://redmine.work.example', apiKey: 'key' };

const issue = {
  subject: 'Fix login',
  description: 'Users cannot sign in.',
  status: { id: 1, name: 'New' },
  priority: { id: 2, name: 'Normal' },
  start_date: '2026-10-01',
  due_date: '2026-10-31',
  done_ratio: 20,
  estimated_hours: 4,
};

function proposal(change: Proposal['change']): Proposal {
  return {
    id: 'p1',
    serverId: 'srv-1',
    serverName: 'Work',
    change,
    summary: 'A summary',
    status: 'running',
    outcome: null,
    createdAt: '2026-10-26T00:00:00Z',
  };
}

function api(overrides: Partial<ProposalApi> = {}): ProposalApi {
  return {
    getTask: vi.fn(async (_access, taskId) => ({ issue: { ...issue, id: taskId }, names: {} })),
    createLogEntry: vi.fn(async () => {}),
    updateTask: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ProposalApi;
}

describe('the complete task that an update sends', () => {
  it('keeps every field the change does not name, as the task has it now', () => {
    const changes = buildTaskChanges(issue, { statusId: null, doneRatio: null, notes: '' });

    expect(changes).toEqual({
      subject: 'Fix login',
      description: 'Users cannot sign in.',
      statusId: 1,
      priorityId: 2,
      startDate: '2026-10-01',
      dueDate: '2026-10-31',
      doneRatio: 20,
      estimatedHours: 4,
      notes: '',
    });
  });

  it('takes the status and the % done that the change names, and the note', () => {
    const changes = buildTaskChanges(issue, { statusId: 2, doneRatio: 80, notes: 'Done in staging' });

    expect(changes).toMatchObject({ statusId: 2, doneRatio: 80, notes: 'Done in staging' });
  });

  it('clears what Redmine has no value for, rather than sending nothing', () => {
    const changes = buildTaskChanges(
      { subject: 'Bare', status: { id: 1 }, priority: { id: 2 } },
      { statusId: null, doneRatio: null, notes: '' }
    );

    expect(changes).toMatchObject({ description: '', startDate: null, dueDate: null, doneRatio: 0, estimatedHours: null });
  });
});

describe('running an approved change', () => {
  it('saves a log entry with the values the proposal carries', async () => {
    const writes = api();
    const outcome = await runProposal(
      proposal({ kind: 'log_time', taskId: 7, spentOn: '2026-10-20', hours: 1.5, activityId: 9, comments: 'Reproduced' }),
      access,
      writes
    );

    expect(writes.createLogEntry).toHaveBeenCalledExactlyOnceWith(access, {
      taskId: 7,
      spentOn: '2026-10-20',
      hours: 1.5,
      activityId: 9,
      comments: 'Reproduced',
    });
    expect(outcome).toBe('Logged 1.5 h on task #7.');
  });

  it('reads the task again before it updates it, so a change made since the proposal is kept', async () => {
    const writes = api({
      getTask: vi.fn(async () => ({ issue: { ...issue, id: 7, done_ratio: 55 }, names: {} })) as unknown as ProposalApi['getTask'],
    });

    const outcome = await runProposal(proposal({ kind: 'update_task', taskId: 7, statusId: 2, doneRatio: null, notes: '' }), access, writes);

    expect(writes.getTask).toHaveBeenCalledWith(access, 7);
    expect(writes.updateTask).toHaveBeenCalledExactlyOnceWith(access, 7, expect.objectContaining({ statusId: 2, doneRatio: 55 }));
    expect(outcome).toBe('Updated task #7.');
  });

  it('lets a failure of Redmine reach the user, with its own words', async () => {
    const writes = api({
      createLogEntry: vi.fn(async () => {
        throw new Error('Redmine does not let you log time on this task.');
      }) as unknown as ProposalApi['createLogEntry'],
    });

    await expect(
      runProposal(proposal({ kind: 'log_time', taskId: 7, spentOn: '2026-10-20', hours: 1, activityId: 9, comments: '' }), access, writes)
    ).rejects.toThrow('Redmine does not let you log time on this task.');
  });
});
