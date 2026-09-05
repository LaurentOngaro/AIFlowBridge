/**
 * AIFlowBridge - Antigravity / Google AI Studio OAuth authentication manager.
 *
 * Implements Authorization Code + PKCE flow, automated local callback server,
 * manual redirect URL paste fallback (for SSH/WSL), automatic token refresh,
 * and user profile / project resolution.
 */

import { createServer, type Server } from 'node:http';
import {
    CLOUDCODE_SCOPES,
    DEFAULT_CALLBACK_PORT,
    DEFAULT_CLIENT_ID,
    DEFAULT_CLIENT_SECRET,
    GOOGLE_OAUTH_AUTH_URL,
    GOOGLE_OAUTH_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    TOKEN_EXPIRATION_SAFETY_MARGIN_MS,
} from './constants';
import { generateOAuthState, generatePkce } from './pkce';
import { fetchCodeAssistProject } from './project';
import { AntigravityTokenStore } from './token-store';
import type { AntigravityTokens, PkcePair } from './types';

export interface TokenManagerOptions {
  clientId?: string;
  clientSecret?: string;
  fetchFn?: typeof fetch;
}

export class AntigravityTokenManager {
  private readonly store: AntigravityTokenStore;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchFn: typeof fetch;
  private inMemoryTokens?: AntigravityTokens;
  private refreshPromise?: Promise<string>;

  constructor(
    storageDirOrStore: string | AntigravityTokenStore,
    options?: TokenManagerOptions
  ) {
    if (typeof storageDirOrStore === 'string') {
      this.store = new AntigravityTokenStore(storageDirOrStore);
    } else {
      this.store = storageDirOrStore;
    }
    this.clientId = options?.clientId || DEFAULT_CLIENT_ID;
    this.clientSecret = options?.clientSecret || DEFAULT_CLIENT_SECRET;
    this.fetchFn = options?.fetchFn || fetch;
  }

  getTokens(): AntigravityTokens | undefined {
    if (!this.inMemoryTokens) {
      this.inMemoryTokens = this.store.load();
    }
    return this.inMemoryTokens;
  }

  async getAccessToken(): Promise<string> {
    const current = this.getTokens();
    if (!current || !current.refreshToken) {
      throw new Error(
        'No Google AI Studio / Antigravity credentials found. Run "aiflowbridge-server auth googleaistudio" to log in.'
      );
    }

    const now = Date.now();
    if (current.accessToken && current.expiresAt > now + TOKEN_EXPIRATION_SAFETY_MARGIN_MS) {
      return current.accessToken;
    }

    return this.refreshAccessToken();
  }

