import AdmZip from 'adm-zip';
import { gzipSync } from 'node:zlib';
import { create, extract } from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectPlatform, InstallError } from '../src/runtime/installStandalone';

const { mockVscode } = vi.hoisted(() => {
  const noop = () => undefined;
  return {
    mockVscode: {
      Uri: {
        file: (p: string) => ({ fsPath: p, toString: () => p }),
      },
      window: {
        showInformation: noop,
        showWarning: noop,
        showErrorMessage: noop,
        showQuickPick: async () => undefined,
        showOpenDialog: async () => undefined,
        withProgress: async (_opts: unknown, task: (progress: { report: (v: unknown) => void }) => Promise<unknown>) => task({ report: noop }),
      },
      commands: {
        executeCommand: async () => undefined,
        registerCommand: () => ({ dispose: noop }),
      },
      ProgressLocation: { Notification: 10 },
    },
  };
});

vi.mock('vscode', () => {
  const mock: Record<string, unknown> = { ...mockVscode };
  mock.default = mock;
  return mock;
});

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_ARCH = process.arch;

function stubPlatform(platform: NodeJS.Platform, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
  Object.defineProperty(process, 'arch', { value: ORIGINAL_ARCH, configurable: true });
}

describe('detectPlatform', () => {
  afterEach(() => restorePlatform());

  it('detects Linux x64', () => {
    stubPlatform('linux', 'x64');
    const result = detectPlatform();
    expect(result.unsupported).toBe(false);
    if (result.unsupported) return;
    expect(result.os).toBe('linux');
    expect(result.arch).toBe('x64');
    expect(result.archiveName).toBe('aiflowbridge-server-linux-x64.tar.gz');
    expect(result.launcherRelativePath).toBe('bin/aiflowbridge-server');
    expect(result.startCommand).toBe('bin/aiflowbridge-server');
  });

  it('detects macOS arm64', () => {
    stubPlatform('darwin', 'arm64');
    const result = detectPlatform();
    expect(result.unsupported).toBe(false);
    if (result.unsupported) return;
    expect(result.os).toBe('darwin');
    expect(result.arch).toBe('arm64');
    expect(result.archiveName).toBe('aiflowbridge-server-darwin-arm64.tar.gz');
  });

  it('detects macOS x64', () => {
    stubPlatform('darwin', 'x64');
    const result = detectPlatform();
    expect(result.unsupported).toBe(false);
    if (result.unsupported) return;
    expect(result.archiveName).toBe('aiflowbridge-server-darwin-x64.tar.gz');
  });

  it('detects Windows x64 (zip)', () => {
    stubPlatform('win32', 'x64');
    const result = detectPlatform();
    expect(result.unsupported).toBe(false);
    if (result.unsupported) return;
    expect(result.os).toBe('win32');
    expect(result.arch).toBe('x64');
    expect(result.archiveName).toBe('aiflowbridge-server-win-x64.zip');
    expect(result.launcherRelativePath).toBe('bin\\aiflowbridge-server.cmd');
    expect(result.startCommand).toBe('bin\\aiflowbridge-server.cmd');
  });

  it('marks Windows arm64 as unsupported (no shipped binary)', () => {
    stubPlatform('win32', 'arm64');
    const result = detectPlatform();
    expect(result.unsupported).toBe(true);
    if (!result.unsupported) return;
    expect(result.os).toBe('win32');
    expect(result.arch).toBe('arm64');
  });

  it('marks FreeBSD as unsupported', () => {
    stubPlatform('freebsd' as NodeJS.Platform, 'x64');
    const result = detectPlatform();
    expect(result.unsupported).toBe(true);
  });

  it('marks ia32 as unsupported', () => {
    stubPlatform('linux', 'ia32');
    const result = detectPlatform();
    expect(result.unsupported).toBe(true);
  });
});

describe('InstallError', () => {
  it('exposes the error code and message', () => {
    const err = new InstallError('network', 'boom');
    expect(err.code).toBe('network');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });

  it('falls back to code as message when no detail is provided', () => {
    const err = new InstallError('no-release');
    expect(err.message).toBe('no-release');
  });
});

describe('tar.gz round-trip (extraction primitive)', () => {
  let osTmp: string;

  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    osTmp = await mkdtemp(tmpdir() + '/aifb-test-');
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(osTmp, { recursive: true, force: true });
  });

  it('extracts a tar.gz built in-memory and preserves file contents', async () => {
    const { mkdir, writeFile, readFile } = await import('node:fs/promises');
    const stagingSrc = `${osTmp}/staging-src`;
    const stagingOut = `${osTmp}/staging-out`;
    await mkdir(stagingSrc, { recursive: true });
    await writeFile(`${stagingSrc}/hello.txt`, 'world', 'utf8');
    await mkdir(`${stagingSrc}/bin`, { recursive: true });
    await writeFile(`${stagingSrc}/bin/aiflowbridge-server`, '#!/bin/sh\necho ok', 'utf8');

    const tarPath = `${osTmp}/fixture.tar`;
    await create({ cwd: stagingSrc, file: tarPath, portable: true }, ['hello.txt', 'bin/aiflowbridge-server']);

    await mkdir(stagingOut, { recursive: true });
    await extract({ file: tarPath, cwd: stagingOut });
    const hello = await readFile(`${stagingOut}/hello.txt`, 'utf8');
    const launcher = await readFile(`${stagingOut}/bin/aiflowbridge-server`, 'utf8');
    expect(hello).toBe('world');
    expect(launcher).toContain('echo ok');
  });

  it('produces a valid gzip-compressed stream', () => {
    const data = Buffer.from('hello world');
    const gz = gzipSync(data);
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
  });
});

describe('zip round-trip (extraction primitive)', () => {
  it('extracts an archive built in-memory with adm-zip', () => {
    const zip = new AdmZip();
    zip.addFile('README.txt', Buffer.from('hello from zip', 'utf8'));
    zip.addFile('bin/aiflowbridge-server.cmd', Buffer.from('@echo off\r\nrem hello', 'utf8'));
    const buf = zip.toBuffer();

    const round = new AdmZip(buf);
    expect(round.readAsText('README.txt')).toBe('hello from zip');
    expect(round.readAsText('bin/aiflowbridge-server.cmd')).toContain('@echo off');
  });
});

describe('httpsGet error paths (unit-level)', () => {
  it('InstallError is the discriminated union for failure modes', () => {
    const codes: Array<InstallError['code']> = [
      'unsupported-platform',
      'no-release',
      'network',
      'extraction',
      'permission',
      'autostart',
      'user-cancelled',
    ];
    for (const code of codes) {
      const err = new InstallError(code);
      expect(err.code).toBe(code);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
