import { RedmineClient } from './client';

export type WorkflowType = 'time_logging' | 'issue_creation' | 'general';

export interface WorkflowContext {
  [key: string]: any;
}

export class RedmineContextService {
  private client: RedmineClient;

  constructor(client: RedmineClient) {
    this.client = client;
  }

  /**
   * Fetches the server context based on the provided workflow,
   * stripping down verbose data to minimize LLM token usage.
   */
  async getServerContext(workflow: WorkflowType): Promise<WorkflowContext> {
    try {
      switch (workflow) {
        case 'time_logging':
          return await this.getTimeLoggingContext();
        case 'issue_creation':
          return await this.getIssueCreationContext();
        case 'general':
        default:
          return await this.getGeneralContext();
      }
    } catch (error) {
      console.error(`Failed to fetch ${workflow.replace('_', ' ')} context:`, error);
      throw error;
    }
  }

  private async getTimeLoggingContext(): Promise<WorkflowContext> {
    const [activitiesRes, customFieldsRes] = await Promise.all([
      this.client.getTimeEntryActivities(),
      this.client.getCustomFields(),
    ]);

    // Only include time_entry custom fields
    const timeCustomFields = customFieldsRes.custom_fields
      .filter(cf => cf.customized_type === 'time_entry')
      .map(cf => ({
        id: cf.id,
        name: cf.name,
        format: cf.field_format,
        required: cf.is_required,
        default: cf.default_value,
        options: cf.possible_values?.map(v => v.value)
      }));

    return {
      workflow: 'time_logging',
      activities: activitiesRes.time_entry_activities.map(a => ({
        id: a.id,
        name: a.name,
        is_default: a.is_default
      })),
      custom_fields: timeCustomFields
    };
  }

  private async getIssueCreationContext(): Promise<WorkflowContext> {
    const [trackersRes, statusesRes, prioritiesRes, customFieldsRes] = await Promise.all([
      this.client.getTrackers(),
      this.client.getIssueStatuses(),
      this.client.getIssuePriorities(),
      this.client.getCustomFields(),
    ]);

    const issueCustomFields = customFieldsRes.custom_fields
      .filter(cf => cf.customized_type === 'issue')
      .map(cf => ({
        id: cf.id,
        name: cf.name,
        format: cf.field_format,
        required: cf.is_required,
        default: cf.default_value,
        options: cf.possible_values?.map(v => v.value)
      }));

    return {
      workflow: 'issue_creation',
      trackers: trackersRes.trackers.map(t => ({ id: t.id, name: t.name })),
      statuses: statusesRes.issue_statuses.map(s => ({ id: s.id, name: s.name, closed: s.is_closed })),
      priorities: prioritiesRes.issue_priorities.map(p => ({ id: p.id, name: p.name, default: p.is_default })),
      custom_fields: issueCustomFields
    };
  }

  private async getGeneralContext(): Promise<WorkflowContext> {
    const [trackersRes, statusesRes, rolesRes] = await Promise.all([
      this.client.getTrackers(),
      this.client.getIssueStatuses(),
      this.client.getRoles(),
    ]);

    return {
      workflow: 'general',
      trackers: trackersRes.trackers.map(t => ({ id: t.id, name: t.name })),
      statuses: statusesRes.issue_statuses.map(s => ({ id: s.id, name: s.name })),
      roles: rolesRes.roles.map(r => ({ id: r.id, name: r.name }))
    };
  }
}
