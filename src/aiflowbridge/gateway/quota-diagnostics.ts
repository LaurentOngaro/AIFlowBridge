/**
 * Upstream quota diagnostics.
 *
 * A 429 from an upstream is ambiguous on its own. `RESOURCE_EXHAUSTED`
 * covers at least three situations that need opposite reactions:
 *
 *   - a per-minute rate limit that clears in seconds, where retrying
 *     immediately is the right move;
 *   - a real daily/monthly allowance that has been consumed, where the
 *     user needs to know when it comes back;
 *   - an account or project with **no allocation at all**, where no
 *     amount of retrying will ever succeed and the fix is a console
 *     change, not a wait.
 *
 * Google's surfaces do NOT always let the three apart. A bare
 *
 *     {"error":{"code":429,"message":"Resource has been exhausted
 *       (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}
 *
 * carries no violation block, so it is compatible with all three. This
 * module therefore classifies ONLY on positive evidence:
 *
 *   - `billing-exhausted`  : 402, or an explicit "no billing" message.
 *   - `rate-limited`        : a metric whose SUFFIX names a time window.
 *   - `zero-allocation`     : a metric with an explicitly reported value
 *                             of zero. Not the absence of a metric.
 *   - `quota-exhausted`     : a metric with a non-zero allowance.
 *
 * Anything else stays UNCLASSIFIED (`undefined`), and the gateway then
 * publishes no `X-AIFlowBridge-Quota-State` header at all. Asserting
 * `zero-allocation` from a bare 429 would send the user chasing a
 * console change for what may only be a momentary rate limit, and the
 * absence of a metric is not evidence of a missing entitlement.
 *
 * This module is deliberately pure so the classification is testable
 * against recorded bodies, with no gateway, no host and no clock beyond
 * an injected `now`.
 */

/** What kind of refusal the upstream is reporting. */
export type QuotaState =
  | 'rate-limited'
  | 'quota-exhausted'
  | 'zero-allocation'
  | 'billing-exhausted'
  | 'not-quota';

/** Structured verdict for one upstream refusal. */
export interface QuotaDiagnosis {
  readonly state: QuotaState;
  /** Seconds to wait, when the upstream (or its body) advertised one. */
  readonly retryAfterSeconds?: number;
  /** ISO timestamp of the next reset, when the body carried one. */
  readonly resetAt?: string;
  /** Google quota metric name, when the body disclosed it. */
  readonly quotaMetric?: string;
  /** Allocated amount for that metric, as reported upstream. */
  readonly quotaValue?: string;
  /** One actionable sentence, safe to log and to surface to the user. */
  readonly summary: string;
}

/** Inputs: the status, the raw body text, and the response headers. */
export interface QuotaDiagnosisInput {
  readonly status: number;
  readonly bodyText: string;
  readonly headers?: Readonly<Record<string, string | undefined | null>>;
  /** Injected clock, so `resetAt` is deterministic under test. */
  readonly now?: number;
}

/**
 * JSON-ish Google error payloads reach us in three shapes: raw JSON, an
 * SSE `data: {...}` frame (several Google surfaces answer errors with
 * `content-type: text/event-stream`), or an empty body. Normalize all of
 * them to an object, or `undefined` when there is nothing to read.
 */
function parseErrorBody(bodyText: string): Record<string, unknown> | undefined {
  const trimmed = bodyText.trim();
  if (trimmed === '') {
    return undefined;
  }
  const candidates = [trimmed];
  // SSE framing: take the last complete `data:` line, which is where the
  // payload sits when the upstream mislabels an error as a stream.
  const dataLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line !== '' && line !== '[DONE]');
  candidates.push(...dataLines.reverse());

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON: fall through to the next candidate
    }
  }
  return undefined;
}

/** Google proto durations: `"30s"`, `"1.5s"`, `"120000ms"`. */
function parseDurationSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return match[2] === 'ms' ? Math.ceil(value / 1000) : Math.ceil(value);
}

/** `Retry-After` is delta-seconds (RFC 9110) or an HTTP-date. */
function parseRetryAfterHeader(raw: string | null | undefined, now: number): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((asDate - now) / 1000));
}

function firstString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Walk `details[]` for the two blocks we care about: the quota violation
 * list (tells us whether an allowance exists) and the retry hint (tells
 * us when to come back).
 */
function readDetails(error: Record<string, unknown> | undefined): {
  metric?: string;
  value?: string;
  retryDelaySeconds?: number;
} {
  const details = error?.details;
  if (!Array.isArray(details)) {
    return {};
  }
  let metric: string | undefined;
  let value: string | undefined;
  let retryDelaySeconds: number | undefined;

  for (const entry of details) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const detail = entry as Record<string, unknown>;
    const type = firstString(detail, '@type') ?? '';

    if (type.includes('QuotaFailure') && Array.isArray(detail.violations)) {
      for (const violation of detail.violations) {
        if (!violation || typeof violation !== 'object') {
          continue;
        }
        const record = violation as Record<string, unknown>;
        const violationMetric = firstString(record, 'quotaMetric');
        const violationValue = firstString(record, 'quotaValue');
        if (violationMetric) {
          metric ??= violationMetric;
        }
        if (violationValue !== undefined) {
          value ??= violationValue;
        }
      }
    }

    if (type.includes('RetryInfo')) {
      retryDelaySeconds ??= parseDurationSeconds(firstString(detail, 'retryDelay'));
      if (retryDelaySeconds === undefined) {
        const retryAfter = detail.retryAfter;
        if (typeof retryAfter === 'string') {
          retryDelaySeconds ??= parseDurationSeconds(retryAfter);
        }
      }
    }
  }
  return { metric, value, retryDelaySeconds };
}

