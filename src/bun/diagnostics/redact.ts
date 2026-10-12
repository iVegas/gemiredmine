// Removes credentials from anything that is written to diagnostics or sent in feedback.
// Redaction runs before a message is aggregated, so secrets never reach disk.
const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers, with or without a scheme
  [/(authorization["']?\s*[:=]\s*["']?)(?:(?:basic|bearer)\s+)?[^\s"',;]+/gi, '$1[REDACTED]'],
  // Redmine's API key header
  [/(x-redmine-api-key["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]'],
  // Credential-looking key/value pairs, in text, query strings or JSON
  [
    /(["']?\b(?:api_?key|api_?token|password|passwd|secret|token)\b["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
    '$1[REDACTED]',
  ],
  // Credentials embedded in URLs
  [/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@'],
  // Redmine API keys are 40 hex characters
  [/\b[0-9a-f]{40}\b/gi, '[REDACTED]'],
];

export function redact(text: string): string {
  return PATTERNS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}
