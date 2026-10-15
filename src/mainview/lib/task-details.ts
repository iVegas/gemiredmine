import type { HistoryNames } from '../../shared/backend';
import type { RedmineCustomFieldValue, RedmineJournal, RedmineJournalDetail, RedmineRelation } from '../../bun/redmine/types';
import { isHttpUrl } from './url';

// What the views of a task and of a log entry show, worked out from what Redmine sends. The views only lay it out.

/** A date and time as the user's system writes them. An unreadable date is shown as it came. */
export function formatTimestamp(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time)
    ? iso
    : new Date(time).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The address of a page of the Redmine server, for a link that opens in the browser. Null when the server's address is not a web address. */
export function serverPage(serverUrl: string, path: string): string | null {
  if (!isHttpUrl(serverUrl)) return null;
  return `${serverUrl.replace(/\/+$/, '')}${path}`;
}

/** The address of an attachment. Redmine gives an absolute one; a relative one is taken from the server. Null unless it is a web address. */
export function attachmentLink(serverUrl: string, contentUrl: string): string | null {
  try {
    const resolved = new URL(contentUrl, `${serverUrl.replace(/\/+$/, '')}/`).href;
    return isHttpUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** The value of a custom field as text: a list is joined, a field with no value says nothing. */
export function customFieldText(field: RedmineCustomFieldValue): string {
  return Array.isArray(field.value) ? field.value.join(', ') : (field.value ?? '');
}

const RELATION_LABELS: Record<string, string> = {
  relates: 'Related to',
  duplicates: 'Duplicates',
  duplicated: 'Duplicated by',
  blocks: 'Blocks',
  blocked: 'Blocked by',
  precedes: 'Precedes',
  follows: 'Follows',
  copied_to: 'Copied to',
  copied_from: 'Copied from',
};

/** The other side of a relation seen from the other task: "blocks" there is "blocked by" here. */
const RELATION_INVERSE: Record<string, string> = {
  relates: 'relates',
  duplicates: 'duplicated',
  duplicated: 'duplicates',
  blocks: 'blocked',
  blocked: 'blocks',
  precedes: 'follows',
  follows: 'precedes',
  copied_to: 'copied_from',
  copied_from: 'copied_to',
};

/** How a relation reads from the task being shown, and which task is at its other end. */
export function describeRelation(relation: RedmineRelation, taskId: number): { label: string; otherId: number } {
  const ours = relation.issue_id === taskId;
  const type = ours ? relation.relation_type : (RELATION_INVERSE[relation.relation_type] ?? relation.relation_type);
  const delay = relation.delay ? ` (${relation.delay} ${Math.abs(relation.delay) === 1 ? 'day' : 'days'})` : '';
  return { label: `${RELATION_LABELS[type] ?? type}${delay}`, otherId: ours ? relation.issue_to_id : relation.issue_id };
}

/** The fields whose values in the history are the ids of something else, and what to call them when the name of the id is not known. */
const REFERENCE_LABELS: Record<string, string> = {
  status_id: 'Status',
  priority_id: 'Priority',
  tracker_id: 'Tracker',
  assigned_to_id: 'Assignee',
  category_id: 'Category',
  fixed_version_id: 'Target version',
  project_id: 'Project',
};

const PLAIN_LABELS: Record<string, string> = {
  subject: 'Subject',
  start_date: 'Start date',
  due_date: 'Due date',
  done_ratio: '% Done',
  estimated_hours: 'Estimated time',
  is_private: 'Private',
  parent_id: 'Parent task',
};

const NONE = 'none';

function plainValue(name: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return NONE;
  if (name === 'done_ratio') return `${value}%`;
  if (name === 'estimated_hours') return `${value} h`;
  if (name === 'is_private') return value === '1' ? 'yes' : 'no';
  if (name === 'parent_id') return `#${value}`;
  return value;
}

/** One change of the history as a line: "Status: New → In progress". */
export function describeChange(
  detail: RedmineJournalDetail,
  names: HistoryNames = {},
  customFields: readonly RedmineCustomFieldValue[] = []
): string {
  const { property, name } = detail;
  const before = detail.old_value ?? null;
  const after = detail.new_value ?? null;

  if (property === 'attachment') {
    return after ? `File added: ${after}` : `File removed: ${before ?? ''}`.trim();
  }
  if (property === 'relation') {
    const label = RELATION_LABELS[name] ?? name;
    return after ? `Relation added: ${label} #${after}` : `Relation removed: ${label} #${before ?? ''}`.trim();
  }
  if (property === 'cf') {
    const label = customFields.find((field) => String(field.id) === name)?.name ?? 'Custom field';
    return `${label}: ${plainValue(name, before)} → ${plainValue(name, after)}`;
  }
  if (name === 'description') return 'Description updated';

  if (name in REFERENCE_LABELS) {
    const label = REFERENCE_LABELS[name];
    const lookup = names[name as keyof HistoryNames];
    if (lookup) {
      const nameOf = (id: string | null) => (id === null || id === '' ? NONE : (lookup[id] ?? `#${id}`));
      return `${label}: ${nameOf(before)} → ${nameOf(after)}`;
    }
    // Redmine gives only the id, and what it stands for cannot be told: the line says that it changed.
    if (!before && after) return `${label} set`;
    if (before && !after) return `${label} cleared`;
    return `${label} changed`;
  }
  if (name in PLAIN_LABELS) return `${PLAIN_LABELS[name]}: ${plainValue(name, before)} → ${plainValue(name, after)}`;
  return `${name} changed`;
}

export interface HistoryEntry {
  id: number;
  author: string;
  when: string;
  isPrivate: boolean;
  notes: string;
  changes: string[];
}

/** The history of a task, oldest first as Redmine sends it. An entry with neither a comment nor a change is left out. */
export function historyEntries(
  journals: readonly RedmineJournal[],
  names: HistoryNames,
  customFields: readonly RedmineCustomFieldValue[] = []
): HistoryEntry[] {
  return journals
    .map((journal) => ({
      id: journal.id,
      author: journal.user.name,
      when: journal.created_on,
      isPrivate: journal.private_notes === true,
      notes: (journal.notes ?? '').trim(),
      changes: journal.details.map((detail) => describeChange(detail, names, customFields)),
    }))
    .filter((entry) => entry.notes !== '' || entry.changes.length > 0);
}
