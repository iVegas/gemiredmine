export interface RedmineClientConfig {
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

import type {
  TrackersResponse,
  IssueStatusesResponse,
  CustomFieldsResponse,
  RolesResponse,
  IssuePrioritiesResponse,
  TimeEntryActivitiesResponse,
  CurrentUserResponse,
  RedmineTimeEntry,
  TimeEntriesResponse,
  RedmineIssue,
  IssuesResponse
} from './types';

// Redmine caps list endpoints at 100 items per page; the cap keeps a runaway total from looping forever.
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export class RedmineApiError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`Redmine API request failed: ${status} ${statusText}`);
    this.name = 'RedmineApiError';
  }
}

/**
 * Throws unless the value is an http(s) URL. Guards values that arrive from the webview.
 */
export function assertHttpUrl(value: string): string {
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new Error('Server URL is not valid.');
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Server URL must start with http:// or https://.');
  }
  return value;
}

/**
 * Basic auth credentials are UTF-8 encoded before base64, so non-Latin-1 passwords work.
 */
function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return `Basic ${btoa(binary)}`;
}

export class RedmineClient {
  private config: RedmineClientConfig;

  constructor(config: RedmineClientConfig) {
    // Ensure baseUrl doesn't end with a trailing slash for consistency
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, '')
    };
  }

  /**
   * Helper method to perform HTTP requests to the Redmine API
   */
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');

    if (this.config.apiKey) {
      headers.set('X-Redmine-API-Key', this.config.apiKey);
    } else if (this.config.username && this.config.password) {
      headers.set('Authorization', basicAuthHeader(this.config.username, this.config.password));
    }

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new RedmineApiError(response.status, response.statusText);
    }

    // Return the response as JSON. Some endpoints might return empty body, handle it gracefully.
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async getTrackers(): Promise<TrackersResponse> {
    return this.request<TrackersResponse>('/trackers.json');
  }

  async getIssueStatuses(): Promise<IssueStatusesResponse> {
    return this.request<IssueStatusesResponse>('/issue_statuses.json');
  }

  async getCustomFields(): Promise<CustomFieldsResponse> {
    return this.request<CustomFieldsResponse>('/custom_fields.json');
  }

  async getRoles(): Promise<RolesResponse> {
    return this.request<RolesResponse>('/roles.json');
  }

  async getIssuePriorities(): Promise<IssuePrioritiesResponse> {
    return this.request<IssuePrioritiesResponse>('/enumerations/issue_priorities.json');
  }

  async getTimeEntryActivities(): Promise<TimeEntryActivitiesResponse> {
    return this.request<TimeEntryActivitiesResponse>('/enumerations/time_entry_activities.json');
  }

  /**
   * The user the credentials belong to. Redmine includes `api_key` only for the user's own record.
   */
  async getCurrentUser(): Promise<CurrentUserResponse> {
    return this.request<CurrentUserResponse>('/users/current.json');
  }

  /** Time entries logged by the authenticated user between `from` and `to` (YYYY-MM-DD, inclusive). */
  async getTimeEntries(range: { from: string; to: string }): Promise<RedmineTimeEntry[]> {
    return this.fetchAllPages<TimeEntriesResponse, RedmineTimeEntry>(
      '/time_entries.json',
      { user_id: 'me', from: range.from, to: range.to },
      (response) => response.time_entries
    );
  }

  /** Open issues assigned to the authenticated user whose due date falls in the range. */
  async getAssignedOpenIssues(range: { dueFrom: string; dueTo: string }): Promise<RedmineIssue[]> {
    return this.fetchAllPages<IssuesResponse, RedmineIssue>(
      '/issues.json',
      {
        assigned_to_id: 'me',
        status_id: 'open',
        due_date: `><${range.dueFrom}|${range.dueTo}`
      },
      (response) => response.issues
    );
  }

  /**
   * Every open issue assigned to the authenticated user, across all projects.
   * Redmine sorts priorities by their configured position, so the highest priority comes first.
   */
  async getAssignedTasks(): Promise<RedmineIssue[]> {
    return this.fetchAllPages<IssuesResponse, RedmineIssue>(
      '/issues.json',
      {
        assigned_to_id: 'me',
        status_id: 'open',
        sort: 'priority:desc'
      },
      (response) => response.issues
    );
  }

  private async fetchAllPages<R extends { total_count: number }, T>(
    path: string,
    filters: Record<string, string>,
    pick: (response: R) => T[]
  ): Promise<T[]> {
    const items: T[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        ...filters,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE)
      });
      const response = await this.request<R>(`${path}?${query}`);
      const batch = pick(response);
      items.push(...batch);

      if (batch.length < PAGE_SIZE || items.length >= response.total_count) break;
    }

    return items;
  }
}
