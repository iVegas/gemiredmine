import { describe, it, expect } from 'vitest';
import { buildIssueLink, buildReport, isAllowedIssueUrl, ISSUE_URL_LIMIT, type FeedbackEnvironment } from '../feedback';

const repositoryUrl = 'https://github.com/iVegas/gemiredmine';
const environment: FeedbackEnvironment = {
  productName: 'Gemiredmine Unstable',
  version: '1.0.0-unstable.7',
  channel: 'unstable',
  commit: 'abc1234',
  buildDate: '2026-10-12T00:00:00.000Z',
  platform: 'linux',
  arch: 'x64',
  runtime: 'bun 1.4.2',
};

describe('buildReport', () => {
  it('redacts the description and includes logs only when asked', () => {
    const withLogs = buildReport(
      { title: 't', description: 'my key is abc', includeLogs: true },
      environment,
      '{"message":"token=secret"}'
    );
    expect(withLogs).toContain('## Aggregated diagnostics');
    expect(withLogs).toContain('token=[REDACTED]');

    const withoutLogs = buildReport({ title: 't', description: 'hi', includeLogs: false }, environment, '{}');
    expect(withoutLogs).not.toContain('## Aggregated diagnostics');
  });
});

describe('buildIssueLink', () => {
  it('builds a prefilled new-issue link with the channel in the title', () => {
    const link = buildIssueLink({
      repositoryUrl,
      channel: 'unstable',
      title: 'Table is slow',
      report: logs => buildReport({ title: 't', description: 'slow', includeLogs: true }, environment, logs),
      logs: '{"count":1}',
    });

    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe(`${repositoryUrl}/issues/new`);
    expect(url.searchParams.get('title')).toBe('[unstable] Table is slow');
    expect(url.searchParams.get('labels')).toBe('feedback');
    expect(link.logsIncluded).toBe('all');
  });

  it('shortens, then drops, logs so the link stays within the limit', () => {
    const logs = 'x'.repeat(20_000);
    const link = buildIssueLink({
      repositoryUrl,
      channel: 'unstable',
      title: 'Big',
      report: text => buildReport({ title: 't', description: 'd', includeLogs: true }, environment, text),
      logs,
    });

    expect(link.url.length).toBeLessThanOrEqual(ISSUE_URL_LIMIT);
    expect(link.logsIncluded).not.toBe('all');
  });
});

describe('isAllowedIssueUrl', () => {
  it('only accepts the project new-issue page', () => {
    expect(isAllowedIssueUrl(`${repositoryUrl}/issues/new?title=x`, repositoryUrl)).toBe(true);
    expect(isAllowedIssueUrl('https://evil.example/issues/new?title=x', repositoryUrl)).toBe(false);
    expect(isAllowedIssueUrl(`${repositoryUrl}/settings`, repositoryUrl)).toBe(false);
  });
});
