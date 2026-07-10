import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-standalone-bundle.js');
const ENTRY = resolve(__dirname, '..', 'dist', 'standalone', 'main.js');

function runScript(entryPath: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, entryPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf8') ?? ''),
    };
  }
}

describe('standalone bundle completeness', () => {
  it('script exists at scripts/check-standalone-bundle.js', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  // Runs only when the developer has built the standalone at least once
  // (`npm run build:standalone`). Most contributors run the test suite
  // without rebuilding the standalone dist, so we skip silently in that
  // case rather than failing the suite. The release workflow runs the
  // same script on CI after a fresh build.
  it('dist/standalone/main.js has all relative requires resolvable on disk', () => {
    if (!existsSync(ENTRY)) return;
    const result = runScript(ENTRY);
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout).toContain('relative require(s) resolved');
  });

  // Regression guard for the v2.3.0 bug: when only dist/standalone/ is
  // shipped, the entry point cannot resolve `../aiflowbridge`,
  // `../logger`, etc. We simulate this by copying main.js into an empty
  // tree with no sibling modules and assert the script catches it.
  it('reports missing references when sibling modules are absent (v2.3.0 regression)', () => {
    const stage = mkdtempSync(join(tmpdir(), 'aifb-bundle-test-'));
    const src = resolve(__dirname, '..', 'dist', 'standalone', 'main.js');
    if (!existsSync(src)) {
      rmSync(stage, { recursive: true, force: true });
      return;
    }
    const stagedEntry = join(stage, 'main.js');
    mkdirSync(stage, { recursive: true });
    writeFileSync(stagedEntry, `// stub\nrequire('../aiflowbridge');\nrequire('../logger');\n`);

    const result = runScript(stagedEntry);
    rmSync(stage, { recursive: true, force: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing reference');
    expect(result.stderr).toContain('../aiflowbridge');
    expect(result.stderr).toContain('../logger');
  });

  it('reports missing package.json and resources/models.json as runtime references', () => {
    const stage = mkdtempSync(join(tmpdir(), 'aifb-bundle-test-'));
    // Simulate a tree where the JS modules are complete but the runtime
    // metadata files (package.json, resources/models.json) are absent.
    const distStandalone = join(stage, 'dist', 'standalone');
    mkdirSync(distStandalone, { recursive: true });
    writeFileSync(join(distStandalone, 'main.js'), `// stub - all relative requires are empty\n`);
    writeFileSync(join(stage, 'dist', 'logger.js'), 'module.exports = {};\n');
    mkdirSync(join(stage, 'dist', 'aiflowbridge'), { recursive: true });
    writeFileSync(join(stage, 'dist', 'aiflowbridge', 'index.js'), 'module.exports = {};\n');
    writeFileSync(join(stage, 'dist', 'aiflowbridge', 'modelRegistry.js'), 'module.exports = {};\n');
    writeFileSync(join(stage, 'dist', 'standalone', 'context.js'), 'module.exports = {};\n');

    const result = runScript(join(distStandalone, 'main.js'));
    rmSync(stage, { recursive: true, force: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.json');
    expect(result.stderr).toContain('resources/models.json');
  });

  it('handles extension-less specifiers by trying .js / .json / /index.js', () => {
    const stage = mkdtempSync(join(tmpdir(), 'aifb-bundle-test-'));
    // Mimic the installed standalone layout: entry is at
    // <root>/dist/standalone/main.js, with runtime files
    // package.json and resources/models.json at <root>.
    mkdirSync(join(stage, 'dist', 'standalone'), { recursive: true });
    mkdirSync(join(stage, 'dist', 'lib'), { recursive: true });
    mkdirSync(join(stage, 'resources'), { recursive: true });
    writeFileSync(join(stage, 'package.json'), '{"version":"1.0.0"}');
    writeFileSync(join(stage, 'resources', 'models.json'), '{}');
    writeFileSync(join(stage, 'dist', 'lib', 'helper.js'), 'module.exports = {};\n');
    writeFileSync(join(stage, 'dist', 'standalone', 'main.js'), `require('../lib/helper');\n`);
    const result = runScript(join(stage, 'dist', 'standalone', 'main.js'));
    rmSync(stage, { recursive: true, force: true });
    expect(result.status, result.stderr).toBe(0);
  });
});
