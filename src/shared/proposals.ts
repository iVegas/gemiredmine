// A change that an AI agent asked for, which waits for the user. The app keeps it in its database, so it survives a
// restart, and the endpoint answers an agent about it from there (src/bun/mcp).

/**
 * A change that an agent asks for. It does nothing until the user approves it in the app: the agent only proposes it.
 * A status is named by its id here, because the tool resolved the name when it proposed the change.
 */
export type ProposedChange =
  | {
      kind: 'log_time';
      taskId: number;
      /** YYYY-MM-DD */
      spentOn: string;
      hours: number;
      activityId: number;
      comments: string;
    }
  | {
      kind: 'update_task';
      taskId: number;
      statusId: number | null;
      doneRatio: number | null;
      notes: string;
    };

export const PROPOSAL_STATUSES = ['waiting', 'running', 'done', 'failed', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** A change that waits for the user, and what became of it. */
export interface Proposal {
  id: string;
  serverId: string;
  serverName: string;
  change: ProposedChange;
  /** A sentence the user can read before approving. */
  summary: string;
  status: ProposalStatus;
  /** What happened when the change ran: its result, or the reason it failed. Null until then. */
  outcome: string | null;
  createdAt: string;
}
