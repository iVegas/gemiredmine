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
  DocumentCategoriesResponse
} from './types';

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
      const basicAuth = btoa(`${this.config.username}:${this.config.password}`);
      headers.set('Authorization', `Basic ${basicAuth}`);
    }

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(`Redmine API request failed: ${response.status} ${response.statusText}`);
    }

    // Return the response as JSON. Some endpoints might return empty body, handle it gracefully.
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
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

  async getDocumentCategories(): Promise<DocumentCategoriesResponse> {
    return this.request<DocumentCategoriesResponse>('/enumerations/document_categories.json');
  }
}
