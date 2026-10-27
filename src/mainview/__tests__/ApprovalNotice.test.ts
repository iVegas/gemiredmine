import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ApprovalNotice from '../ApprovalNotice.svelte';
import { agentProposals, approveAgentProposal, rejectAgentProposal } from '../lib/mcp-host';
import type { Proposal } from '../../shared/proposals';

vi.mock('../lib/mcp-host', async () => {
  const { writable } = await import('svelte/store');
  return {
    agentProposals: writable([]),
    approveAgentProposal: vi.fn(),
    rejectAgentProposal: vi.fn(),
  };
});

const proposal = (overrides: Partial<Proposal>): Proposal => ({
  id: 'p1',
  serverId: 'dev',
  serverName: 'Dev',
  change: {} as Proposal['change'],
  summary: 'Log 3 h on #6137',
  status: 'waiting',
  outcome: null,
  createdAt: '2026-10-27T10:00:00.000Z',
  ...overrides,
});

describe('the approval notice in the main window', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    agentProposals.set([]);
  });

  it('shows nothing when no change waits for the user', () => {
    agentProposals.set([proposal({ id: 'done', status: 'done', outcome: 'Logged.' })]);

    const view = render(ApprovalNotice);

    expect(view.queryByRole('region', { name: 'Changes waiting for your approval' })).toBeNull();
  });

  it('shows each waiting change with its server, and leaves out the decided ones', () => {
    agentProposals.set([
      proposal({ id: 'a', summary: 'Log 3 h on #6137' }),
      proposal({ id: 'b', summary: 'Set #6138 to Closed', serverName: 'Golems' }),
      proposal({ id: 'c', summary: 'Log 1 h on #6100', status: 'rejected' }),
    ]);

    const view = render(ApprovalNotice);

    expect(view.getByRole('region', { name: 'Changes waiting for your approval' })).toBeInTheDocument();
    expect(view.getByText('2 changes from AI agents wait for you')).toBeInTheDocument();
    expect(view.getByText('Log 3 h on #6137')).toBeInTheDocument();
    expect(view.getByText('Set #6138 to Closed')).toBeInTheDocument();
    expect(view.queryByText('Log 1 h on #6100')).toBeNull();
  });

  it('names a single change in the singular', () => {
    agentProposals.set([proposal({})]);

    const view = render(ApprovalNotice);

    expect(view.getByText('An AI agent proposed a change')).toBeInTheDocument();
  });

  it('approves or rejects a change from the notice', async () => {
    agentProposals.set([proposal({ id: 'a', summary: 'Log 3 h on #6137' }), proposal({ id: 'b', summary: 'Set #6138 to Closed' })]);
    const view = render(ApprovalNotice);

    await fireEvent.click(view.getByRole('button', { name: 'Approve: Log 3 h on #6137' }));
    await fireEvent.click(view.getByRole('button', { name: 'Reject: Set #6138 to Closed' }));

    expect(approveAgentProposal).toHaveBeenCalledWith('a');
    expect(rejectAgentProposal).toHaveBeenCalledWith('b');
  });
});
