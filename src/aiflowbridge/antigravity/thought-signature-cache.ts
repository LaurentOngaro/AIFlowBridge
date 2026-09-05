/**
 * AIFlowBridge - in-memory thought_signature cache.
 *
 * Why this exists: Gemini 2.5+ / 3.x thinking models attach an opaque
 * `thought_signature` to every `functionCall` part they return, and
 * reject the NEXT request (`400 Function call is missing a
 * thought_signature`) when the signature is not echoed back. The
 * OpenAI Chat Completions shape has no native field for the
 * signature, and most OpenAI-compatible clients (Kilo Code CLI
 * `openai-chat` protocol included) drop unknown `extra_signature`
 * fields when they persist conversation history between turns - the
 * signature returned on turn N never reaches the gateway on turn N+1.
 *
 * The cache closes that gap server-side: every OpenAI-shaped response
 * the gateway produces is scanned for `extra_signature` values (which
 * mirror the upstream `thoughtSignature`), stored by `tool_call` id,
 * and re-injected into the native / AGY envelope on the next request
 * when the client replays the turn WITHOUT the signature.
 *
 * Scope and limits (by design):
 *   - In-memory only, per gateway process. No persistence, no
 *     cross-process sharing. A restart clears the cache - the next
 *     tool round re-populates it from the first model response.
 *   - Bounded (`MAX_SIGNATURE_CACHE_ENTRIES`, oldest evicted first)
 *     and time-boxed (`SIGNATURE_CACHE_TTL_MS`): entries expire and
 *     are swept lazily on every lookup. A stale signature is WORSE
 *     than a missing one (the upstream would reject with a different
 *     400), so expiry errs on the short side.
 *   - Client-supplied `extra_signature` ALWAYS wins over the cache.
 *     The cache only fills gaps; it never overrides what the client
 *     explicitly sent.
 *   - Opt-in via `aiflowbridge.gateway.injectThoughtSignature`
 *     (default `false`). The pass-through contract (`extra_signature`
 *     in -> `thoughtSignature` out, and back) works with the flag
 *     off; only the server-side gap-filling needs the flag.
 *
 * Pure module, no `vscode` import, unit-testable under vitest.
 */

export const SIGNATURE_CACHE_TTL_MS = 30 * 60 * 1000;

export const MAX_SIGNATURE_CACHE_ENTRIES = 500;

interface CacheSlot {
  signature: string;
  storedAt: number;
}

export interface SignatureLookup {
  /**
   * Look up the cached signature for a tool-call id. Returns
   * `undefined` on miss or on expired entry (the expired slot is
   * removed as a side effect).
   */
  get(toolCallId: string): string | undefined;
}

/**
 * Create a fresh in-memory signature cache. One instance lives on the
 * `GatewayService`; tests create their own via this factory.
 */
export function createThoughtSignatureCache(now: () => number = Date.now): {
  store(signature: string, toolCallId: string): void;
  lookup(toolCallId: string): string | undefined;
  size(): number;
} {
  const slots = new Map<string, CacheSlot>();

  const isExpired = (slot: CacheSlot): boolean => now() - slot.storedAt > SIGNATURE_CACHE_TTL_MS;

  const sweepExpired = (): void => {
    for (const [key, slot] of slots) {
      if (isExpired(slot)) {
        slots.delete(key);
      }
    }
  };

  return {
    store(signature: string, toolCallId: string): void {
      if (!signature || !toolCallId) {
        return;
      }
      sweepExpired();
      if (!slots.has(toolCallId) && slots.size >= MAX_SIGNATURE_CACHE_ENTRIES) {
        const oldest = slots.keys().next();
        if (!oldest.done) {
          slots.delete(oldest.value);
        }
      }
      slots.set(toolCallId, { signature, storedAt: now() });
    },
    lookup(toolCallId: string): string | undefined {
      if (!toolCallId) {
        return undefined;
      }
      const slot = slots.get(toolCallId);
      if (!slot) {
        return undefined;
      }
      if (isExpired(slot)) {
        slots.delete(toolCallId);
        return undefined;
      }
      return slot.signature;
    },
    size(): number {
      sweepExpired();
      return slots.size;
    },
  };
}

export type ThoughtSignatureCache = ReturnType<typeof createThoughtSignatureCache>;
