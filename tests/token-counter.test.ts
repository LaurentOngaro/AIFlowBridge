/**
 * Unit tests for the MiniMax /v1/responses/input_tokens token counter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMinimaxPromptTokens } from "../src/aiflowbridge/token-counter";

interface MockResponseInit {
	status?: number;
	body?: unknown;
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("fetchMinimaxPromptTokens", () => {
	it("returns undefined when apiKey is empty", async () => {
		const result = await fetchMinimaxPromptTokens({
			apiKey: "",
			model: "MiniMax-M2.7",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(result).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns the input_tokens value on 200", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { object: "response.input_tokens", input_tokens: 42 }));
		const result = await fetchMinimaxPromptTokens({
			apiKey: "sk-test",
			model: "MiniMax-M2.7",
			messages: [{ role: "user", content: "hello" }],
		});
		expect(result).toBe(42);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain("/v1/responses/input_tokens");
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body))).toEqual({
			model: "MiniMax-M2.7",
			input: [{ role: "user", content: "hello" }],
		});
	});

	it("returns undefined on non-2xx response", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
		const result = await fetchMinimaxPromptTokens({
			apiKey: "sk-test",
			model: "MiniMax-M2.7",
			messages: [],
		});
		expect(result).toBeUndefined();
	});

	it("returns undefined on malformed body", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { not_input_tokens: 1 }));
		const result = await fetchMinimaxPromptTokens({
			apiKey: "sk-test",
			model: "MiniMax-M2.7",
			messages: [],
		});
		expect(result).toBeUndefined();
	});

	it("uses custom baseUrl when provided", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { object: "response.input_tokens", input_tokens: 7 }));
		await fetchMinimaxPromptTokens({
			baseUrl: "https://custom.example.com/",
			apiKey: "sk-test",
			model: "MiniMax-M2.7",
			messages: [],
		});
		expect(fetchMock.mock.calls[0][0]).toBe("https://custom.example.com/v1/responses/input_tokens");
	});

	it("returns undefined on fetch error", async () => {
		fetchMock.mockRejectedValueOnce(new Error("network"));
		const result = await fetchMinimaxPromptTokens({
			apiKey: "sk-test",
			model: "MiniMax-M2.7",
			messages: [],
		});
		expect(result).toBeUndefined();
	});
});
