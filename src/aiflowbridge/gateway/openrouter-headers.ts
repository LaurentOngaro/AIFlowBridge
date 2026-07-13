/**
 * OpenRouter-specific upstream header injection.
 *
 * The OpenRouter docs (https://openrouter.ai/docs/api-reference/listing)
 * ask every client to set `HTTP-Referer` so the request can be attributed
 * back to AIFlowBridge on the OpenRouter dashboard, and so the request
 * is eligible for the free-tier reliability track. We also set the
 * companion `X-Title` header so the OpenRouter web UI shows the request
 * origin in a human-readable form.
 *
 * The function is intentionally tiny and VS-Code-free so it can be unit
 * tested in `tests/integration/openrouter.smoke.test.ts` without booting
 * the rest of the gateway (which is heavy on `vscode` imports).
 *
 * Host check is narrow (subdomain-friendly, case-insensitive) so a typo'd
 * baseUrl like `https://openrouter.ai.evil.example/` does not leak the
 * attribution headers to an attacker-controlled host.
 */

/**
 * Add OpenRouter's attribution headers (`HTTP-Referer`, `X-Title`) to
 * the outgoing headers bag if and only if `upstreamUrl` targets the
 * OpenRouter host. No-op for every other vendor.
 *
 * @param headers   Mutable headers bag (e.g. WHATWG `Headers`).
 * @param upstreamUrl The fully-qualified upstream URL the gateway is
 *                    about to POST to.
 * @param version   The bundled AIFlowBridge semver string (e.g. `2.12.0`).
 */
export function applyOpenRouterAttributionHeaders(headers: Headers, upstreamUrl: string, version: string): void {
  if (!/^https?:\/\/(?:[^/]*\.)?openrouter\.ai(?:\/|$)/i.test(upstreamUrl)) {
    return;
  }
  headers.set('HTTP-Referer', `https://aiflowbridge.dev v${version}`);
  headers.set('X-Title', `AIFlowBridge v${version}`);
}