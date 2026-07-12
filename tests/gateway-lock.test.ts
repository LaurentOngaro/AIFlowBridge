/**
 * Unit tests for src/aiflowbridge/gateway/lock.ts
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// logger.ts pulls in vscode via LogOutputChannel; provide a shim.
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
        dispose = vi.fn();
      },
    },
  };
});

import { acquireGatewayLock, releaseGatewayLock } from '../src/aiflowbridge/gateway/lock';

describe('gateway lock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiflowbridge-lock-'));
    lockPath = join(dir, 'gateway.lock');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires a free lock', () => {
    const result = acquireGatewayLock(lockPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handle.path).toBe(lockPath);
      releaseGatewayLock(result.handle);
    }
  });

  it('returns { ok: false, reason: "held" } when the lock is already held', () => {
    const first = acquireGatewayLock(lockPath);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = acquireGatewayLock(lockPath);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('held');
    releaseGatewayLock(first.handle);
    // After release, a new acquisition succeeds
    const third = acquireGatewayLock(lockPath);
    expect(third.ok).toBe(true);
    if (third.ok) releaseGatewayLock(third.handle);
  });

  it('returns { ok: false, reason: "not-acquirable" } when the path is a symlink', () => {
    // Create a symlink at the lock path pointing to a real file
    const target = join(dir, 'target.txt');
    writeFileSync(target, 'hello');
    // mkdtempSync already created `dir`; we use the parent as the symlink target
    const symlinkPath = join(dir, 'link.lock');
    symlinkSync(target, symlinkPath, 'file');
    const result = acquireGatewayLock(symlinkPath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-acquirable');
    expect(result.error).toMatch(/symlink/i);
  });

  it('creates the parent directory if it does not exist', () => {
    const nestedPath = join(dir, 'nested', 'deeper', 'gateway.lock');
    // dir/nested/deeper does not exist yet
    const result = acquireGatewayLock(nestedPath);
    expect(result.ok).toBe(true);
    if (result.ok) releaseGatewayLock(result.handle);
  });

  it('releaseGatewayLock tolerates a null handle', () => {
    expect(() => releaseGatewayLock(null)).not.toThrow();
  });

  it('reaps a stale lock (mtime > 30s) and re-acquires', () => {
    // Manually create a "stale" lock file with an old mtime
    writeFileSync(lockPath, 'stale');
    const fortySecondsAgo = new Date(Date.now() - 40_000);
    utimesSync(lockPath, fortySecondsAgo, fortySecondsAgo);

    const result = acquireGatewayLock(lockPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reapedStale).toBe(true);
      releaseGatewayLock(result.handle);
    }
  });

  it('does NOT reap a fresh lock (mtime < 30s)', () => {
    const first = acquireGatewayLock(lockPath);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // mtime is now; second acquirer should be told "held", not reap
    const second = acquireGatewayLock(lockPath);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('held');
    expect(second).not.toHaveProperty('reapedStale');

    releaseGatewayLock(first.handle);
  });
});

// Reuse the existing helper from a previous test scenario that needs
// mkdirSync to be imported (kept here to avoid unused-import warnings).
void mkdirSync;
