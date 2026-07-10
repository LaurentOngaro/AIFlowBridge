#!/usr/bin/env node
/*
 * Smoke test for the standalone build.
 *
 * Reads `dist/standalone/main.js`, extracts every `require('../...')` it
 * performs, and asserts that the referenced file (or `index.js` inside
 * the referenced directory) exists on disk.
 *
 * Used by:
 *   - `.github/workflows/release.yml` smoke-test step before uploading
 *     the release archive (catches the v2.3.0 regression where the
 *     sibling modules under `dist/` were not bundled).
 *   - `tests/standalone-bundle.test.ts` so contributors see the failure
 *     locally before pushing.
 *
 * Exit code 0 on success, 1 on any missing reference.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENTRY = process.argv[2] || 'dist/standalone/main.js';
const ENTRY_DIR = path.dirname(path.resolve(ENTRY));

function listRequires(source) {
  // Match `require('...')` (single or double quotes). We only care about
  // relative requires starting with `../` or `./` - bare specifiers are
  // resolved from node_modules and not our concern here.
  const out = [];
  const re = /require\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push(m[2]);
  }
  return out;
}

function resolveFromHere(spec) {
  // Mirror Node's CommonJS resolution order: exact file, then add
  // .js / .json / .node, then directory + /index.js. This catches
  // extension-less specifiers like `../aiflowbridge/modelRegistry`.
  const target = path.resolve(ENTRY_DIR, spec);
  const exts = ['', '.js', '.json', '.node'];
  for (const ext of exts) {
    const candidate = target + ext;
    if (fs.existsSync(candidate)) {
      if (fs.statSync(candidate).isDirectory()) continue;
      return candidate;
    }
  }
  // Directory + /index.<ext>
  for (const ext of exts) {
    const candidate = path.join(target, 'index' + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  if (!fs.existsSync(ENTRY)) {
    console.error(`[check-standalone-bundle] Entry point not found: ${ENTRY}`);
    console.error('[check-standalone-bundle] Run `npm run build:standalone` first.');
    process.exit(1);
  }

  const source = fs.readFileSync(ENTRY, 'utf8');
  const requires = listRequires(source);

  const requiresMissing = [];
  for (const spec of requires) {
    const resolved = resolveFromHere(spec);
    if (!resolved) {
      requiresMissing.push(spec);
    }
  }

  // The entry point's extensionRoot is the directory containing
  // `resources/models.json`. Verify both it and `package.json` exist
  // so the standalone can report its version and load model definitions.
  const root = path.resolve(ENTRY_DIR, '..', '..');
  const runtimeFiles = ['package.json', 'resources/models.json'];
  const runtimeMissing = [];
  for (const rf of runtimeFiles) {
    if (!fs.existsSync(path.join(root, rf))) {
      runtimeMissing.push(rf + ' (runtime)');
    }
  }

  const allMissing = [...requiresMissing, ...runtimeMissing];

  if (requires.length === 0 && runtimeMissing.length === 0) {
    console.error(`[check-standalone-bundle] No relative requires found in ${ENTRY} and no runtime files to verify - nothing to check.`);
    process.exit(1);
  }

  if (allMissing.length > 0) {
    console.error(`[check-standalone-bundle] ${allMissing.length} missing reference(s) from ${ENTRY}:`);
    for (const spec of allMissing) {
      console.error(`  - ${spec}`);
    }
    console.error('');
    console.error('The standalone entry point requires files that are not present on disk.');
    console.error('Make sure `npm run build:standalone` was run and that the sibling modules');
    console.error('(`dist/aiflowbridge/`, `dist/logger.js`, ...) are committed to the archive.');
    process.exit(1);
  }

  console.log(`[check-standalone-bundle] OK - ${requires.length} relative require(s) resolved from ${ENTRY}`);
  for (const spec of requires) {
    console.log(`  - ${spec} -> ${path.relative(process.cwd(), resolveFromHere(spec))}`);
  }
  console.log(`[check-standalone-bundle] OK - runtime files present (package.json, resources/models.json)`);
}

main();
