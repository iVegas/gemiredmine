import { describe, it, expect } from 'vitest';
import { redact } from '../redact';

describe('redact', () => {
  it('removes Authorization headers and Redmine API key headers', () => {
    expect(redact('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: [REDACTED]');
    expect(redact('headers: {"X-Redmine-API-Key": "abc"}')).toContain('"X-Redmine-API-Key": "[REDACTED]"');
  });

  it('removes credential key/value pairs in text, query strings and JSON', () => {
    expect(redact('password=hunter2 user=ana')).toBe('password=[REDACTED] user=ana');
    expect(redact('{"apiKey": "k-123", "name": "x"}')).toBe('{"apiKey": "[REDACTED]", "name": "x"}');
    expect(redact('https://redmine.test/issues?api_key=abc&status=open')).toBe(
      'https://redmine.test/issues?api_key=[REDACTED]&status=open'
    );
  });

  it('removes credentials embedded in URLs', () => {
    expect(redact('connect https://ana:secret@redmine.test/x')).toBe('connect https://[REDACTED]@redmine.test/x');
  });

  it('removes bare 40-character Redmine API keys', () => {
    const key = '0123456789abcdef0123456789abcdef01234567';
    expect(key).toHaveLength(40);
    expect(redact(`token ${key} end`)).toBe('token [REDACTED] end');
  });

  it('leaves ordinary messages alone', () => {
    expect(redact('Invalid username or password.')).toBe('Invalid username or password.');
    expect(redact('Redmine API request failed: 503 Service Unavailable')).toBe(
      'Redmine API request failed: 503 Service Unavailable'
    );
  });
});
