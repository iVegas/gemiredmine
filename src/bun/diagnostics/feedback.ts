import { redact } from './redact';

export interface FeedbackInput {
  title: string;
  description: string;
  includeLogs: boolean;
}

export interface FeedbackEnvironment {
  productName: string;
  version: string;
  channel: string;
  commit: string;
  buildDate: string;
  platform: string;
  arch: string;
  runtime: string;
}

export interface IssueLink {
  url: string;
  /** Logs included in the URL, possibly shortened */
  logsIncluded: 'all' | 'partial' | 'none';
}

/** Browsers and GitHub both struggle with very long URLs; stay well under typical limits. */
export const ISSUE_URL_LIMIT = 7000;
const TITLE_LIMIT = 120;

export function buildReport(input: FeedbackInput, environment: FeedbackEnvironment, logs: string): string {
  const description = redact(input.description).trim() || '_No description provided._';
  const sections = [
    '## Description',
    '',
    description,
    '',
    '## Environment',
    '',
    `- Product: ${environment.productName}`,
    `- Version: ${environment.version} (${environment.channel} channel)`,
    `- Build: commit ${environment.commit}, built ${environment.buildDate}`,
    `- Platform: ${environment.platform} ${environment.arch}`,
    `- Runtime: ${environment.runtime}`,
    '',
  ];
  if (input.includeLogs) {
    sections.push(
      '## Aggregated diagnostics',
      '',
      'Each line is one aggregated entry: repeated events collapse into a count. Credentials are redacted.',
      '',
      '```jsonl',
      redact(logs).trimEnd(),
      '```',
      ''
    );
  }
  return sections.join('\n');
}

/**
 * Builds a prefilled "new issue" link. Logs are shortened, then dropped, until the link
 * fits; the full report is saved locally by the caller so nothing is lost.
 */
export function buildIssueLink(options: {
  repositoryUrl: string;
  channel: string;
  title: string;
  report: (logs: string) => string;
  logs: string;
}): IssueLink {
  const title = `[${options.channel}] ${redact(options.title).trim() || 'Feedback'}`.slice(0, TITLE_LIMIT);
  const attempts = [options.logs, options.logs.slice(-4000), options.logs.slice(-1000), ''];

  for (const logs of attempts) {
    const body = options.report(logs);
    const url = `${options.repositoryUrl}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=feedback`;
    if (url.length <= ISSUE_URL_LIMIT) {
      const logsIncluded = logs === options.logs ? 'all' : logs ? 'partial' : 'none';
      return { url, logsIncluded };
    }
  }
  throw new Error('Feedback is too long to fit in an issue link.');
}

/** Only links to the project's own "new issue" page may be opened from the app. */
export function isAllowedIssueUrl(url: string, repositoryUrl: string): boolean {
  return url.startsWith(`${repositoryUrl}/issues/new?`);
}
