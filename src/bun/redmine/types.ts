export interface RedmineTracker {
  id: number;
  name: string;
  default_status?: { id: number; name: string };
  description?: string;
}

export interface RedmineIssueStatus {
  id: number;
  name: string;
  is_closed: boolean;
}

export interface RedmineCustomField {
  id: number;
  name: string;
  customized_type: string;
  field_format: string;
  regexp?: string;
  min_length?: number;
  max_length?: number;
  is_required?: boolean;
  is_filter?: boolean;
  searchable?: boolean;
  multiple?: boolean;
  default_value?: string;
  visible?: boolean;
  possible_values?: { value: string }[];
}

export interface RedmineRole {
  id: number;
  name: string;
  assignable?: boolean;
  issues_visibility?: string;
  users_visibility?: string;
  permissions?: string[];
}

export interface RedmineEnumeration {
  id: number;
  name: string;
  is_default: boolean;
  active: boolean;
}

export interface TrackersResponse {
  trackers: RedmineTracker[];
}

export interface IssueStatusesResponse {
  issue_statuses: RedmineIssueStatus[];
}

export interface CustomFieldsResponse {
  custom_fields: RedmineCustomField[];
}

export interface RolesResponse {
  roles: RedmineRole[];
}

export interface IssuePrioritiesResponse {
  issue_priorities: RedmineEnumeration[];
}

export interface TimeEntryActivitiesResponse {
  time_entry_activities: RedmineEnumeration[];
}

export interface RedmineReference {
  id: number;
  name: string;
}

export interface RedmineUser {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
  mail?: string;
  api_key?: string;
}

export interface CurrentUserResponse {
  user: RedmineUser;
}

/** A membership of the user in a project, as `GET /users/current.json?include=memberships` lists it. */
export interface RedmineMembership {
  id: number;
  project: RedmineReference;
  roles?: RedmineReference[];
}

export interface CurrentUserMembershipsResponse {
  user: RedmineUser & { memberships?: RedmineMembership[] };
}

/** A custom field of an issue or a time entry, with the value it has there. */
export interface RedmineCustomFieldValue {
  id: number;
  name: string;
  value: string | string[] | null;
  multiple?: boolean;
}

/** What Redmine takes to create a time entry: the names of its fields, so the request body is this object. */
export interface NewTimeEntry {
  issue_id: number;
  /** YYYY-MM-DD */
  spent_on: string;
  hours: number;
  activity_id: number;
  comments: string;
}

/** The fields of a time entry that can change. Only the ones given are sent. */
export type TimeEntryChanges = Partial<Omit<NewTimeEntry, 'issue_id'>>;

/** The fields of an issue that can change, and the note that goes with the change. Only the ones given are sent. */
export interface IssueChanges {
  subject?: string;
  description?: string;
  status_id?: number;
  priority_id?: number;
  /** YYYY-MM-DD, or null to clear it */
  start_date?: string | null;
  /** YYYY-MM-DD, or null to clear it */
  due_date?: string | null;
  done_ratio?: number;
  estimated_hours?: number | null;
  notes?: string;
}

export interface RedmineTimeEntry {
  id: number;
  project: RedmineReference;
  issue?: { id: number };
  user: RedmineReference;
  activity: RedmineReference;
  hours: number;
  comments?: string;
  spent_on: string;
  created_on?: string;
  updated_on?: string;
  custom_fields?: RedmineCustomFieldValue[];
}

export interface TimeEntryResponse {
  time_entry: RedmineTimeEntry;
}

export interface TimeEntriesResponse {
  time_entries: RedmineTimeEntry[];
  total_count: number;
  offset: number;
  limit: number;
}

export interface RedmineIssue {
  id: number;
  project: RedmineReference;
  tracker: RedmineReference;
  status: RedmineReference;
  priority: RedmineReference;
  subject: string;
  start_date?: string | null;
  due_date?: string | null;
  done_ratio?: number;
}

export interface IssuesResponse {
  issues: RedmineIssue[];
  total_count: number;
  offset: number;
  limit: number;
}

/** One change in the history of an issue. `name` is a field's key; `attr` values of fields that refer to something are its id. */
export interface RedmineJournalDetail {
  /** `attr` (a field of the issue), `cf` (a custom field, `name` is its id), `attachment` or `relation` */
  property: string;
  name: string;
  old_value?: string | null;
  new_value?: string | null;
}

/** An entry in the history of an issue: a comment, the changes made with it, or both. */
export interface RedmineJournal {
  id: number;
  user: RedmineReference;
  notes?: string;
  created_on: string;
  private_notes?: boolean;
  details: RedmineJournalDetail[];
}

export interface RedmineAttachment {
  id: number;
  filename: string;
  filesize: number;
  content_type?: string;
  description?: string;
  content_url: string;
  author: RedmineReference;
  created_on: string;
}

export interface RedmineChildIssue {
  id: number;
  tracker: RedmineReference;
  subject: string;
}

export interface RedmineRelation {
  id: number;
  issue_id: number;
  issue_to_id: number;
  relation_type: string;
  delay?: number | null;
}

/** An issue as `GET /issues/<id>.json` returns it, with what `include` asked for. */
export interface RedmineIssueDetails extends RedmineIssue {
  description?: string;
  author?: RedmineReference;
  assigned_to?: RedmineReference;
  category?: RedmineReference;
  fixed_version?: RedmineReference;
  parent?: { id: number };
  is_private?: boolean;
  estimated_hours?: number | null;
  total_estimated_hours?: number | null;
  spent_hours?: number;
  total_spent_hours?: number;
  created_on?: string;
  updated_on?: string;
  closed_on?: string | null;
  custom_fields?: RedmineCustomFieldValue[];
  journals?: RedmineJournal[];
  attachments?: RedmineAttachment[];
  children?: RedmineChildIssue[];
  relations?: RedmineRelation[];
}

export interface IssueResponse {
  issue: RedmineIssueDetails;
}
