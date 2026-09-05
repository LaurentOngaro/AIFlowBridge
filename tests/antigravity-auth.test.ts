import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AntigravityTokenManager } from '../src/aiflowbridge/antigravity/auth';
import { AntigravityTokenStore } from '../src/aiflowbridge/antigravity/token-store';
import type { AntigravityTokens } from '../src/aiflowbridge/antigravity/types';

describe('AntigravityTokenStore', () => {
  let tempDir: string;
  let store: AntigravityTokenStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aifb-test-store-'));
    store = new AntigravityTokenStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists, loads, and clears tokens', () => {
    expect(store.load()).toBeUndefined();

    const sampleTokens: AntigravityTokens = {
      accessToken: 'ya29.access-token-123',
      refreshToken: '1//refresh-token-456',
      expiresAt: Date.now() + 3600_000,
      projectId: 'test-project-id',
      email: 'dev@example.com',
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    };

    store.save(sampleTokens);
    const loaded = store.load();
    expect(loaded).toEqual(sampleTokens);

    store.clear();
    expect(store.load()).toBeUndefined();
  });
});

describe('AntigravityTokenManager', () => {
  let tempDir: string;
  let store: AntigravityTokenStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aifb-test-manager-'));
    store = new AntigravityTokenStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns valid cached access token without network call', async () => {
    const validTokens: AntigravityTokens = {
      accessToken: 'ya29.current-valid-token',
      refreshToken: '1//refresh-token',
      expiresAt: Date.now() + 300_000, // 5 min in future
    };
    store.save(validTokens);

    const mockFetch = vi.fn();
    const manager = new AntigravityTokenManager(store, { fetchFn: mockFetch as unknown as typeof fetch });

    const token = await manager.getAccessToken();
    expect(token).toBe('ya29.current-valid-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refreshes token when expired or expiring within safety window', async () => {
    const expiringTokens: AntigravityTokens = {
      accessToken: 'ya29.old-token',
      refreshToken: '1//refresh-token',
      expiresAt: Date.now() + 10_000, // expiring in 10s (< 60s safety margin)
    };
    store.save(expiringTokens);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'ya29.newly-refreshed-token',
        expires_in: 3600,
      }),
    });

    const manager = new AntigravityTokenManager(store, { fetchFn: mockFetch as unknown as typeof fetch });
    const token = await manager.getAccessToken();

    expect(token).toBe('ya29.newly-refreshed-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const reloaded = store.load();
    expect(reloaded?.accessToken).toBe('ya29.newly-refreshed-token');
    expect(reloaded?.expiresAt).toBeGreaterThan(Date.now() + 3000_000);
  });

  it('builds standard authorization URL with PKCE parameters', () => {
    const manager = new AntigravityTokenManager(store);
    const url = manager.buildAuthorizationUrl('http://127.0.0.1:51121/oauth/callback', {
      verifier: 'sample_verifier',
      challenge: 'sample_challenge',
    }, 'sample_state');

    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('code_challenge=sample_challenge');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('state=sample_state');
    expect(url).toContain('access_type=offline');
  });
});
