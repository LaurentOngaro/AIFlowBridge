import { spawn } from 'node:child_process';
import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import * as https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { extract } from 'tar';
import AdmZip from 'adm-zip';
import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';

const REPO_OWNER = 'LaurentOngaro';
const REPO_NAME = 'aiflowbridge';
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 60_000;

type SupportedOs = 'win32' | 'darwin' | 'linux';
type SupportedArch = 'x64' | 'arm64';

interface PlatformAsset {
  readonly os: SupportedOs;
  readonly arch: SupportedArch;
  readonly archiveName: string;
  readonly installDirDefault: string;
  readonly launcherRelativePath: string;
  readonly startCommand: string;
}

interface DetectedPlatform extends PlatformAsset {
  readonly unsupported: false;
}

interface UnsupportedPlatform {
  readonly unsupported: true;
  readonly os: string;
  readonly arch: string;
}

interface GithubAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly size: number;
}

interface GithubRelease {
  readonly tag_name: string;
  readonly assets: ReadonlyArray<GithubAsset>;
}

interface InstallOutcome {
  readonly installDir: string;
  readonly launcherPath: string;
  readonly startCommand: string;
  readonly version: string;
}

/**
 * Detect the current runtime platform and map it to the asset naming scheme
 * used in the GitHub Release archive names. Returns an unsupported marker
 * for platforms we do not ship binaries for (e.g. FreeBSD, win32-arm64).
 */
export function detectPlatform(): DetectedPlatform | UnsupportedPlatform {
  const os = process.platform;
  const arch = process.arch;

  if (os !== 'win32' && os !== 'darwin' && os !== 'linux') {
    return { unsupported: true, os, arch };
  }
  if (arch !== 'x64' && arch !== 'arm64') {
    return { unsupported: true, os, arch };
  }
  if (os === 'win32' && arch === 'arm64') {
    return { unsupported: true, os, arch };
  }

  const archiveExt = os === 'win32' ? 'zip' : 'tar.gz';
  const archToken = arch === 'arm64' ? 'arm64' : 'x64';
  const osToken = os === 'win32' ? 'win' : os === 'darwin' ? 'darwin' : 'linux';
  const archiveName = `aiflowbridge-server-${osToken}-${archToken}.${archiveExt}`;
  const launcherRelativePath = os === 'win32' ? 'bin\\aiflowbridge-server.cmd' : 'bin/aiflowbridge-server';
  const startCommand = os === 'win32' ? 'bin\\aiflowbridge-server.cmd' : 'bin/aiflowbridge-server';

  return {
    unsupported: false,
    os,
    arch,
    archiveName,
    installDirDefault: defaultInstallDir(os),
    launcherRelativePath,
    startCommand,
  };
}

function defaultInstallDir(os: SupportedOs): string {
  const home = homedir();
  if (os === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return join(localAppData, 'aiflowbridge');
  }
  if (os === 'darwin') {
    return process.env.HOME ? join(process.env.HOME, 'Applications', 'AIFlowBridge') : join(home, 'Applications', 'AIFlowBridge');
  }
  return join(home, '.local', 'share', 'aiflowbridge');
}

