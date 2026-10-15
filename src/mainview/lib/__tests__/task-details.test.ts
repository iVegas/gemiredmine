import { describe, expect, it } from 'vitest';
import type { RedmineJournal, RedmineJournalDetail } from '../../../bun/redmine/types';
import {
  attachmentLink,
  customFieldText,
  describeChange,
  describeRelation,
  formatBytes,
  formatTimestamp,
  historyEntries,
  serverPage,
} from '../task-details';

const attr = (name: string, old_value: string | null, new_value: string | null): RedmineJournalDetail => ({ property: 'attr', name, old_value, new_value });

describe('describeChange', () => {
  const names = { status_id: { '1': 'New', '2': 'In progress' }, priority_id: { '2': 'Normal', '4': 'Urgent' } };

  it('names the old and the new status, priority and tracker', () => {
    expect(describeChange(attr('status_id', '1', '2'), names)).toBe('Status: New → In progress');
    expect(describeChange(attr('priority_id', '2', '4'), names)).toBe('Priority: Normal → Urgent');
    expect(describeChange(attr('tracker_id', '1', '2'), { tracker_id: { '1': 'Bug', '2': 'Feature' } })).toBe('Tracker: Bug → Feature');
  });

  it('shows the id of one that has no name, and none for no value', () => {
    expect(describeChange(attr('status_id', '1', '9'), names)).toBe('Status: New → #9');
    expect(describeChange(attr('status_id', null, '2'), names)).toBe('Status: none → In progress');
  });

  it('says only that a field changed when Redmine gives an id and the name cannot be found', () => {
    expect(describeChange(attr('assigned_to_id', '2', '1'))).toBe('Assignee changed');
    expect(describeChange(attr('assigned_to_id', null, '1'))).toBe('Assignee set');
    expect(describeChange(attr('assigned_to_id', '2', null))).toBe('Assignee cleared');
    expect(describeChange(attr('fixed_version_id', '1', '2'))).toBe('Target version changed');
    // A status whose list could not be fetched is told the same way.
    expect(describeChange(attr('status_id', '1', '2'), {})).toBe('Status changed');
  });

  it('shows plain values, with their units', () => {
    expect(describeChange(attr('subject', 'Old', 'New'))).toBe('Subject: Old → New');
    expect(describeChange(attr('done_ratio', '0', '40'))).toBe('% Done: 0% → 40%');
    expect(describeChange(attr('estimated_hours', null, '8.5'))).toBe('Estimated time: none → 8.5 h');
    expect(describeChange(attr('due_date', '2026-10-01', '2026-10-09'))).toBe('Due date: 2026-10-01 → 2026-10-09');
    expect(describeChange(attr('is_private', '0', '1'))).toBe('Private: no → yes');
    expect(describeChange(attr('parent_id', null, '12'))).toBe('Parent task: none → #12');
  });

  it('does not show a description, which can be long, only that it changed', () => {
    expect(describeChange(attr('description', 'a long text', 'another long text'))).toBe('Description updated');
  });

  it('names a custom field from the task, and has a word for one it does not know', () => {
    const fields = [{ id: 1, name: 'Customer', value: 'ACME Corp' }];

    expect(describeChange({ property: 'cf', name: '1', old_value: 'ACME', new_value: 'ACME Corp' }, {}, fields)).toBe('Customer: ACME → ACME Corp');
    expect(describeChange({ property: 'cf', name: '9', old_value: null, new_value: 'x' })).toBe('Custom field: none → x');
  });

  it('tells of files that were added and removed, and of relations', () => {
    expect(describeChange({ property: 'attachment', name: '7', old_value: null, new_value: 'screenshot.png' })).toBe('File added: screenshot.png');
    expect(describeChange({ property: 'attachment', name: '7', old_value: 'old.png', new_value: null })).toBe('File removed: old.png');
    expect(describeChange({ property: 'relation', name: 'blocks', old_value: null, new_value: '12' })).toBe('Relation added: Blocks #12');
    expect(describeChange({ property: 'relation', name: 'blocks', old_value: '12', new_value: null })).toBe('Relation removed: Blocks #12');
  });

  it('has a line for a field that it does not know', () => {
    expect(describeChange(attr('something_new', 'a', 'b'))).toBe('something_new changed');
  });
});

