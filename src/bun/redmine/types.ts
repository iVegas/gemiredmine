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

export interface RedmineTimeEntry {
  id: number;
  project: RedmineReference;
  issue?: { id: number };
  user: RedmineReference;
  activity: RedmineReference;
  hours: number;
  comments?: string;
  spent_on: string;
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