  async refreshAccessToken(force = false): Promise<string> {
    if (this.refreshPromise && !force) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const current = this.getTokens();
      if (!current?.refreshToken) {
        throw new Error('Cannot refresh token: no refresh_token stored.');
      }

      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: current.refreshToken,
        grant_type: 'refresh_token',
      });

      const response = await this.fetchFn(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to refresh Google OAuth token (${response.status}): ${sanitizeOAuthErrorText(errText)}`);
      }

      const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      const newAccessToken = data.access_token;
      if (!newAccessToken) {
        throw new Error('OAuth refresh response did not include an access token.');
      }
      const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      const expiresAt = Date.now() + expiresInSec * 1000;

      const updated: AntigravityTokens = {
        ...current,
        accessToken: newAccessToken,
        expiresAt,
        ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      };

      this.inMemoryTokens = updated;
      this.store.save(updated);
      return newAccessToken;
    })().finally(() => {
      this.refreshPromise = undefined;
    });

    return this.refreshPromise;
  }

  buildAuthorizationUrl(redirectUri: string, pkce: PkcePair, state: string): string {
    const url = new URL(GOOGLE_OAUTH_AUTH_URL);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', CLOUDCODE_SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  async exchangeAuthCode(code: string, verifier: string, redirectUri: string): Promise<AntigravityTokens> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenRes = await this.fetchFn(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Failed to exchange authorization code (${tokenRes.status}): ${sanitizeOAuthErrorText(errText)}`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    if (!accessToken) {
      throw new Error('OAuth token response did not include an access token.');
    }
    const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    let email: string | undefined;
    try {
      const userinfoRes = await this.fetchFn(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userinfoRes.ok) {
        const userInfo = (await userinfoRes.json()) as { email?: string };
        email = typeof userInfo.email === 'string' ? userInfo.email : undefined;
      }
    } catch {
      // non-fatal
    }

    let projectId: string | undefined;
    try {
      const projectResult = await fetchCodeAssistProject(accessToken, this.fetchFn);
      projectId = projectResult.cloudaicompanionProject;
    } catch {
      // non-fatal
    }

    const tokens: AntigravityTokens = {
      accessToken,
      refreshToken: refreshToken || this.getTokens()?.refreshToken || '',
      expiresAt,
      projectId,
      email,
      scopes: [...CLOUDCODE_SCOPES],
    };

    this.inMemoryTokens = tokens;
    this.store.save(tokens);
    return tokens;
  }

  async startLocalOAuthFlow(options?: {
    port?: number;
    onUrlReady?: (url: string) => void;
    timeoutMs?: number;
  }): Promise<AntigravityTokens> {
    const port = options?.port || DEFAULT_CALLBACK_PORT;
    const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000;
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const pkce = generatePkce();
    const state = generateOAuthState();
    const authUrl = this.buildAuthorizationUrl(redirectUri, pkce, state);

    return new Promise<AntigravityTokens>((resolve, reject) => {
      let server: Server;
      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(`OAuth flow timed out after ${Math.round(timeoutMs / 1000)}s without a callback. Re-run the login command to try again.`));
      }, timeoutMs);
      const settleResolve = (tokens: AntigravityTokens): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(tokens);
      };
      const settleReject = (err: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        reject(err);
      };
      const cleanup = () => {
        try {
          server.close();
        } catch {
          // ignore
        }
      };

      server = createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
          if (reqUrl.pathname !== '/oauth/callback') {
            res.writeHead(404);
            res.end('Not found');
            return;
          }

          const code = reqUrl.searchParams.get('code');
          const returnedState = reqUrl.searchParams.get('state');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h3>Authentication Failed</h3><p>The authorization server returned an error. You can close this window.</p>');
            cleanup();
            settleReject(new Error(`OAuth error: ${sanitizeOAuthErrorText(error)}`));
            return;
          }

          if (!code || returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h3>Authentication Error</h3><p>Missing code or invalid state token.</p>');
            cleanup();
            settleReject(new Error('Invalid OAuth callback state or missing authorization code.'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<html><body style="font-family:sans-serif;text-align:center;padding:50px;">' +
              '<h2 style="color:#22c55e;">AIFlowBridge Connected!</h2>' +
              '<p>Google AI Studio / Antigravity authentication was successful. You can close this window.</p>' +
              '</body></html>'
          );

          cleanup();
          const tokens = await this.exchangeAuthCode(code, pkce.verifier, redirectUri);
          settleResolve(tokens);
        } catch (err) {
          cleanup();
          settleReject(err);
        }
      });

      server.listen(port, '127.0.0.1', () => {
        if (options?.onUrlReady) {
          options.onUrlReady(authUrl);
        }
      });

      server.on('error', (err) => {
        cleanup();
        settleReject(err);
      });
    });
  }

  logout(): void {
    this.inMemoryTokens = undefined;
    this.store.clear();
  }
}

/**
 * Redacts credential-looking material from OAuth error text before it
 * reaches thrown errors (and therefore logs). Mirrors the gateway
 * `sanitizeUpstreamErrorMessage` policy without importing the gateway
 * module (this file must stay importable from the standalone CLI).
 */
export function sanitizeOAuthErrorText(raw: string): string {
  let message = raw.length > 2000 ? `${raw.slice(0, 2000)}...[truncated]` : raw;
  message = message.replace(/ya29\.[A-Za-z0-9_-]+/g, 'ya29.[REDACTED]');
  message = message.replace(/1\/\/[A-Za-z0-9_-]+/g, '1//[REDACTED]');
  message = message.replace(/(refresh_token|access_token|code|client_secret)[=:] ?[^&\s"']+/gi, '$1=[REDACTED]');
  message = message.replace(/Bearer [A-Za-z0-9._~-]{12,}/g, 'Bearer [REDACTED]');
  return message;
}