describe('historyEntries', () => {
  const journal = (overrides: Partial<RedmineJournal>): RedmineJournal => ({
    id: 1,
    user: { id: 2, name: 'Bob Builder' },
    created_on: '2026-10-01T10:00:00Z',
    details: [],
    ...overrides,
  });

  it('keeps the order of the history, with the author, the comment and the changes of each entry', () => {
    const entries = historyEntries(
      [
        journal({ id: 1, notes: '  Can you look at this?  ' }),
        journal({ id: 2, notes: '', details: [attr('status_id', '1', '2')] }),
      ],
      { status_id: { '1': 'New', '2': 'In progress' } }
    );

    expect(entries).toEqual([
      { id: 1, author: 'Bob Builder', when: '2026-10-01T10:00:00Z', isPrivate: false, notes: 'Can you look at this?', changes: [] },
      { id: 2, author: 'Bob Builder', when: '2026-10-01T10:00:00Z', isPrivate: false, notes: '', changes: ['Status: New → In progress'] },
    ]);
  });

  it('leaves out an entry with neither a comment nor a change, which Redmine sends for changes the user may not see', () => {
    expect(historyEntries([journal({ notes: '   ' }), journal({ id: 2, notes: undefined })], {})).toEqual([]);
  });

  it('marks private comments', () => {
    expect(historyEntries([journal({ notes: 'secret', private_notes: true })], {})[0].isPrivate).toBe(true);
  });
});

describe('describeRelation', () => {
  const relation = { id: 1, issue_id: 10, issue_to_id: 12, relation_type: 'blocks', delay: null };

  it('reads from the task that it is shown on', () => {
    expect(describeRelation(relation, 10)).toEqual({ label: 'Blocks', otherId: 12 });
    expect(describeRelation(relation, 12)).toEqual({ label: 'Blocked by', otherId: 10 });
  });

  it('inverts every kind that has an inverse', () => {
    const seenFromTheOtherEnd = (type: string) => describeRelation({ ...relation, relation_type: type }, 12).label;

    expect(seenFromTheOtherEnd('precedes')).toBe('Follows');
    expect(seenFromTheOtherEnd('duplicates')).toBe('Duplicated by');
    expect(seenFromTheOtherEnd('copied_to')).toBe('Copied from');
    expect(seenFromTheOtherEnd('relates')).toBe('Related to');
  });

  it('shows the delay of a relation that has one, and a kind that is not known as it came', () => {
    expect(describeRelation({ ...relation, relation_type: 'precedes', delay: 3 }, 10).label).toBe('Precedes (3 days)');
    expect(describeRelation({ ...relation, relation_type: 'precedes', delay: 1 }, 10).label).toBe('Precedes (1 day)');
    expect(describeRelation({ ...relation, relation_type: 'mystery' }, 10).label).toBe('mystery');
  });
});

describe('formatting', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(48_213)).toBe('47 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('');
  });

  it('formats a time stamp, and shows one that cannot be read as it came', () => {
    expect(formatTimestamp('2026-10-01T10:00:00Z')).toMatch(/2026/);
    expect(formatTimestamp('not a date')).toBe('not a date');
  });

  it('joins the values of a custom field with several, and shows none for a field without a value', () => {
    expect(customFieldText({ id: 1, name: 'Tags', value: ['a', 'b'], multiple: true })).toBe('a, b');
    expect(customFieldText({ id: 2, name: 'Customer', value: 'ACME' })).toBe('ACME');
    expect(customFieldText({ id: 3, name: 'Empty', value: null })).toBe('');
  });
});

describe('links', () => {
  it('points to a page of the server, whether or not its address ends with a slash, and keeps a path', () => {
    expect(serverPage('https://redmine.example.com', '/issues/42')).toBe('https://redmine.example.com/issues/42');
    expect(serverPage('https://redmine.example.com/redmine/', '/issues/42')).toBe('https://redmine.example.com/redmine/issues/42');
  });

  it('has no link for an address that is not a web address', () => {
    expect(serverPage('javascript:alert(1)', '/issues/42')).toBeNull();
    expect(serverPage('not a url', '/issues/42')).toBeNull();
  });

  it('takes an attachment from where Redmine says, and a relative address from the server', () => {
    expect(attachmentLink('https://r.example', 'https://files.example/attachments/download/1/a.png')).toBe('https://files.example/attachments/download/1/a.png');
    expect(attachmentLink('https://r.example/redmine', '/attachments/download/1/a.png')).toBe('https://r.example/attachments/download/1/a.png');
    expect(attachmentLink('https://r.example/redmine', 'attachments/download/1/a.png')).toBe('https://r.example/redmine/attachments/download/1/a.png');
  });

  it('has no link for an attachment address that is not a web address', () => {
    expect(attachmentLink('https://r.example', 'javascript:alert(1)')).toBeNull();
    expect(attachmentLink('https://r.example', 'file:///etc/passwd')).toBeNull();
  });
});