function httpsGet(
  url: string,
  headers: Record<string, string> = {},
  maxRedirects = 5,
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: NodeJS.ReadableStream }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout: HTTP_TIMEOUT_MS, headers: { 'User-Agent': 'AIFlowBridge-VSCode-Extension/2.3.0', ...headers } },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && maxRedirects > 0) {
          res.resume();
          let nextUrl: string;
          try {
            nextUrl = new URL(res.headers.location, url).toString();
          } catch (err) {
            reject(new Error(`Invalid redirect target ${res.headers.location} from ${url}: ${(err as Error).message}`));
            return;
          }
          resolve(httpsGet(nextUrl, headers, maxRedirects - 1));
          return;
        }
        resolve({ statusCode: code, headers: res.headers, body: res });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${url} timed out after ${HTTP_TIMEOUT_MS} ms`));
    });
    req.on('error', reject);
  });
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const { statusCode, body, headers } = await httpsGet(GITHUB_API, { Accept: 'application/vnd.github+json' });
  if (statusCode === 404) {
    throw new InstallError('no-release');
  }
  if (statusCode === 403) {
    const remaining = Number(headers['x-ratelimit-remaining']);
    if (remaining === 0) {
      throw new InstallError('network', 'rate-limited');
    }
    throw new InstallError('network', `GitHub API returned HTTP 403 (User-Agent header missing or forbidden)`);
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new InstallError('network', `GitHub API returned HTTP ${statusCode}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  let parsed: GithubRelease;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as GithubRelease;
  } catch (err) {
    throw new InstallError('network', `Invalid JSON in GitHub response: ${(err as Error).message}`);
  }
  if (!parsed.tag_name || !Array.isArray(parsed.assets)) {
    throw new InstallError('no-release');
  }
  return parsed;
}

async function downloadAsset(asset: GithubAsset, destPath: string, onProgress: (bytes: number, total: number) => void): Promise<void> {
  if (asset.size > MAX_ASSET_BYTES) {
    throw new InstallError('network', `Asset ${asset.name} declares ${asset.size} bytes (cap: ${MAX_ASSET_BYTES})`);
  }
  const { statusCode, headers, body } = await httpsGet(asset.browser_download_url);
  if (statusCode < 200 || statusCode >= 300) {
    throw new InstallError('network', `Asset download returned HTTP ${statusCode}`);
  }
  const totalHeader = Number(headers['content-length']);
  if (Number.isFinite(totalHeader) && totalHeader > MAX_ASSET_BYTES) {
    throw new InstallError('network', `Asset ${asset.name} content-length ${totalHeader} exceeds cap ${MAX_ASSET_BYTES}`);
  }
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : asset.size;
  await mkdir(join(destPath, '..'), { recursive: true });

  let received = 0;
  body.on('data', (chunk: Buffer | string) => {
    received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    onProgress(received, total);
  });

  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    const buf = Buffer.from(chunk as Uint8Array);
    chunks.push(buf);
  }
  await writeFile(destPath, Buffer.concat(chunks));
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await extract({
    file: archivePath,
    cwd: destDir,
    gzip: true,
  });
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(destDir, true);
}

async function chmodExecutable(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  await chmod(path, 0o755);
}

async function detectExistingInstall(installDir: string): Promise<{ launcherPath: string | null }> {
  let dirStat;
  try {
    dirStat = await stat(installDir);
  } catch {
    return { launcherPath: null };
  }
  if (!dirStat.isDirectory()) return { launcherPath: null };
  let entries: string[];
  try {
    entries = await readdir(installDir);
  } catch {
    return { launcherPath: null };
  }
  if (!entries.includes('bin')) return { launcherPath: null };
  const launcherPath = join(installDir, process.platform === 'win32' ? 'bin\\aiflowbridge-server.cmd' : 'bin/aiflowbridge-server');
  try {
    const st = await stat(launcherPath);
    return st.isFile() ? { launcherPath } : { launcherPath: null };
  } catch {
    return { launcherPath: null };
  }
}

async function askReplaceOrKeep(installDir: string): Promise<'replace' | 'keep' | 'cancel'> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: t('installStandalone.replace'), value: 'replace' as const },
      { label: t('installStandalone.keep'), value: 'keep' as const },
      { label: t('installStandalone.cancel'), value: 'cancel' as const },
    ],
    { title: t('installStandalone.replacePrompt', 'unknown', installDir), placeHolder: installDir },
  );
  return pick?.value ?? 'cancel';
}

async function pickInstallDir(defaultDir: string): Promise<string | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(defaultDir),
    openLabel: t('installStandalone.pickInstallDir'),
  });
  if (picked && picked.length > 0) {
    return picked[0].fsPath;
  }
  return null;
}

