/**
 * Quota diagnostics unit tests.
 *
 * The bodies below are the ones Google actually returned on the
 * Cloud Code Assist `v1internal` surface for this project, plus the
 * Gemini Developer API shapes they are usually confused with. The point
 * of the module is that two of them are indistinguishable by status code
 * alone (429) yet need opposite reactions from the user.
 */

import { describe, expect, it } from 'vitest';
import { diagnoseUpstreamQuota } from '../src/aiflowbridge/gateway/quota-diagnostics';

/** Recorded verbatim from cloudcode-pa.googleapis.com, no quota block. */
const CLOUDCODE_BARE = JSON.stringify({
  error: {
    code: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
    status: 'RESOURCE_EXHAUSTED',
  },
});

/** The same surface wrapped in SSE framing, which it also uses for errors. */
const CLOUDCODE_SSE = `data: ${CLOUDCODE_BARE}\n\n`;

/** Gemini Developer API shape, with a violation block and a retry hint. */
const GEMINI_WITH_VIOLATION = JSON.stringify({
  error: {
    code: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.RetryInfo',
        retryDelay: '37s',
      },
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId: 'GenerateContentFreeTierRequestsPerProjectPerDay',
            quotaValue: '1500',
            quotaUnit: '1',
          },
        ],
      },
    ],
  },
});

/** Depleted prepayment credits: the 402 seen on the BYOK route. */
const GEMINI_BILLING = JSON.stringify({
  error: {
    code: 402,
    message:
      'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.',
    status: 'RESOURCE_EXHAUSTED',
  },
});

describe('quota diagnostics - Cloud Code Assist (the case that motivated this)', () => {
  it('reads a bare RESOURCE_EXHAUSTED as zero allocation, not as a spent budget', () => {
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: CLOUDCODE_BARE });
    expect(diagnosis?.state).toBe('zero-allocation');
    // No quota metric in the body: the upstream accepted the credentials
    // but reports nothing to spend, which is an entitlement gap.
    expect(diagnosis?.quotaMetric).toBeUndefined();
    expect(diagnosis?.summary).toMatch(/no quota allocated/i);
    expect(diagnosis?.summary).toMatch(/retrying will not help/i);
  });

  it('handles the SSE-framed variant the same way', () => {
    // The Antigravity surface answers errors with
    // `content-type: text/event-stream` but a JSON payload.
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: CLOUDCODE_SSE });
    expect(diagnosis?.state).toBe('zero-allocation');
  });

  it('stays unclassified when a 429 carries no readable body', () => {
    // No body means no evidence. Asserting an entitlement gap here would
    // send the user after a console change for what may only be a
    // momentary rate limit, so the module declines to guess.
    expect(diagnoseUpstreamQuota({ status: 429, bodyText: '' })).toBeUndefined();
  });

  it('treats an explicitly zero allowance as zero allocation', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaMetric: 'cloudaicompanion.googleapis.com/generate_content_requests',
                quotaValue: '0',
              },
            ],
          },
        ],
      },
    });
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: body });
    expect(diagnosis?.state).toBe('zero-allocation');
    expect(diagnosis?.quotaValue).toBe('0');
    expect(diagnosis?.summary).toContain('cloudaicompanion.googleapis.com/generate_content_requests');
  });
});

describe('quota diagnostics - Gemini Developer API (a real, spent budget)', () => {
  it('reads a violation block with a non-zero allowance as an exhausted quota', () => {
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: GEMINI_WITH_VIOLATION });
    expect(diagnosis?.state).toBe('quota-exhausted');
    expect(diagnosis?.quotaMetric).toBe('generativelanguage.googleapis.com/generate_content_free_tier_requests');
    expect(diagnosis?.quotaValue).toBe('1500');
    expect(diagnosis?.retryAfterSeconds).toBe(37);
  });

  it('derives the reset timestamp from the advertised retry delay', () => {
    const now = Date.parse('2026-10-09T10:00:00Z');
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: GEMINI_WITH_VIOLATION, now });
    expect(diagnosis?.resetAt).toBe('2026-10-09T10:00:37.000Z');
    expect(diagnosis?.summary).toContain('It resets at 2026-10-09T10:00:37.000Z');
  });

  it('distinguishes this from zero allocation, which is the whole point', () => {
    const spent = diagnoseUpstreamQuota({ status: 429, bodyText: GEMINI_WITH_VIOLATION });
    const never = diagnoseUpstreamQuota({ status: 429, bodyText: CLOUDCODE_BARE });
    expect(spent?.state).not.toBe(never?.state);
    expect(spent?.state).toBe('quota-exhausted');
    expect(never?.state).toBe('zero-allocation');
  });

  it('classifies depleted prepayment credits as billing, never as rate limiting', () => {
    const diagnosis = diagnoseUpstreamQuota({ status: 402, bodyText: GEMINI_BILLING });
    expect(diagnosis?.state).toBe('billing-exhausted');
    expect(diagnosis?.summary).toMatch(/waiting will not help/i);
    expect(diagnosis?.summary).toMatch(/BYOK API-key route/);
  });
});

describe('quota diagnostics - rate limits', () => {
  it('reads a per-window metric as a rate limit that clears on its own', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaMetric: 'cloudaicompanion.googleapis.com/generate_content_requests_per_minute',
                quotaValue: '5',
              },
            ],
          },
        ],
      },
    });
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: body });
    expect(diagnosis?.state).toBe('rate-limited');
    expect(diagnosis?.summary).toMatch(/rate limit/i);
  });

  it('prefers the Retry-After header over the body when both are present', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    const diagnosis = diagnoseUpstreamQuota({
      status: 429,
      bodyText: GEMINI_WITH_VIOLATION,
      headers: { 'retry-after': '120' },
      now,
    });
    expect(diagnosis?.retryAfterSeconds).toBe(120);
    expect(diagnosis?.resetAt).toBe(new Date(now + 120_000).toISOString());
  });

  it('accepts an HTTP-date Retry-After', () => {
    const now = Date.parse('2026-10-09T10:00:00Z');
    const diagnosis = diagnoseUpstreamQuota({
      status: 429,
      bodyText: CLOUDCODE_BARE,
      headers: { 'retry-after': 'Fri, 09 Oct 2026 10:05:00 GMT' },
      now,
    });
    expect(diagnosis?.retryAfterSeconds).toBe(300);
  });

  it('parses millisecond proto durations', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1500ms' }],
      },
    });
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: body });
    expect(diagnosis?.retryAfterSeconds).toBe(2);
  });
});

describe('quota diagnostics - non-quota responses', () => {
  it('returns nothing for statuses it has no opinion about', () => {
    for (const status of [200, 400, 401, 403, 404, 500]) {
      expect(diagnoseUpstreamQuota({ status, bodyText: '{"error":{"message":"nope"}}' })).toBeUndefined();
    }
  });

  it('returns nothing for a 503 that is not a quota refusal', () => {
    const diagnosis = diagnoseUpstreamQuota({
      status: 503,
      bodyText: '{"error":{"code":503,"message":"Backend Unavailable"}}',
    });
    expect(diagnosis).toBeUndefined();
  });

  it('returns nothing for unparsable bodies on a 429 it cannot read', () => {
    const diagnosis = diagnoseUpstreamQuota({ status: 429, bodyText: 'not json at all' });
    expect(diagnosis).toBeUndefined();
  });
});