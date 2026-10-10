/**
 * Local cleanup of the retired Google product OAuth secrets.
 *
 * The purge must be local, selective, idempotent and permission
 * preserving. Remote revocation is explicitly NOT what it does: no token
 * leaves the machine.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasRetiredGoogleOAuthSecrets,
  purgeRetiredGoogleOAuthSecrets,
  retiredGoogleSecretsPath,
} from '../src/aiflowbridge/retired-google-oauth-secrets';

const API_KEY_SECRET = 'aiflowbridge.providers.googleaistudio.apiKey';

let dir: string;
let secretsPath: string;

function writeSecrets(value: Record<string, unknown>): void {
  writeFileSync(secretsPath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function readSecrets(): Record<string, unknown> {
  return JSON.parse(readFileSync(secretsPath, 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aifb-purge-'));
  secretsPath = join(dir, 'secrets.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('purgeRetiredGoogleOAuthSecrets', () => {
  it('reports nothing to do when the store does not exist', () => {
    const result = purgeRetiredGoogleOAuthSecrets(dir);
    expect(result).toEqual({ changed: false, filePath: secretsPath, fileExisted: false });
    expect(existsSync(secretsPath)).toBe(false);
  });

  it('removes the legacy antigravity slot and keeps every other key', () => {
    writeSecrets({
      antigravity: JSON.stringify({ accessToken: 'ya29.aaa', refreshToken: '1//bbb', expiresAt: 1, email: 'user@example.com' }),
      [API_KEY_SECRET]: 'AIzaSyByokKey',
      'aiflowbridge.providers.deepseek.apiKey': 'sk-deepseek',
    });

    const result = purgeRetiredGoogleOAuthSecrets(dir);

    expect(result.changed).toBe(true);
    const after = readSecrets();
    expect(after.antigravity).toBeUndefined();
    expect(after[API_KEY_SECRET]).toBe('AIzaSyByokKey');
    expect(after['aiflowbridge.providers.deepseek.apiKey']).toBe('sk-deepseek');
  });

  it('is idempotent: a second call changes nothing and still succeeds', () => {
    writeSecrets({ antigravity: JSON.stringify({ refreshToken: '1//bbb' }), [API_KEY_SECRET]: 'AIzaSyByokKey' });

    expect(purgeRetiredGoogleOAuthSecrets(dir).changed).toBe(true);
    const second = purgeRetiredGoogleOAuthSecrets(dir);
    expect(second.changed).toBe(false);
    expect(second.fileExisted).toBe(true);
    // The BYOK key survived both calls.
    expect(readSecrets()[API_KEY_SECRET]).toBe('AIzaSyByokKey');
  });

  it('keeps a googleaistudio slot holding a plain BYOK API key', () => {
    // The pre-2.17 alias slot used to hold the same JSON blob as
    // `antigravity`. It can also legitimately hold the API-key string,
    // which belongs to the SUPPORTED route and must survive.
    writeSecrets({ googleaistudio: 'AIzaSyByokKey' });

    const result = purgeRetiredGoogleOAuthSecrets(dir);

    expect(result.changed).toBe(false);
    expect(readSecrets().googleaistudio).toBe('AIzaSyByokKey');
  });

  it('removes a googleaistudio slot that holds a legacy OAuth blob', () => {
    writeSecrets({ googleaistudio: JSON.stringify({ accessToken: 'ya29.aaa', refreshToken: '1//bbb', expiresAt: 1 }) });

    const result = purgeRetiredGoogleOAuthSecrets(dir);

    expect(result.changed).toBe(true);
    expect(readSecrets().googleaistudio).toBeUndefined();
  });

  it('preserves the store file mode', () => {
    mkdirSync(dir, { recursive: true });
    writeSecrets({ antigravity: JSON.stringify({ refreshToken: '1//bbb' }) });
    chmodSync(secretsPath, 0o600);

    purgeRetiredGoogleOAuthSecrets(dir);

    expect(statSync(secretsPath).mode & 0o777).toBe(0o600);
  });

  it('leaves a corrupt store alone instead of rewriting it', () => {
    writeFileSync(secretsPath, '{not json', 'utf8');
    const before = readFileSync(secretsPath, 'utf8');

    const result = purgeRetiredGoogleOAuthSecrets(dir);

    expect(result.changed).toBe(false);
    expect(readFileSync(secretsPath, 'utf8')).toBe(before);
  });

  it('accepts an explicit secrets.json path as well as a directory', () => {
    writeSecrets({ antigravity: JSON.stringify({ refreshToken: '1//bbb' }) });

    const result = purgeRetiredGoogleOAuthSecrets(secretsPath);

    expect(result.changed).toBe(true);
    expect(result.filePath).toBe(secretsPath);
    expect(readSecrets().antigravity).toBeUndefined();
  });
});

describe('hasRetiredGoogleOAuthSecrets', () => {
  it('is false for a missing store and for a store with no legacy slot', () => {
    expect(hasRetiredGoogleOAuthSecrets(dir)).toBe(false);
    writeSecrets({ [API_KEY_SECRET]: 'AIzaSyByokKey' });
    expect(hasRetiredGoogleOAuthSecrets(dir)).toBe(false);
  });

  it('is true when a legacy slot is present, whatever the BYOK key state', () => {
    writeSecrets({ antigravity: JSON.stringify({ refreshToken: '1//bbb' }), [API_KEY_SECRET]: 'AIzaSyByokKey' });
    expect(hasRetiredGoogleOAuthSecrets(dir)).toBe(true);
  });
});

describe('retiredGoogleSecretsPath', () => {
  it('resolves the file path from a directory or from an explicit file', () => {
    expect(retiredGoogleSecretsPath('/tmp/x')).toBe(join('/tmp/x', 'secrets.json'));
    expect(retiredGoogleSecretsPath('/tmp/x/secrets.json')).toBe('/tmp/x/secrets.json');
  });
});