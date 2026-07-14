#!/usr/bin/env node
/**
 * refresh-bundled-pricing.mjs
 *
 * Release-time script that regenerates `resources/pricing.json` from
 * the live OpenRouter `/v1/models` public listing. Run before each
 * version bump so the bundled JSON carries a fresh date stamp and
 * accurate rates.
 *
 * Wire order (release flow):
 *   1. Bump `version` in `package.json`.
 *   2. Run `npm run pricing:refresh`.
 *   3. Commit `package.json` + `resources/pricing.json` + CHANGELOG.
 *   4. Run `npm run package`.
 *
 * The script is intentionally NOT run automatically (would touch the
 * bundled file behind the user's back and could commit a network-derived
 * payload without review). A future GitHub Action on tag push can wrap
 * this call as the next step.
 *
 * Exit codes:
 *   0 - success
 *   1 - network / parse / schema / zero-model error
 *
 * Usage:
 *   node scripts/refresh-bundled-pricing.mjs
 *   npm run pricing:refresh
 */

import { request } from 'node:https';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const REQUEST_TIMEOUT_MS = 15_000;
// Resolve the project root from the current working directory. The
// script is shipped under `<repo>/scripts/refresh-bundled-pricing.mjs`
// and `npm run pricing:refresh` runs it from the repo root, so
// `process.cwd()` is the source of truth for both `package.json` and
// `resources/pricing.json`. Resolving from cwd keeps the script
// testable in isolation (a temp dir with a fake `package.json` +
// `resources/pricing.json` is enough to exercise the write path).
const BUNDLED_PATH = resolve(process.cwd(), 'resources', 'pricing.json');
const PACKAGE_PATH = resolve(process.cwd(), 'package.json');

function logInfo(message) {
  console.log(`[pricing:refresh] ${message}`);
}

function logError(message) {
  console.error(`[pricing:refresh] ${message}`);
}

function fetchOpenRouterModels() {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(
      OPENROUTER_MODELS_URL,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AIFlowBridge/pricing:refresh',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            rejectPromise(new Error(`HTTP ${response.statusCode} ${response.statusMessage || ''}`.trim()));
            return;
          }
          try {
            resolvePromise(JSON.parse(body));
          } catch (err) {
            rejectPromise(new Error(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', (err) => {
      rejectPromise(err);
    });
    req.end();
  });
}

