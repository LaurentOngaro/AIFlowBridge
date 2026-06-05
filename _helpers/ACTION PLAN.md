# ACTION PLAN

This document details the implementation steps to make the AIFlowBridge extension publishable on the VS Code Marketplace. It completes the `TODO.md` file by adding the necessary technical details.

---

## Follow-up agreement

Each completed edit:

- Check the box in this document (go from `[ ]` to `[x]`)
- Update the status in `TODO.md` if a section references it
- Keep the history of this document (do not delete completed sections)

---

## Refactor - Registre JSON unifié des modèles

### point restants à vérifier

PRELIMINAIRE: Quel EST LE FICHIER "models.json"à modifier (pour le test en debug) ?

- [x] T1: La commande `AIFlowBridge: Edit model registry` crée le globalStorage et l'ouvre (test manuel)
- [x] T2: Supprimer le globalStorage et relancer : retour aux tarifs bundled (test manuel)
- [x] T3: Modifier le pricing d'un modèle dans le globalStorage et relancer VS Code : le dashboard reflète la nouvelle valeur (test manuel)
  - 1ère cause racine (corrigée au tour précédent) : `synthesizeProviderForModel` (`src/aiflowbridge/config.ts`) jetait `model.pricing` du registre mergé et substituait toujours les tarifs indicatifs hardcodés par famille (`DEFAULT_GATEWAY_PROFILES`). Fix : `synthesizeProviderForModel` prend maintenant `model.pricing?: ...` (préféré) puis fallback `familyPricing.get(family)` ; `buildDefaultGatewayProfiles` fait `entry.pricing ?? toProviderPricing(registryEntry?.pricing)`. Tests dans `tests/aiflowbridge-config.test.ts`.
  - 2ème cause racine (corrigée ce tour, après test manuel) : le validateur `validateModelEntry` (`src/aiflowbridge/modelRegistry.schema.ts`) tournait en mode `'strict'` pour TOUS les tiers, y compris les overrides globalStorage / workspace. En mode strict, les champs `name`, `family`, `version`, `detail`, `maxInputTokens`, `maxOutputTokens`, `requiresThinkingParam`, `capabilities` sont tous **requis**. L'utilisateur (logiquement) écrit un override minimal — juste `id` + `pricing` — qui se faisait silencieusement dropper avec un warn dans l'output channel ("missing/invalid 'name'"). Le merge retombait donc sur l'entrée bundled (avec l'ancien pricing) et le dashboard ne changeait pas. Fix : ajout d'un mode `'partial'` pour les tiers d'override (`loadTier` passe `mode: 'partial'` pour globalStorage et workspace, `mode: 'strict'` pour bundled). En mode partial, seul `id` est requis, les autres champs sont validés s'ils sont présents et deep-merge sur l'entrée bundled via `??`. Tests dans `tests/modelRegistry.schema.test.ts` (mode partial) et `tests/modelRegistry.test.ts` (intégration T3).
- [ ] T4: `.vscode/aiflowbridge.models.json` dans un workspace de test : priorité sur le globalStorage (test manuel)