async function askAutostart(): Promise<boolean> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: t('installStandalone.autostartYes'), value: 'yes' as const },
      { label: t('installStandalone.autostartNo'), value: 'no' as const },
    ],
    { title: t('installStandalone.autostartPrompt') },
  );
  return choice?.value === 'yes';
}

async function installLinuxSystemd(installDir: string): Promise<void> {
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  await mkdir(unitDir, { recursive: true });
  const unitPath = join(unitDir, 'aiflowbridge.service');
  const execPath = join(installDir, 'bin', 'aiflowbridge-server');
  await writeFile(
    unitPath,
    [
      '[Unit]',
      'Description=AIFlowBridge standalone gateway',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      `ExecStart=${execPath}`,
      'Restart=on-failure',
      'RestartSec=5',
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n'),
  );
  await runProcess('systemctl', ['--user', 'daemon-reload']);
  await runProcess('systemctl', ['--user', 'enable', 'aiflowbridge.service']);
}

async function installMacosLaunchd(installDir: string): Promise<void> {
  const agentsDir = join(homedir(), 'Library', 'LaunchAgents');
  await mkdir(agentsDir, { recursive: true });
  const plistPath = join(agentsDir, 'com.aiflowbridge.server.plist');
  const execPath = join(installDir, 'bin', 'aiflowbridge-server');
  await writeFile(
    plistPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '  <dict>',
      '    <key>Label</key>',
      '    <string>com.aiflowbridge.server</string>',
      '    <key>ProgramArguments</key>',
      '    <array>',
      `      <string>${execPath}</string>`,
      '    </array>',
      '    <key>RunAtLoad</key>',
      '    <true/>',
      '    <key>KeepAlive</key>',
      '    <true/>',
      '  </dict>',
      '</plist>',
      '',
    ].join('\n'),
  );
  await runProcess('launchctl', ['load', '-w', plistPath]);
}

async function installWindowsTask(installDir: string): Promise<void> {
  const exePath = join(installDir, 'bin', 'aiflowbridge-server.cmd');
  const psScript = [
    `$action = New-ScheduledTaskAction -Execute "${exePath}"`,
    '$trigger = New-ScheduledTaskTrigger -AtLogOn',
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)',
    'Register-ScheduledTask -TaskName "AIFlowBridge Standalone" -Action $action -Trigger $trigger -Settings $settings -Description "AIFlowBridge standalone gateway" -Force',
  ].join('; ');
  await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true });
}

function runProcess(command: string, args: ReadonlyArray<string>, extra?: { windowsHide?: boolean }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'ignore', windowsHide: extra?.windowsHide ?? false });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))));
  });
}

export class InstallError extends Error {
  constructor(
    public readonly code: 'unsupported-platform' | 'no-release' | 'network' | 'extraction' | 'permission' | 'autostart' | 'user-cancelled',
    public readonly detail?: string,
  ) {
    super(detail ?? code);
  }
}

async function maybeInstallAutostart(installDir: string, platform: DetectedPlatform): Promise<boolean> {
  const accepted = await askAutostart();
  if (!accepted) return false;
  try {
    if (platform.os === 'linux') {
      await installLinuxSystemd(installDir);
    } else if (platform.os === 'darwin') {
      await installMacosLaunchd(installDir);
    } else if (platform.os === 'win32') {
      await installWindowsTask(installDir);
    }
    return true;
  } catch (err) {
    throw new InstallError('autostart', (err as Error).message);
  }
}

async function makeStagingDir(tag: string): Promise<string> {
  const safe = tag.replace(/[^a-zA-Z0-9._-]/g, '_');
  const stagingDir = join(tmpdir(), `aiflowbridge-install-${safe}-${Date.now().toString(36)}`);
  await mkdir(stagingDir, { recursive: true });
  return stagingDir;
}

