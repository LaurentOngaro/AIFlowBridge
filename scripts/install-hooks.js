#!/usr/bin/env node
/**
 * AIFlowBridge — installation des hooks git versionnés.
 *
 * Configure `core.hooksPath` pour pointer vers le dossier `.githooks/`
 * du dépôt, afin que les hooks soient partagés et versionnés avec le code.
 *
 * Usage :
 *   node scripts/install-hooks.js
 *
 * Recommandation : ajouter à package.json :
 *   "scripts": { "prepare": "node scripts/install-hooks.js" }
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function git(args, options = {}) {
  return execSync(`git ${args}`, { encoding: 'utf8', ...options }).trim();
}

function gitConfigGet(key) {
  try {
    return git(`config --get ${key}`);
  } catch {
    return '';
  }
}

let root;
try {
  root = git('rev-parse --show-toplevel');
} catch {
  console.error('[install-hooks] ERREUR : pas dans un dépôt git.');
  process.exit(1);
}

const hooksDir = path.join(root, '.githooks');
if (!fs.existsSync(hooksDir)) {
  console.error('[install-hooks] ERREUR : dossier .githooks/ introuvable.');
  process.exit(1);
}

git('config core.hooksPath .githooks');

// Bit d'exécution requis sur Linux/macOS (ignoré sous Windows).
for (const file of fs.readdirSync(hooksDir)) {
  try {
    fs.chmodSync(path.join(hooksDir, file), 0o755);
  } catch {
    /* Windows : ignoré */
  }
}

const brainMode = gitConfigGet('hooks.brainMode') || 'strict (défaut)';
const pullCheck = gitConfigGet('hooks.pullCheck') || 'true (défaut)';

console.log('[install-hooks] core.hooksPath = .githooks  ✔');
console.log(`[install-hooks] hooks.brainMode = ${brainMode}`);
console.log(`[install-hooks] hooks.pullCheck = ${pullCheck}`);
console.log('[install-hooks] Hooks actifs : pre-commit (pull requis + journal BRAIN).');
