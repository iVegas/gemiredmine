import { describe, it, expect, vi, beforeEach, afterEach, type Mocked } from 'vitest';
import { RedmineContextService } from '../context';
import { RedmineClient } from '../client';

vi.mock('../client');

describe('RedmineContextService', () => {
  let service: RedmineContextService;
  let mockClient: Mocked<RedmineClient>;

  beforeEach(() => {
    mockClient = new RedmineClient({ baseUrl: 'http://test' }) as Mocked<RedmineClient>;
    service = new RedmineContextService(mockClient);
  });

  it('fetches time_logging context successfully', async () => {
    mockClient.getTimeEntryActivities.mockResolvedValue({
      time_entry_activities: [
        { id: 9, name: 'Development', is_default: false, active: true },
        { id: 10, name: 'Design', is_default: true, active: true }
      ]
    });

    mockClient.getCustomFields.mockResolvedValue({
      custom_fields: [
        { id: 1, name: 'Billable', customized_type: 'time_entry', field_format: 'bool', is_required: true },
        { id: 2, name: 'OS', customized_type: 'issue', field_format: 'string' }
      ]
    });

    const context = await service.getServerContext('time_logging');

    expect(context).toEqual({
      workflow: 'time_logging',
      activities: [
        { id: 9, name: 'Development', is_default: false },
        { id: 10, name: 'Design', is_default: true }
      ],
      custom_fields: [
        { id: 1, name: 'Billable', format: 'bool', required: true, default: undefined, options: undefined }
      ]
    });

    expect(mockClient.getTimeEntryActivities).toHaveBeenCalled();
    expect(mockClient.getCustomFields).toHaveBeenCalled();
  });

  it('fetches issue_creation context successfully', async () => {
    mockClient.getTrackers.mockResolvedValue({
      trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }]
    });

    mockClient.getIssueStatuses.mockResolvedValue({
      issue_statuses: [{ id: 1, name: 'New', is_closed: false }, { id: 5, name: 'Closed', is_closed: true }]
    });

    mockClient.getIssuePriorities.mockResolvedValue({
      issue_priorities: [{ id: 1, name: 'Low', is_default: false, active: true }, { id: 2, name: 'Normal', is_default: true, active: true }]
    });

    mockClient.getCustomFields.mockResolvedValue({
      custom_fields: [
        { id: 2, name: 'OS', customized_type: 'issue', field_format: 'list', possible_values: [{value: 'Linux'}, {value: 'Windows'}] }
      ]
    });

    const context = await service.getServerContext('issue_creation');

    expect(context).toEqual({
      workflow: 'issue_creation',
      trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }],
      statuses: [{ id: 1, name: 'New', closed: false }, { id: 5, name: 'Closed', closed: true }],
      priorities: [{ id: 1, name: 'Low', default: false }, { id: 2, name: 'Normal', default: true }],
      custom_fields: [
        { id: 2, name: 'OS', format: 'list', required: undefined, default: undefined, options: ['Linux', 'Windows'] }
      ]
    });
  });

  it('fetches general context successfully', async () => {
    mockClient.getTrackers.mockResolvedValue({ trackers: [{ id: 1, name: 'Bug' }] });
    mockClient.getIssueStatuses.mockResolvedValue({ issue_statuses: [{ id: 1, name: 'New', is_closed: false }] });
    mockClient.getRoles.mockResolvedValue({ roles: [{ id: 3, name: 'Manager' }, { id: 4, name: 'Developer' }] });

    const context = await service.getServerContext('general');

    expect(context).toEqual({
      workflow: 'general',
      trackers: [{ id: 1, name: 'Bug' }],
      statuses: [{ id: 1, name: 'New' }],
      roles: [{ id: 3, name: 'Manager' }, { id: 4, name: 'Developer' }]
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('handles error in getTimeLoggingContext', async () => {
      const error = new Error('Network failure');
      mockClient.getTimeEntryActivities.mockRejectedValue(error);

      await expect(service.getServerContext('time_logging')).rejects.toThrow(error);
      expect(console.error).toHaveBeenCalledWith('Failed to fetch time logging context:', 'Network failure');
    });

    it('handles error in getIssueCreationContext', async () => {
      const error = new Error('API error');
      mockClient.getTrackers.mockRejectedValue(error);

      await expect(service.getServerContext('issue_creation')).rejects.toThrow(error);
      expect(console.error).toHaveBeenCalledWith('Failed to fetch issue creation context:', 'API error');
    });

    it('handles error in getGeneralContext', async () => {
      const error = new Error('Timeout');
      mockClient.getTrackers.mockRejectedValue(error);

      await expect(service.getServerContext('general')).rejects.toThrow(error);
      expect(console.error).toHaveBeenCalledWith('Failed to fetch general context:', 'Timeout');
    });
  });
});
