/**
 * Unit tests for src/standalone/config-loader.ts.
 *
 * Strategy: each test writes a synthetic `config.json` to a temp dir,
 * instantiates `StandaloneConfigFile` over it, and asserts the merged
 * read behavior (file override -> bundled default -> caller fallback).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the `vscode` module so the transitive import chain
// (`aiflowbridge/...` -> `src/logger.ts` -> `vscode`) does not blow up
// under vitest.
vi.mock('vscode', () => {
	const stubChannel = {
		name: 'mock',
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
		debug: () => undefined,
		show: () => undefined,
		dispose: () => undefined,
		append: () => undefined,
		appendLine: () => undefined,
		hide: () => undefined,
		clear: () => undefined,
	};
	return {
		default: {
			window: { createOutputChannel: () => stubChannel },
		},
		window: { createOutputChannel: () => stubChannel },
	};
});

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StandaloneConfigFile, DEFAULT_STANDALONE_CONFIG, defaultStandaloneConfigPath } from '@/standalone/config-loader';

let tempDir: string;
let configPath: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `aiflowbridge-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	configPath = join(tempDir, 'config.json');
});

afterEach(() => {
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe('StandaloneConfigFile', () => {
	it('returns the bundled default when the file is missing', () => {
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.enabled', false)).toBe(true);
		expect(reader.get('gateway.port', 1234)).toBe(8787);
	});

	it('returns the caller-supplied fallback when neither the file nor a default is set', () => {
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('custom.unknown.key', 'fallback')).toBe('fallback');
	});

	it('reads values written to the file', () => {
		writeFileSync(configPath, JSON.stringify({ gateway: { port: 9999 } }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.port', 8787)).toBe(9999);
	});

	it('file value overrides bundled defaults', () => {
		writeFileSync(configPath, JSON.stringify({ gateway: { enabled: false } }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.enabled', true)).toBe(false);
	});

	it('handles a deeply nested key', () => {
		writeFileSync(configPath, JSON.stringify({ providers: { minimax: { temperature: 0.42 } } }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get<number>('providers.minimax.temperature', 1)).toBe(0.42);
	});

	it('falls back to the bundled default when the file value is null', () => {
		writeFileSync(configPath, JSON.stringify({ gateway: { port: null } }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.port', 1234)).toBe(8787);
	});

	it('returns an empty array as-is (no fallback substitution)', () => {
		writeFileSync(configPath, JSON.stringify({ providers: [] }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get<unknown[]>('providers', [])).toEqual([]);
	});

	it('survives a corrupt JSON file (falls back to defaults, no throw)', () => {
		writeFileSync(configPath, '{not valid json');
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.enabled', false)).toBe(true);
	});

	it('survives a non-object JSON root (array)', () => {
		writeFileSync(configPath, JSON.stringify([1, 2, 3]));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.enabled', false)).toBe(true);
	});

	it('invalidate() forces a re-read on the next get()', () => {
		writeFileSync(configPath, JSON.stringify({ gateway: { port: 1000 } }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.port', 0)).toBe(1000);

		writeFileSync(configPath, JSON.stringify({ gateway: { port: 2000 } }));
		// Without invalidate(), the cache still holds 1000.
		expect(reader.get('gateway.port', 0)).toBe(1000);

		reader.invalidate();
		expect(reader.get('gateway.port', 0)).toBe(2000);
	});

	it('defaultStandaloneConfigPath() joins the storage dir + config.json', () => {
		// Use `tmpdir()` so the assertion is portable across Windows /
		// POSIX separators (Node's `path.join` normalizes).
		const storageDir = join(tmpdir(), 'aiflowbridge-test');
		expect(defaultStandaloneConfigPath(storageDir)).toBe(join(storageDir, 'config.json'));
	});

	it('exposes the bundled defaults map (sanity)', () => {
		expect(DEFAULT_STANDALONE_CONFIG['gateway.enabled']).toBe(true);
		expect(DEFAULT_STANDALONE_CONFIG['gateway.port']).toBe(8787);
	});

	it('reads arrays written at nested keys', () => {
		writeFileSync(configPath, JSON.stringify({ vision: { excludedVendors: ['minimax', 'xiaomi'] } }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get<string[]>('vision.excludedVendors', ['aiflowbridge'])).toEqual(['minimax', 'xiaomi']);
	});
});

describe('StandaloneConfigFile + watcher integration', () => {
	it('still serves correct values when the on-disk file is later deleted (cache holds the last good read)', () => {
		writeFileSync(configPath, JSON.stringify({ gateway: { port: 1234 } }));
		const reader = new StandaloneConfigFile(configPath);
		expect(reader.get('gateway.port', 0)).toBe(1234);
		rmSync(configPath);
		// The cache still holds the last good read; the runtime watches
		// the file via `onConfigChange` and calls `invalidate()` to drop it.
		expect(reader.get('gateway.port', 0)).toBe(1234);
	});
});

// Reference the imported `readFileSync` so vitest doesn't strip it out
// of the dep graph (it's used implicitly by writing test fixtures).
void readFileSync;