/**
 * A metric that counts events per window is a rate limit, not a budget.
 *
 * Matched on the metric SUFFIX only. An earlier version also matched a
 * bare `rate`, which is wrong: every Google metric contains "generate",
 * and that substring alone reclassified a daily allowance as a rate
 * limit.
 */
function looksLikeRateLimit(metric: string | undefined): boolean {
  if (!metric) {
    return false;
  }
  return (
    /_per_(?:minute|second|day|hour|week|month|60s|100s)$/i.test(metric) ||
    /RequestsPer(?:Minute|Second|Day|Hour|Week|Month)$/i.test(metric)
  );
}

/** `"0"`, `0`, `"0.0"` all mean the same thing: nothing was allocated. */
function isZeroAllocation(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return Number.parseFloat(value) === 0;
}

function formatReset(resetAt: string | undefined): string {
  return resetAt ? ` It resets at ${resetAt}.` : ' No reset time is advertised by the upstream.';
}

/**
 * Classify an upstream refusal. Returns `undefined` when the response is
 * not a quota or billing problem, so the caller stays a no-op for every
 * other status.
 */
export function diagnoseUpstreamQuota(input: QuotaDiagnosisInput): QuotaDiagnosis | undefined {
  const { status, bodyText } = input;
  if (status !== 429 && status !== 402 && status !== 503) {
    return undefined;
  }

  const now = input.now ?? Date.now();
  const parsed = parseErrorBody(bodyText);
  const error = parsed && typeof parsed.error === 'object' && parsed.error !== null ? (parsed.error as Record<string, unknown>) : undefined;
  const message = firstString(error, 'message') ?? '';
  const headerRetryAfter = parseRetryAfterHeader(input.headers?.['retry-after'], now);
  const { metric, value, retryDelaySeconds } = readDetails(error);

  // Billing refusals: never a rate limit, and they never clear by
  // waiting. Gemini reports depleted prepayment credits this way.
  const billingRefusal = status === 402 || /prepayment credits are depleted|billing (?:is )?(?:not active|disabled)|no billing account/i.test(message);
  if (billingRefusal) {
    return {
      state: 'billing-exhausted',
      quotaMetric: metric,
      quotaValue: value,
      summary:
        'Upstream reports the Google project has no billing credit left (402). Waiting will not help: top up the project, enable billing, or switch this provider to the BYOK API-key route.',
    };
  }

  // Positive evidence is required for every classification below.
  // A bare `RESOURCE_EXHAUSTED` with no readable violation block is
  // compatible with a rate limit, a spent allowance and a missing
  // entitlement, so it stays unclassified.
  const explicitStatus = firstString(error, 'status');
  const isResourceExhausted =
    explicitStatus === 'RESOURCE_EXHAUSTED' || /resource has been exhausted|check quota/i.test(message);
  if (!isResourceExhausted) {
    return undefined;
  }

  const retryAfterSeconds = headerRetryAfter ?? retryDelaySeconds;

  // No quota metric at all: no verdict. The caller then publishes no
  // quota header, which is the honest outcome: the status alone does not
  // tell us which of the three situations this is.
  if (metric === undefined) {
    return undefined;
  }

  // A per-window metric is a rate limit: it clears on its own.
  if (looksLikeRateLimit(metric)) {
    return {
      state: 'rate-limited',
      retryAfterSeconds,
      quotaMetric: metric,
      quotaValue: value,
      summary: `Upstream rate limit hit on ${metric}.${
        retryAfterSeconds !== undefined ? ` Retry in ${retryAfterSeconds}s.` : ''
      }`,
    };
  }

  // A metric whose reported allowance is exactly zero is positive
  // evidence of an entitlement gap: the upstream named the metric AND
  // reported nothing to spend on it. Retrying cannot fix this.
  if (isZeroAllocation(value)) {
    return {
      state: 'zero-allocation',
      retryAfterSeconds,
      quotaMetric: metric,
      quotaValue: value,
      summary:
        `Upstream reports a quota of zero for ${metric} on this account or project, so this is an entitlement gap rather than a spent budget. ` +
        'Retrying will not help: review the quota granted to this account in the upstream provider console, or use a different credential.',
    };
  }

  const resetAt =
    retryAfterSeconds !== undefined ? new Date(now + retryAfterSeconds * 1000).toISOString() : undefined;
  return {
    state: 'quota-exhausted',
    retryAfterSeconds,
    resetAt,
    quotaMetric: metric,
    quotaValue: value,
    summary: `Upstream quota exhausted on ${metric}${value ? ` (allowance ${value})` : ''}.${formatReset(resetAt)}`,
  };
}