/**
 * Main entry point for `aiflowbridge.installStandalone`. Wires the VS Code
 * UI surfaces (progress bar, quick picks, open dialog, information/error
 * messages) to the lower-level fetch / extract / chmod / autostart
 * primitives. All errors surface as user-visible notifications and are
 * logged to the AIFlowBridge Output channel.
 */
export async function installStandaloneCommand(_context: vscode.ExtensionContext): Promise<void> {
  const platform = detectPlatform();
  if (platform.unsupported) {
    void vscode.window.showWarningMessage(t('installStandalone.unsupportedPlatform', `${platform.os}/${platform.arch}`));
    return;
  }

  let installDir = platform.installDirDefault;
  const existing = await detectExistingInstall(installDir);
  if (existing.launcherPath) {
    const decision = await askReplaceOrKeep(installDir);
    if (decision === 'cancel') return;
    if (decision === 'keep') {
      const suffix = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      installDir = `${installDir}-${suffix}`;
    }
  } else {
    const picked = await pickInstallDir(installDir);
    if (!picked) return;
    installDir = picked;
  }

  const assetLabel = `${platform.os}/${platform.arch}`;
  let outcome: InstallOutcome | undefined;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('installStandalone.progressDownload', '...', assetLabel), cancellable: false },
      async () => {
        const release = await fetchLatestRelease();
        const asset = release.assets.find((a) => a.name === platform.archiveName);
        if (!asset) {
          throw new InstallError('no-release', `Release ${release.tag_name} does not ship an asset named ${platform.archiveName}`);
        }
        const stagingDir = await makeStagingDir(release.tag_name);
        const archivePath = join(stagingDir, platform.archiveName);
        try {
          await downloadAsset(asset, archivePath, () => {
            // Progress is reported by the outer withProgress title; individual byte
            // progress is not surfaced to keep the notification steady.
          });
          await rm(installDir, { recursive: true, force: true });
          await mkdir(installDir, { recursive: true });
          if (platform.archiveName.endsWith('.tar.gz')) {
            await extractTarGz(archivePath, installDir);
          } else {
            await extractZip(archivePath, installDir);
          }
        } finally {
          await rm(stagingDir, { recursive: true, force: true });
        }
        const launcherPath = join(installDir, platform.launcherRelativePath);
        await chmodExecutable(launcherPath);
        return { installDir, launcherPath, startCommand: platform.startCommand, version: release.tag_name };
      },
    );
  } catch (err) {
    handleInstallError(err);
    return;
  }
  if (!outcome) return;

  let autostartRegistered = false;
  try {
    autostartRegistered = await maybeInstallAutostart(installDir, platform);
  } catch (err) {
    logger.warn('[AIFlowBridge] Autostart registration failed', err);
    void vscode.window.showWarningMessage(t('installStandalone.autostartFailed', (err as Error).message, installDir));
  }

  const finalMessage = autostartRegistered
    ? t('installStandalone.successWithService', outcome.version, installDir, outcome.startCommand)
    : t('installStandalone.successManual', outcome.version, installDir, outcome.startCommand);
  void vscode.window.showInformationMessage(finalMessage, 'Open folder').then((action) => {
    if (action === 'Open folder') {
      void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outcome!.installDir));
    }
  });
}

function handleInstallError(err: unknown): void {
  const code = err instanceof InstallError ? err.code : 'network';
  const detail = err instanceof Error ? err.message : String(err);
  if (code === 'no-release') {
    void vscode.window.showErrorMessage(t('installStandalone.noRelease'));
  } else if (code === 'unsupported-platform') {
    void vscode.window.showWarningMessage(t('installStandalone.unsupportedPlatform', detail));
  } else if (detail === 'rate-limited') {
    void vscode.window.showErrorMessage(t('installStandalone.rateLimited'));
  } else {
    logger.error('[AIFlowBridge] Install standalone failed', err);
    void vscode.window.showErrorMessage(t('installStandalone.failure', detail));
  }
}