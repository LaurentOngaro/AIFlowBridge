/**
 * AIFlowBridge - Antigravity token persistence.
 *
 * Safely persists and loads OAuth tokens in secrets.json using standard
 * permissions (chmod 600 where supported). Compatible with both the standalone
 * CLI (~/.aiflowbridge/secrets.json) and extension storage directories.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ANTIGRAVITY_SECRET_KEY } from './constants';
import type { AntigravityTokens } from './types';

export class AntigravityTokenStore {
  private readonly secretsFilePath: string;

  constructor(storageDirOrFilePath: string) {
    if (storageDirOrFilePath.endsWith('.json')) {
      this.secretsFilePath = storageDirOrFilePath;
    } else {
      this.secretsFilePath = join(storageDirOrFilePath, 'secrets.json');
    }
  }

  get filePath(): string {
    return this.secretsFilePath;
  }

  load(): AntigravityTokens | undefined {
    if (!existsSync(this.secretsFilePath)) {
      return undefined;
    }

    try {
      const raw = readFileSync(this.secretsFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }

      const tokenEntry = parsed[ANTIGRAVITY_SECRET_KEY] || parsed['googleaistudio'];
      if (!tokenEntry) {
        return undefined;
      }

      const data = typeof tokenEntry === 'string' ? JSON.parse(tokenEntry) : tokenEntry;
      if (
        data &&
        typeof data.accessToken === 'string' &&
        typeof data.refreshToken === 'string' &&
        typeof data.expiresAt === 'number'
      ) {
        return {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
          projectId: typeof data.projectId === 'string' ? data.projectId : undefined,
          email: typeof data.email === 'string' ? data.email : undefined,
          scopes: Array.isArray(data.scopes) ? data.scopes : undefined,
        };
      }
    } catch {
      // Ignored: corrupt or invalid file returns undefined
    }

    return undefined;
  }

  save(tokens: AntigravityTokens): void {
    let secrets: Record<string, unknown> = {};
    if (existsSync(this.secretsFilePath)) {
      try {
        const raw = readFileSync(this.secretsFilePath, 'utf8');
        secrets = JSON.parse(raw);
        if (!secrets || typeof secrets !== 'object') {
          secrets = {};
        }
      } catch {
        secrets = {};
      }
    }

    const serialized = JSON.stringify(tokens);
    // `ANTIGRAVITY_SECRET_KEY` is the canonical slot for OAuth tokens.
    // We previously also wrote the same serialized JSON under the
    // `googleaistudio` key as a "convention" alias, but that collided
    // with the BYOK API-key storage (audit BUG-11: the secret-store
    // resolver expects a plain string API key under
    // `aiflowbridge.providers.googleaistudio.apiKey`, not a JSON blob).
    // Backwards compat: clean up the stale `googleaistudio` JSON slot
    // when present so older on-disk secrets stop polluting lookups.
    if (typeof secrets['googleaistudio'] === 'string' && secrets['googleaistudio'].trimStart().startsWith('{')) {
      delete secrets['googleaistudio'];
    }
    secrets[ANTIGRAVITY_SECRET_KEY] = serialized;

    mkdirSync(dirname(this.secretsFilePath), { recursive: true });
    writeFileSync(this.secretsFilePath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    try {
      chmodSync(this.secretsFilePath, 0o600);
    } catch {
      // ignore on Windows
    }
  }

  clear(): void {
    if (!existsSync(this.secretsFilePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.secretsFilePath, 'utf8');
      const secrets = JSON.parse(raw);
      if (secrets && typeof secrets === 'object') {
        delete secrets[ANTIGRAVITY_SECRET_KEY];
        delete secrets['googleaistudio'];
        writeFileSync(this.secretsFilePath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
      }
    } catch {
      // best effort
    }
  }
}
