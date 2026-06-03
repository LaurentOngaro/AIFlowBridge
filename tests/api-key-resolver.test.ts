/**
 * Unit tests for src/aiflowbridge/api-key-resolver.ts
 * Verifies the case-insensitive vendor matching that fixes BUG07
 * (a user-added model with the upstream-style id "MiniMax-M3" used to
 * fail to resolve the MiniMax API key from SecretStorage).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveVendorApiKey } from "../src/aiflowbridge/api-key-resolver";
import { API_KEY_SECRETS } from "../src/consts";
import type { SecretsLike } from "../src/aiflowbridge/api-key-resolver";

function makeSecrets(map: Record<string, string>): SecretsLike {
	return {
		get: vi.fn((key: string) => map[key]),
	};
}

describe("resolveVendorApiKey", () => {
	let secrets: SecretsLike;
	beforeEach(() => {
		secrets = makeSecrets({
			[API_KEY_SECRETS.deepseek]: "sk-deepseek",
			[API_KEY_SECRETS.minimax]: "sk-minimax",
			[API_KEY_SECRETS.xiaomi]: "sk-xiaomi",
		});
	});

	it("returns undefined for an empty vendor", async () => {
		expect(await resolveVendorApiKey("", secrets)).toBeUndefined();
	});

	it("resolves a default provider id (lowercase, vendor-prefixed)", async () => {
		expect(await resolveVendorApiKey("deepseek-flash", secrets)).toBe("sk-deepseek");
		expect(await resolveVendorApiKey("minimax", secrets)).toBe("sk-minimax");
		expect(await resolveVendorApiKey("xiaomi", secrets)).toBe("sk-xiaomi");
	});

	it("resolves a user-added provider id with the upstream case (BUG07)", async () => {
		// This is the regression: "MiniMax-M3" was added via
		// `AIFlowBridge: Add a custom model` and previously failed to
		// resolve the MiniMax key (case-sensitive comparison).
		expect(await resolveVendorApiKey("MiniMax-M3", secrets)).toBe("sk-minimax");
		expect(await resolveVendorApiKey("MiniMax-M2.7", secrets)).toBe("sk-minimax");
		expect(await resolveVendorApiKey("MiMo-V2.5-PRO", secrets)).toBe("sk-xiaomi");
	});

	it("is case-insensitive on the vendor prefix", async () => {
		expect(await resolveVendorApiKey("DEEPSEEK-V4-FLASH", secrets)).toBe("sk-deepseek");
		expect(await resolveVendorApiKey("Deepseek-Pro", secrets)).toBe("sk-deepseek");
		expect(await resolveVendorApiKey("XIAOMI", secrets)).toBe("sk-xiaomi");
	});

	it("returns undefined for an unknown vendor", async () => {
		expect(await resolveVendorApiKey("openai", secrets)).toBeUndefined();
		expect(await resolveVendorApiKey("anthropic", secrets)).toBeUndefined();
	});

	it("returns undefined for a vendor prefix that does not match exactly", async () => {
		// "deepseek-er" should not match "deepseek" (the separator check)
		expect(await resolveVendorApiKey("deepseeker", secrets)).toBeUndefined();
		// "minimal" should not match "minimax" (no separator)
		expect(await resolveVendorApiKey("minimal", secrets)).toBeUndefined();
	});

	it("returns undefined when the matched secret is not set", async () => {
		const emptySecrets = makeSecrets({});
		expect(await resolveVendorApiKey("minimax", emptySecrets)).toBeUndefined();
		expect(await resolveVendorApiKey("MiniMax-M3", emptySecrets)).toBeUndefined();
	});

	it("returns undefined when secrets.get throws (graceful degradation)", async () => {
		const failingSecrets: SecretsLike = {
			get: () => {
				throw new Error("vault down");
			},
		};
		expect(await resolveVendorApiKey("minimax", failingSecrets)).toBeUndefined();
		expect(await resolveVendorApiKey("MiniMax-M3", failingSecrets)).toBeUndefined();
	});

	it("accepts secrets.get returning a synchronous value", async () => {
		const syncSecrets: SecretsLike = {
			get: (key: string) => (key === API_KEY_SECRETS.minimax ? "sk-sync" : undefined),
		};
		expect(await resolveVendorApiKey("MiniMax-M3", syncSecrets)).toBe("sk-sync");
	});
});
