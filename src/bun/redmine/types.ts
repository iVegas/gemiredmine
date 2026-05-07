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
