/** The shape of `fetch` the client needs, so a runtime can supply its own HTTP client. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RedmineClientConfig {
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  /** Replaces the global `fetch`, for runtimes that must send requests through a native HTTP client. */
  fetch?: FetchLike;
  /** Aborts the requests, for example when a timeout expires. */
  signal?: AbortSignal;
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
  TimeEntryResponse,
  RedmineIssue,
  IssuesResponse,
  IssueResponse,
  RedmineIssueDetails,
  NewTimeEntry,
  TimeEntryChanges,
  IssueChanges
} from './types';

// Redmine caps list endpoints at 100 items per page; the cap keeps a runaway total from looping forever.
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export class RedmineApiError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    message = `Redmine API request failed: ${status} ${statusText}`
  ) {
    super(message);
    this.name = 'RedmineApiError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The server answered with a redirect instead of data. Runtimes whose `fetch` follows redirects never
 * see this. The desktop HTTP client does not follow them, because it would resend the API key to the
 * new host, so the user is told where the server went instead.
 */
export class RedmineMovedError extends RedmineApiError {
  constructor(
    status: number,
    statusText: string,
    /** Absolute URL from the `Location` header, or null when there was none */
    readonly location: string | null,
    /** The server URL to use instead, when it can be told from the redirect */
    readonly suggestedBaseUrl: string | null,
    message: string
  ) {
    super(status, statusText, message);
    this.name = 'RedmineMovedError';
  }
}

/**
 * Explains a redirect. When the new address ends with the path that was requested, the rest of it is the
 * server's new base URL (sub-paths such as /redmine survive). Anything else, such as a login page of a
 * proxy or single sign-on gateway, is not an address the user can enter as the server.
 */
function redirectError(response: Response, requestUrl: string, endpointPath: string): RedmineMovedError {
  let target: URL | null = null;
  const header = response.headers?.get('Location');
  if (header) {
    try {
      target = new URL(header, requestUrl);
    } catch {
      target = null;
    }
  }

  if (!target) {
    return new RedmineMovedError(
      response.status,
      response.statusText,
      null,
      null,
      'The server redirected the request without saying where. Check the server URL.'
    );
  }

  if (target.pathname.endsWith(endpointPath)) {
    const base = `${target.origin}${target.pathname.slice(0, target.pathname.length - endpointPath.length)}`;
    return new RedmineMovedError(
      response.status,
      response.statusText,
      target.href,
      base,
      `The server moved to ${base}. Use that address as the server URL.`
    );
  }

  return new RedmineMovedError(
    response.status,
    response.statusText,
    target.href,
    null,
    `The server redirected to ${target.origin} instead of answering. Check the server URL, and any proxy or login gateway in front of it.`
  );
}

/** The messages in a 422 answer, such as `{"errors": ["Subject cannot be blank"]}`, as sentences. Empty when there are none. */
async function validationReasons(response: Response): Promise<string[]> {
  try {
    const body = (await response.json()) as { errors?: unknown };
    if (!Array.isArray(body.errors)) return [];
    return body.errors
      .filter((reason): reason is string => typeof reason === 'string' && reason.trim() !== '')
      .map((reason) => (/[.!?]$/.test(reason) ? reason : `${reason}.`));
  } catch {
    return [];
  }
}

// Looked up on every call, so a test that replaces the global fetch is honoured.
const globalFetch: FetchLike = (url, init) => fetch(url, init);

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

/** An id that goes into a URL has to be a whole number: it comes from the webview. */
function recordId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${String(id)} is not a Redmine id.`);
  return id;
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

    // A fresh init for every call: some HTTP clients modify the object they are given.
    const init: RequestInit = { ...options, headers };
    if (this.config.signal) init.signal = this.config.signal;

    const response = await (this.config.fetch ?? globalFetch)(url, init);

    if (!response.ok) {
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => {});
        throw redirectError(response, url, endpoint.split('?')[0].replace(/^(?!\/)/, '/'));
      }
      // Redmine says why it refuses a change, such as a blank subject, in the body of a 422. Other bodies are not read,
      // and are released so a native HTTP client does not keep the connection open.
      if (response.status === 422) {
        const reasons = await validationReasons(response);
        throw new RedmineApiError(response.status, response.statusText, reasons.length > 0 ? reasons.join(' ') : undefined);
      }
      await response.body?.cancel().catch(() => {});
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

  /**
   * One issue, with its history, attachments, subtasks and relations. Redmine answers 404 for an issue that does not
   * exist and for one the user may not see.
   */
  async getIssue(id: number): Promise<RedmineIssueDetails> {
    const { issue } = await this.request<IssueResponse>(`/issues/${recordId(id)}.json?include=journals,attachments,children,relations`);
    return issue;
  }

  /** One time entry. */
  async getTimeEntry(id: number): Promise<RedmineTimeEntry> {
    const { time_entry } = await this.request<TimeEntryResponse>(`/time_entries/${recordId(id)}.json`);
    return time_entry;
  }

  /** Logs time on an issue. Redmine answers 201 with the new entry, which nothing here needs. */
  async createTimeEntry(entry: NewTimeEntry): Promise<void> {
    await this.request<unknown>('/time_entries.json', {
      method: 'POST',
      body: JSON.stringify({ time_entry: { ...entry, issue_id: recordId(entry.issue_id) } })
    });
  }

  /** Changes a time entry. Redmine refuses it with 403 when the user may not change it. Redmine answers 204. */
  async updateTimeEntry(id: number, changes: TimeEntryChanges): Promise<void> {
    await this.request<unknown>(`/time_entries/${recordId(id)}.json`, {
      method: 'PUT',
      body: JSON.stringify({ time_entry: changes })
    });
  }

  /** Changes an issue. Redmine refuses it with 403 when the user may not change it. Redmine answers 204. */
  async updateIssue(id: number, changes: IssueChanges): Promise<void> {
    await this.request<unknown>(`/issues/${recordId(id)}.json`, {
      method: 'PUT',
      body: JSON.stringify({ issue: changes })
    });
  }

  /** The time entries logged on an issue, by anyone the user may see, the latest day first. */
  async getIssueTimeEntries(issueId: number): Promise<RedmineTimeEntry[]> {
    return this.fetchAllPages<TimeEntriesResponse, RedmineTimeEntry>(
      '/time_entries.json',
      { issue_id: String(recordId(issueId)), sort: 'spent_on:desc' },
      (response) => response.time_entries
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
