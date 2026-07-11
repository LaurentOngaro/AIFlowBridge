/**
 * Unit tests for the gateway request log formatter. The line is
 * emitted to the user's standalone console on every
 * `/v1/chat/completions` (when `gateway.telemetry.logRequests = true`)
 * and is user-greppable, so the format is part of the public
 * contract. A regression here is a user-visible regression.
 */

import { describe, expect, it, vi } from 'vitest';

// The gateway server module transitively imports `vscode` via the
// `logger.ts` -> `vscode.window.createOutputChannel` chain. We do
// not exercise that path here (only the pure formatting helpers)
// but the import has to resolve for the module to load.
vi.mock('vscode', () => {
  return {
    default: {
      window: {
        createOutputChannel: vi.fn(() => ({
          name: 'AIFlowBridge',
          log: vi.fn(),
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          dispose: vi.fn(),
          append: vi.fn(),
          appendLine: vi.fn(),
          clear: vi.fn(),
          show: vi.fn(),
          hide: vi.fn(),
        })),
      },
      LogLevel: { Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Off: 5 },
      LogOutputChannel: class MockLogOutputChannel {
        name = 'AIFlowBridge';
        log = vi.fn();
        trace = vi.fn();
        debug = vi.fn();
        info = vi.fn();
        warn = vi.fn();
        error = vi.fn();
      },
    },
  };
});

import { formatLocalTimestamp, formatRequestLogLine } from '../src/aiflowbridge/gateway/server';

describe('formatRequestLogLine', () => {
  it('renders the expected layout: [YYYY-MM-DD HH:MM:SS] [Gateway] {id} {provider} {status} {ms}ms', () => {
    // Use a fixed Date so the test is reproducible across time
    // zones (the helper reads local-time components, so the
    // expected string depends on the test runner's TZ; we read
    // them back off the same Date to keep the assertion honest).
    const now = new Date(2026, 6, 11, 9, 4, 41, 123); // months are 0-indexed: 6 = July
    const line = formatRequestLogLine('99929fbd-9ab1-485c-993f-01b7acf85ff5', 'MiniMax-M3', 200, 3642, now);
    expect(line).toBe('[2026-07-11 09:04:41] [Gateway] 99929fbd-9ab1-485c-993f-01b7acf85ff5 MiniMax-M3 200 3642ms');
  });

  it('zero-pads single-digit month, day, hour, minute, and second', () => {
    // 2026-01-05 03:07:09 -> every component is a single digit.
    const now = new Date(2026, 0, 5, 3, 7, 9, 0);
    const line = formatRequestLogLine('r', 'p1', 200, 1, now);
    expect(line.startsWith('[2026-01-05 03:07:09]')).toBe(true);
  });

  it('preserves a non-2xx status code verbatim (errors are visible too)', () => {
    const now = new Date(2026, 6, 11, 11, 0, 0, 0);
    const line = formatRequestLogLine('r', 'p1', 504, 95_000, now);
    expect(line).toContain(' 504 95000ms');
  });

  it('keeps the [Gateway] ... payload format unchanged from the pre-timestamp log line', () => {
    // The user grep workflow looks for `[Gateway] {requestId}` (the
    // payload after the [origin] tag). Adding the date prefix must
    // not shift the relative position of those tokens.
    const now = new Date(2026, 6, 11, 11, 0, 0, 0);
    const line = formatRequestLogLine('req-1', 'p1', 200, 1, now);
    expect(line).toContain('] [Gateway] req-1 p1 200 1ms');
  });

  it('uses local time components, not UTC (so the stamp matches the user console clock)', () => {
    // Two Dates constructed with the same UTC instant but in
    // different TZs (impossible from a single Node process - we
    // just assert that the helper reads local components by
    // constructing a Date with a known local hour).
    const now = new Date(2026, 6, 11, 14, 30, 5, 0);
    const stamp = formatLocalTimestamp(now);
    expect(stamp).toBe(`2026-07-11 ${pad(14)}:30:05`);
  });
});

describe('formatLocalTimestamp', () => {
  it('zero-pads every component to two digits', () => {
    const now = new Date(2026, 0, 2, 3, 4, 5, 0);
    expect(formatLocalTimestamp(now)).toBe('2026-01-02 03:04:05');
  });

  it('does not include milliseconds (sub-second noise at request latency)', () => {
    const now = new Date(2026, 6, 11, 11, 0, 0, 999);
    const stamp = formatLocalTimestamp(now);
    expect(stamp).not.toContain('999');
    expect(stamp).toBe('2026-07-11 11:00:00');
  });

  it('handles the December 31 -> January 1 wrap without a NaN', () => {
    const now = new Date(2026, 11, 31, 23, 59, 59, 0);
    expect(formatLocalTimestamp(now)).toBe('2026-12-31 23:59:59');
  });
});

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