function parsePriceString(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parseOpenRouterPricing(raw, fetchedAt) {
  const out = {};
  if (!raw || !Array.isArray(raw.data)) {
    return out;
  }
  for (const model of raw.data) {
    if (!model || typeof model !== 'object' || typeof model.id !== 'string' || model.id.length === 0) {
      continue;
    }
    const pricing = model.pricing;
    if (!pricing || typeof pricing !== 'object') {
      continue;
    }
    const inputPerToken = parsePriceString(pricing.prompt);
    const outputPerToken = parsePriceString(pricing.completion);
    if (inputPerToken === undefined || outputPerToken === undefined) {
      continue;
    }
    // Drop free / unmetered models. OpenRouter reports `"0"` for both
    // fields when the model is on the free tier. The bundled
    // `models.json` already lists seven free-tier flagships with
    // `pricing: $0 / $0`; the bundled pricing JSON must NOT duplicate
    // them (the per-model pricing block in `resources/models.json`
    // remains the source of truth for free models).
    if (inputPerToken === 0 && outputPerToken === 0) {
      continue;
    }
    out[model.id] = {
      inputPerMillion: roundTo(inputPerToken * 1_000_000, 6),
      outputPerMillion: roundTo(outputPerToken * 1_000_000, 6),
      currency: 'USD',
      fetchedAt,
    };
  }
  return out;
}

function readPreviousPricing() {
  if (!existsSync(BUNDLED_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(BUNDLED_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.models && typeof parsed.models === 'object') {
      return parsed.models;
    }
    return {};
  } catch {
    return {};
  }
}

function buildDriftTable(previous, next) {
  const allIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const rows = [];
  for (const id of allIds) {
    const prev = previous[id];
    const fresh = next[id];
    if (!prev && fresh) {
      rows.push({ id, kind: 'added', prev: null, fresh });
    } else if (prev && !fresh) {
      rows.push({ id, kind: 'removed', prev, fresh: null });
    } else if (prev && fresh) {
      const deltaIn = fresh.inputPerMillion - prev.inputPerMillion;
      const deltaOut = fresh.outputPerMillion - prev.outputPerMillion;
      const pctIn = prev.inputPerMillion > 0 ? (deltaIn / prev.inputPerMillion) * 100 : 0;
      const pctOut = prev.outputPerMillion > 0 ? (deltaOut / prev.outputPerMillion) * 100 : 0;
      const significant = Math.abs(pctIn) >= 1 || Math.abs(pctOut) >= 1;
      rows.push({ id, kind: significant ? 'changed' : 'unchanged', prev, fresh, deltaIn, deltaOut, pctIn, pctOut });
    }
  }
  rows.sort((a, b) => {
    const order = { changed: 0, added: 1, removed: 2, unchanged: 3 };
    return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
  });
  return rows;
}

function formatDriftRow(row) {
  const fmt = (entry) => entry ? `in=${entry.inputPerMillion}/M out=${entry.outputPerMillion}/M` : '-';
  switch (row.kind) {
    case 'added':
      return `  + ${row.id}: ${fmt(row.fresh)}`;
    case 'removed':
      return `  - ${row.id}: ${fmt(row.prev)}`;
    case 'changed':
      return `  ~ ${row.id}: ${fmt(row.prev)} -> ${fmt(row.fresh)} (in ${row.pctIn >= 0 ? '+' : ''}${row.pctIn.toFixed(1)}%, out ${row.pctOut >= 0 ? '+' : ''}${row.pctOut.toFixed(1)}%)`;
    default:
      return null;
  }
}

async function main() {
  logInfo(`Fetching ${OPENROUTER_MODELS_URL} ...`);
  let raw;
  try {
    raw = await fetchOpenRouterModels();
  } catch (err) {
    logError(`Network failure: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!raw || !Array.isArray(raw.data) || raw.data.length === 0) {
    logError('OpenRouter response missing top-level "data" array (schema drift) or empty list.');
    process.exit(1);
  }

  // Read version from package.json so the bundled JSON carries the
  // AIFlowBridge version that produced it. Refuse to write the
  // bundled file with a sentinel "0.0.0" version stamp: a missing
  // or non-string `version` field is a script-time error (the
  // release flow bumps package.json before running this script, so
  // `pkg.version` MUST be a non-empty string by the time we get
  // here). Silently emitting "0.0.0" used to surface in the
  // dashboard as a confusing "AIFlowBridge v0.0.0" label that
  // looked like a stale or broken install.
  let aiflowbridgeVersion = null;
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.length > 0 && pkg.version !== '0.0.0') {
      aiflowbridgeVersion = pkg.version;
    }
  } catch (err) {
    logError(`Failed to read ${PACKAGE_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (!aiflowbridgeVersion) {
    logError(`${PACKAGE_PATH} does not carry a usable "version" string (must be non-empty and not the "0.0.0" sentinel). Refusing to overwrite the bundled JSON so the dashboard does not surface a bogus version stamp.`);
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  const next = parseOpenRouterPricing(raw, generatedAt);
  const modelCount = Object.keys(next).length;
  if (modelCount === 0) {
    logError('Parsed zero metered models from OpenRouter response. Refusing to overwrite the bundled JSON.');
    process.exit(1);
  }

  const previous = readPreviousPricing();
  const drift = buildDriftTable(previous, next);

  const file = {
    schemaVersion: 1,
    generatedAt,
    source: 'openrouter',
    sourceUrl: OPENROUTER_MODELS_URL,
    aiflowbridgeVersion,
    models: next,
  };

  // Atomic write: serialize to a .tmp sibling, then rename. Keeps the
  // bundled JSON valid even if the process is killed mid-write.
  //
  // On Windows, `rename` to an existing file returns EPERM when the
  // target is momentarily locked by VS Code (open editor tab, file
  // watcher) or an AV scanner. Retry the rename a few times with a
  // short delay; if Windows still refuses, fall back to a direct
  // overwrite + cleanup so the release flow does not require the user
  // to close every tab that touches pricing.json.
  const tmpPath = `${BUNDLED_PATH}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf8');
  } catch (err) {
    logError(`Failed to write ${tmpPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const RENAME_ATTEMPTS = 5;
  const RENAME_DELAY_MS = 200;
  let renamed = false;
  let lastErr = null;
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      renameSync(tmpPath, BUNDLED_PATH);
      renamed = true;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < RENAME_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RENAME_DELAY_MS));
      }
    }
  }
  if (!renamed) {
    // Fallback: direct overwrite (writeFileSync truncates and rewrites)
    // and clean up the leftover .tmp. Loses atomicity but is good
    // enough for a manual release-time refresh.
    try {
      writeFileSync(BUNDLED_PATH, JSON.stringify(file, null, 2), 'utf8');
      try {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath);
        }
      } catch {
        // Best-effort cleanup; ignore.
      }
      logInfo(`Rename to ${BUNDLED_PATH} kept failing (${lastErr instanceof Error ? lastErr.message : String(lastErr)}); fell back to direct overwrite.`);
    } catch (err) {
      logError(`Failed to write ${BUNDLED_PATH}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  // Drift table for the maintainer's eyeball pass.
  const changed = drift.filter((r) => r.kind !== 'unchanged');
  const unchanged = drift.filter((r) => r.kind === 'unchanged');
  logInfo(`OK - wrote ${BUNDLED_PATH} with ${modelCount} metered model(s) (v${aiflowbridgeVersion}, generatedAt=${generatedAt}).`);
  logInfo(`Drift vs previous bundled file: ${changed.length} changed, ${unchanged.length} unchanged.`);
  for (const row of drift) {
    const line = formatDriftRow(row);
    if (line) {
      logInfo(line);
    }
  }
}

main().catch((err) => {
  logError(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
