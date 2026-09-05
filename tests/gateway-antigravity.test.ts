import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  default: {
    window: {
      createOutputChannel: vi.fn(() => ({
        name: 'AIFlowBridge',
        log: vi.fn(),
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    LogLevel: { Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Off: 5 },
  },
}));

import type { AiFlowBridgeConfig } from '../src/aiflowbridge/types';
import { AntigravityTokenManager } from '../src/aiflowbridge/antigravity';
import { AntigravityTokenStore } from '../src/aiflowbridge/antigravity/token-store';
import { GatewayService } from '../src/aiflowbridge/gateway/server';

describe('GatewayService — Antigravity / Google AI Studio integration', () => {
  let mockUpstreamServer: Server;
  let mockUpstreamPort: number;
  let receivedRequests: Array<{ url?: string; headers: Record<string, string | string[] | undefined>; body: unknown }> = [];
  let gateway: GatewayService;
  let gatewayPort: number;

  beforeEach(async () => {
    receivedRequests = [];

    // Spin up mock Cloud Code upstream server
    await new Promise<void>((resolve) => {
      mockUpstreamServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        let bodyStr = '';
        for await (const chunk of req) {
          bodyStr += chunk.toString();
        }
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(bodyStr);
        } catch {
          parsedBody = bodyStr;
        }

        receivedRequests.push({
          url: req.url,
          headers: req.headers,
          body: parsedBody,
        });

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        res.write(
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello from Antigravity!"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":6,"totalTokenCount":21}}}\n\n'
        );
        res.end();
      });

      mockUpstreamServer.listen(0, '127.0.0.1', () => {
        mockUpstreamPort = (mockUpstreamServer.address() as { port: number }).port;
        resolve();
      });
    });

    gatewayPort = mockUpstreamPort + 10;
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
    }
    await new Promise<void>((resolve) => mockUpstreamServer.close(() => resolve()));
  });

  it('routes request through Antigravity envelope and converts SSE stream', async () => {
    // Mock token store / manager with valid tokens
    const tokenFile = ':memory:';
    void tokenFile;
    const mockStore = {
      filePath: ':memory:',
      load: () => ({
        accessToken: 'ya29.mock-test-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600_000,
        projectId: 'test-cloud-project',
      }),
      save: () => undefined,
      clear: () => undefined,
    } as unknown as AntigravityTokenStore;
    const tokenManager = new AntigravityTokenManager(mockStore);

    const config = { telemetryEnabled: true, visionProxy: { excludedVendors: [], copilotVisionModel: '' },
      gateway: {
        enabled: true,
        port: gatewayPort,
        host: '127.0.0.1',
        baseUrl: `http://127.0.0.1:${gatewayPort}`,
        defaultModel: 'gemini-3.8-flash',
        probeTimeoutMs: 500,
        autoRestart: false,
        maxConcurrentRequests: 20,
        maxConcurrentPerProvider: 5,
        upstreamIdleTimeoutMs: 5000,
        streamTotalTimeoutMs: 10000,
      },
      providers: [
        {
          id: 'googleaistudio-gemini-3.8-flash',
          kind: 'googleaistudio' as const,
          label: 'Google AI Studio',
          model: 'gemini-3.8-flash',
          baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
          enabled: true,
          billing: 'plan' as const,
        },
      ],
      userModels: [],
      captureSessionLog: false,
      logRequests: false,
      telemetryRetentionDays: 90,
      telemetryMaxStoredRequestBytes: 8192,
    };

    gateway = new GatewayService(
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      '2.16.1',
      undefined,
      undefined,
      tokenManager
    ) as GatewayService;
    gateway.init();
    await gateway.start();

    // Send chat completion request to gateway
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-aiflowbridge-local',
      },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', content: 'Ping Antigravity' }],
        stream: true,
      }),
    });

    const bodyText = await res.text();
    expect(res.status).toBe(200);

    // Verify upstream received correct Antigravity envelope
    expect(receivedRequests).toHaveLength(1);
    const upstreamReq = receivedRequests[0];
    const upstreamBody = upstreamReq.body as { project?: string; model?: string; requestType?: string; request?: { contents?: unknown[] } };
    expect(upstreamReq.headers['authorization']).toBe('Bearer ya29.mock-test-access-token');
    expect(upstreamReq.headers['user-agent']).toBe('antigravity');
    expect(upstreamReq.headers['x-goog-api-client']).toBe('gl-kiloCode/10.4.1');

    expect(upstreamBody.project).toBe('test-cloud-project');
    expect(upstreamBody.model).toBe('gemini-3.8-flash');
    expect(upstreamBody.requestType).toBe('agent');
    expect(upstreamBody.request?.contents?.[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Ping Antigravity' }],
    });

    // Verify client received OpenAI format chunks ending with [DONE]
    expect(bodyText).toContain('chat.completion.chunk');
    expect(bodyText).toContain('Hello from Antigravity!');
    expect(bodyText).toContain('data: [DONE]');
  });

  it('routes non-streaming request and returns single OpenAI ChatCompletion payload', async () => {
    const tokenFile = ':memory:';
    void tokenFile;
    const mockStore = {
      filePath: ':memory:',
      load: () => ({
        accessToken: 'ya29.mock-test-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600_000,
        projectId: 'test-cloud-project',
      }),
      save: () => undefined,
      clear: () => undefined,
    } as unknown as AntigravityTokenStore;
    const tokenManager = new AntigravityTokenManager(mockStore);

    const config = { telemetryEnabled: true, visionProxy: { excludedVendors: [], copilotVisionModel: '' },
      gateway: {
        enabled: true,
        port: gatewayPort,
        host: '127.0.0.1',
        baseUrl: `http://127.0.0.1:${gatewayPort}`,
        defaultModel: 'gemini-3.8-flash',
        probeTimeoutMs: 500,
        autoRestart: false,
        maxConcurrentRequests: 20,
        maxConcurrentPerProvider: 5,
        upstreamIdleTimeoutMs: 5000,
        streamTotalTimeoutMs: 10000,
      },
      providers: [
        {
          id: 'antigravity-gemini-3.8-flash',
          kind: 'antigravity' as const,
          label: 'Antigravity Gemini',
          model: 'gemini-3.8-flash',
          baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
          enabled: true,
          billing: 'plan' as const,
        },
      ],
      userModels: [],
      captureSessionLog: false,
      logRequests: false,
      telemetryRetentionDays: 90,
      telemetryMaxStoredRequestBytes: 8192,
    };

    gateway = new GatewayService(
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      '2.16.1',
      undefined,
      undefined,
      tokenManager
    ) as GatewayService;
    gateway.init();
    await gateway.start();

    const res = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-aiflowbridge-local',
      },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', content: 'Ping Antigravity non-stream' }],
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { object?: string; choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { total_tokens?: number } };
    expect(json.object).toBe('chat.completion');
    expect(json.choices?.[0]?.message?.content).toBe('Hello from Antigravity!');
    expect(json.choices?.[0]?.finish_reason).toBe('stop');
    expect(json.usage?.total_tokens).toBe(21);
  });

  it('stamps plan billing on recorded entries', async () => {
    const snap = gateway.snapshot();
    const planEntries = snap.recent.filter((entry) => entry.model === 'gemini-3.8-flash');
    expect(planEntries.length).toBeGreaterThan(0);
    for (const entry of planEntries) {
      expect(entry.billedTo).toBe('plan');
    }
  });
});
