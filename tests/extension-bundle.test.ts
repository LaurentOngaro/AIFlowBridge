import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '..');
const PACKAGE_JSON = resolve(REPO, 'package.json');
const VSIXIGNORE = resolve(REPO, '.vscodeignore');
const VSCE_BIN = resolve(REPO, 'node_modules', '.bin', 'vsce.cmd');

interface PackageJson {
  readonly bundledDependencies?: ReadonlyArray<string>;
  readonly dependencies?: Record<string, string>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

describe('extension VSIX bundle completeness', () => {
  afterAll(() => {
    // nothing to tear down
  });

  // regression guard: the v2.10.0 release shipped without
  // `node_modules/adm-zip/` inside the VSIX, so users hitting
  // `AIFlowBridge: Install standalone gateway` got
  //   `Failed to install standalone gateway: Cannot find module 'adm-zip'`
  // The fix has two halves (both must hold):
  //   1. `package.json` lists `adm-zip` and `tar` in `bundledDependencies`.
  //   2. `.vscodeignore` re-includes `node_modules/adm-zip/**` and
  //      `node_modules/tar/**` (the blanket `node_modules/**` exclusion
  //      otherwise wipes them on the way out).
  // This test asserts (1) statically (cheap, always-runs) and (2)+(3)
  // by actually running `vsce package` and inspecting the resulting VSIX.
  it('package.json lists adm-zip and tar in bundledDependencies', () => {
    const pkg = readJson(PACKAGE_JSON) as PackageJson;
    expect(pkg.bundledDependencies).toBeDefined();
    expect(pkg.bundledDependencies).toContain('adm-zip');
    expect(pkg.bundledDependencies).toContain('tar');
  });

  it('.vscodeignore re-includes the adm-zip and tar node_modules folders', () => {
    const ignore = readFileSync(VSIXIGNORE, 'utf8');
    expect(ignore).toMatch(/^!node_modules\/adm-zip\/\*\*/m);
    expect(ignore).toMatch(/^!node_modules\/tar\/\*\*/m);
  });

  it('the packaged VSIX carries node_modules/adm-zip and node_modules/tar', () => {
    if (!existsSync(VSCE_BIN)) {
      // `vsce` is a dev dependency and may be absent in slim CI checks;
      // the static assertions above still cover the contract.
      return;
    }
    const tmp = mkdtempSync(join(tmpdir(), 'aifb-vsix-test-'));
    const outDir = join(tmp, 'out');
    mkdirSync(outDir, { recursive: true });
    const vsixPath = join(outDir, 'aiflowbridge.vsix');

    let stdout = '';
    let stderr = '';
    let status = 0;
    try {
      stdout = execFileSync(VSCE_BIN, ['package', '--out', vsixPath], {
        cwd: REPO,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      status = e.status ?? 1;
      stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? '');
      stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf8') ?? '');
    }
    expect(status, `vsce package failed: ${stderr}\n${stdout}`).toBe(0);
    expect(existsSync(vsixPath)).toBe(true);

    // Unzip the VSIX (it's a ZIP) with PowerShell's Expand-Archive so the
    // test does not require an extra dependency. PowerShell's
    // Expand-Archive refuses `.vsix` even though a .vsix IS a .zip
    // (same container, same magic bytes) - the cmdlet whitelists
    // extensions by suffix. Copy the file to a `.zip` sibling so
    // the cmdlet accepts it, then extract from the copy.
    const extractDir = join(tmp, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    const vsixAsZip = join(outDir, 'aiflowbridge.zip');
    copyFileSync(vsixPath, vsixAsZip);
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${vsixAsZip}' -DestinationPath '${extractDir}' -Force`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const admZipDir = join(extractDir, 'extension', 'node_modules', 'adm-zip');
    const tarDir = join(extractDir, 'extension', 'node_modules', 'tar');
    expect(existsSync(admZipDir), 'adm-zip folder must be inside the VSIX').toBe(true);
    expect(existsSync(tarDir), 'tar folder must be inside the VSIX').toBe(true);

    // The entry points resolved by `require('adm-zip')` /
    // `require('tar')` must also be on disk so the dynamic import
    // inside `extractTarGz()` / `extractZip()` resolves at runtime.
    const admZipPkg = readJson(join(admZipDir, 'package.json')) as { main?: string };
    const tarPkg = readJson(join(tarDir, 'package.json')) as { main?: string };
    if (admZipPkg.main) {
      expect(existsSync(join(admZipDir, admZipPkg.main)), `adm-zip entry ${admZipPkg.main} missing`).toBe(true);
    }
    if (tarPkg.main) {
      expect(existsSync(join(tarDir, tarPkg.main)), `tar entry ${tarPkg.main} missing`).toBe(true);
    }

    rmSync(tmp, { recursive: true, force: true });
  }, 120_000);
});
