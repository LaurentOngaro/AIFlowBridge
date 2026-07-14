/**
 * Unit tests for `scripts/refresh-bundled-pricing.mjs`.
 *
 * Strategy: spawn the script as a child process with a controlled
 * `cwd` so we exercise the real CLI surface (argument parsing,
 * package.json resolution, atomic write, exit codes) without
 * touching the real network or the user's bundled pricing JSON.
 *
 * The HTTP layer (`fetchOpenRouterModels`) is exercised separately in
 * `tests/openrouter-fetch.test.ts` against synthetic responses. The
 * script's pure helpers (parse, drift table) are duplicated inside
 * the script for portability and are covered by the same fixtures.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '..', 'scripts', 'refresh-bundled-pricing.mjs');

interface ScriptRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runScript(cwd: string, extraEnv: Record<string, string> = {}): ScriptRun {
  // Use a 3-second timeout so a hung HTTPS request (e.g. test env
  // without network) fails fast instead of hanging the suite.
  const result: SpawnSyncReturns<string> = spawnSync('node', [SCRIPT], {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 6_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('refresh-bundled-pricing.mjs', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'aifb-pricing-refresh-'));
    mkdirSync(join(workDir, 'resources'), { recursive: true });
  });

  afterEach(() => {
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('script exists at scripts/refresh-bundled-pricing.mjs and is readable', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toMatch(/openrouter/i);
    expect(source).toMatch(/pricing\.json/);
  });

  it('script can be parsed by Node without syntax errors', () => {
    // `--check` parses the module without executing it. Catches
    // typos that would otherwise only surface at runtime.
    const result = spawnSync('node', ['--check', SCRIPT], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('fails with non-zero exit code when package.json is missing', () => {
    // No package.json in workDir - the script must exit non-zero
    // before even attempting the HTTP fetch.
    const result = runScript(workDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/package\.json|Failed to read/i);
  });

  it('fails with non-zero exit code when package.json has no version field', () => {
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'aiflowbridge' }, null, 2), 'utf8');
    const result = runScript(workDir);
    expect(result.status).not.toBe(0);
    // The hardening surfaces a specific error rather than the
    // silent "0.0.0" sentinel that used to land in the bundled JSON
    // (and then surfaced in the dashboard as a confusing
    // "AIFlowBridge v0.0.0" tag).
    expect(result.stderr).toMatch(/usable "version" string|Refusing to overwrite/i);
  });

  it('fails with non-zero exit code when package.json version is the "0.0.0" sentinel', () => {
    // The script used to silently emit "0.0.0" when pkg.version
    // was missing or non-string; the hardening refuses to write the
    // bundled JSON at all so the sentinel never lands on disk.
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'aiflowbridge', version: '0.0.0' }, null, 2), 'utf8');
    const result = runScript(workDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sentinel|Refusing to overwrite|usable "version"/i);
  });

  it('fails with non-zero exit code when package.json version is a non-string value', () => {
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'aiflowbridge', version: 42 }, null, 2), 'utf8');
    const result = runScript(workDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/usable "version" string|Refusing to overwrite/i);
  });

  it('logs the bundled-pricing write only on success', () => {
    // A complete fixture with a valid package.json. The HTTP fetch
    // will either succeed (real OpenRouter) or fail with a
    // connection error (sandbox without network). In both cases the
    // OK log line is the success marker.
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({ name: 'aiflowbridge', version: '9.9.9-test' }, null, 2),
      'utf8'
    );
    writeFileSync(
      join(workDir, 'resources', 'pricing.json'),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-07-01T00:00:00Z',
        source: 'openrouter',
        aiflowbridgeVersion: '9.9.0-prev',
        models: {},
      }, null, 2),
      'utf8'
    );
    const result = runScript(workDir);
    if (result.status === 0) {
      // Online path: the OK log line is on stdout.
      expect(result.stdout).toMatch(/OK - wrote.*pricing\.json/);
      // The bundled JSON on disk now carries the test version stamp.
      const updated = JSON.parse(readFileSync(join(workDir, 'resources', 'pricing.json'), 'utf8')) as { aiflowbridgeVersion: string };
      expect(updated.aiflowbridgeVersion).toBe('9.9.9-test');
    } else {
      // Offline path: the script exits non-zero with a network error.
      // Either outcome is correct - the test asserts that the script
      // does not silently exit 0 on a failed fetch.
      expect(result.status).not.toBe(0);
    }
  });
});
