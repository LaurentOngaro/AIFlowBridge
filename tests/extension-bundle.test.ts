import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '..');
const PACKAGE_JSON = resolve(REPO, 'package.json');
const VSIXIGNORE = resolve(REPO, '.vscodeignore');
// `vsce` ships per-platform shims in `node_modules/.bin/`: `vsce.cmd` +
// `vsce.ps1` on Windows, the bare `vsce` shebang script on Linux/macOS.
// The previous test hard-coded the `.cmd` extension, which `sh -c` cannot
// execute under Fedora and other non-Windows hosts.
const VSCE_BIN = resolve(REPO, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');

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

    // Inspect the VSIX (a ZIP container) directly with `adm-zip` so the
    // test stays portable across Windows / macOS / Linux. The previous
    // implementation spawned PowerShell's `Expand-Archive`, which
    // refuses `.vsix` and is Windows-only - under Fedora the `execFileSync`
    // failed with `ENOENT` and the test reported a misleading "VSIX does
    // not exist" error. Listing the entries is enough to assert both
    // that the modules are packaged AND that their entry points resolve
    // (`main` field of each bundled `package.json`).
    const zip = new AdmZip(vsixPath);
    const entryNames = zip.getEntries().map((e) => e.entryName);

    const admZipEntries = entryNames.filter((n) => n.startsWith('extension/node_modules/adm-zip/'));
    const tarEntries = entryNames.filter((n) => n.startsWith('extension/node_modules/tar/'));
    expect(admZipEntries.length, 'adm-zip folder must be inside the VSIX').toBeGreaterThan(0);
    expect(tarEntries.length, 'tar folder must be inside the VSIX').toBeGreaterThan(0);

    // The entry points resolved by `require('adm-zip')` /
    // `require('tar')` must also be on disk so the dynamic import
    // inside `extractTarGz()` / `extractZip()` resolves at runtime.
    // Strip a leading `./` so paths like `"./dist/commonjs/index.min.js"`
    // (tar's own package.json) match the ZIP entry which uses a plain
    // POSIX path.
    const admZipPkg = JSON.parse(zip.readAsText('extension/node_modules/adm-zip/package.json')) as { main?: string };
    const tarPkg = JSON.parse(zip.readAsText('extension/node_modules/tar/package.json')) as { main?: string };
    const stripDotSlash = (p: string): string => (p.startsWith('./') ? p.slice(2) : p);
    if (admZipPkg.main) {
      const main = stripDotSlash(admZipPkg.main);
      expect(entryNames, `adm-zip entry ${main} missing`).toContain(`extension/node_modules/adm-zip/${main}`);
    }
    if (tarPkg.main) {
      const main = stripDotSlash(tarPkg.main);
      expect(entryNames, `tar entry ${main} missing`).toContain(`extension/node_modules/tar/${main}`);
    }

    rmSync(tmp, { recursive: true, force: true });
  }, 120_000);
});
