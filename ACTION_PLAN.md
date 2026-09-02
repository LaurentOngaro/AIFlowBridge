# ACTION_PLAN.md — Zone d'échange Perplexity ↔ VS Code (Kilo)

> File d'attente opérationnelle du projet. `BRAIN.md` garde la mémoire long
> terme ; ce fichier porte les **actions courtes et leur suivi**.

## Protocole d'échange

1. **Tout agent lit `BRAIN.md` puis ce fichier en début de session.**
2. Chaque action a : un ID (`AP-NNN`), un responsable, un statut, des notes.
3. Responsables : `Perplexity` (tech lead via GitHub), `Kilo` (exécution
   locale, piloté par Laurent), `Laurent` (décideur).
4. Statuts : `à faire` → `en cours` → `fait` | `bloqué`.
5. En terminant une action : cocher, dater, noter le résultat (commit, erreur
   assainie, constat) et ajouter une entrée au journal de `BRAIN.md`.
6. **Blocage ou question pour l'autre agent** → section « Questions / Blocages ».
7. Répartition des capacités : Perplexity conçoit, code, audite (lecture par
   fragments via la recherche GitHub), gère branches/PR ; Kilo exécute
   localement (build, tests, scripts, OAuth réel) et remonte les résultats
   assainis ; Laurent arbitre.

---

## À faire

| ID | Action | Responsable | Statut | Notes |
|---|---|---|---|---|
| AP-001 | Ajouter à `package.json` : `"scripts": { "prepare": "node scripts/install-hooks.js" }` (fusionner avec les scripts existants) | Kilo | à faire | Vérifier qu'aucun script `prepare` existant n'est écrasé |
| AP-002 | Exécuter `node scripts/install-hooks.js`, vérifier `git config core.hooksPath` (= `.githooks`), puis tester un commit factice | Kilo | à faire | Le hook doit bloquer si BRAIN/ACTION_PLAN non mis à jour |
| AP-003 | Ajouter `.ai/` au `.gitignore` (notes privées locales) sans écraser les entrées existantes | Kilo | à faire | Fusionner, ne pas réécrire le fichier |
| AP-004 | Ajouter dans `AGENTS.md` un pointeur obligatoire : « Lire BRAIN.md et ACTION_PLAN.md avant toute tâche ; les mettre à jour avant tout commit » | Kilo | à faire | Conserver le contenu existant d'AGENTS.md |
| AP-009 | Vérifier la baseline locale : `npm install`, `npm run build:standalone`, `npm test` (1038 tests attendus) ; reporter versions Node/npm et résultats dans `BRAIN.md` | Kilo | à faire | Prérequis avant toute PR de code |
| AP-010 | Documenter dans `BRAIN.md` comment le serveur standalone est lancé en local (commande, port, config) et comment Kilo CLI est configuré pour `127.0.0.1:8787/v1` | Kilo | à faire | Permet à Perplexity de spécifier la config Antigravity exacte |
| AP-012 | Après première connexion OAuth réelle : relever la liste exacte des modèles retournés par `fetchAvailableModels` et la communiquer (assainie) pour les entrées bundled de `resources/models.json` | Kilo | à faire | Nécessite le PoC OAuth (AP-013 puis modules réseau) |
| AP-013 | Sur la branche `feat/antigravity-provider` : `npm install`, `npm run compile`, `npm run compile:standalone`, `npm test` ; reporter erreurs de compilation/tests (assainies) dans « Questions / Blocages » | Kilo | à faire | Valide le squelette pur AP-008 (26 nouveaux tests attendus) |
| AP-014 | Écrire les modules réseau du provider : `auth.ts` (OAuth + callback local + mode manuel), `token-store.ts` (secrets.json), `project.ts` (loadCodeAssist), `catalog.ts` (fetchAvailableModels) | Perplexity | à faire | Après validation AP-013 ; nécessite le client id OAuth local (env `AIFLOWBRIDGE_ANTIGRAVITY_CLIENT_ID`, jamais commité) |

## En cours

| ID | Action | Responsable | Notes |
|---|---|---|---|
| AP-008 | Squelette `src/aiflowbridge/antigravity/` (modules purs + tests) sur `feat/antigravity-provider` | Perplexity | Modules livrés : constants, types, pkce, envelope, sse-transform, index + 3 fichiers de tests ; reste : validation locale (AP-013) puis modules réseau (AP-014) |

## Questions / Blocages

_(vide)_

## Fait

| ID | Action | Date | Résultat |
|---|---|---|---|
| AP-000 | Plan d'implémentation Antigravity | 2026-09-02 | `docs/plans/antigravity-provider-kilo-cli.md` (commit `2ba3a4c`) |
| AP-000b | Infrastructure de collaboration (BRAIN, ACTION_PLAN, hooks, règles Kilo) | 2026-09-02 | Commit `f7bc109` sur `main` |
| AP-000c | Canal privé non public | 2026-09-02 | `AIFlowBridge-Private/BRAIN-PRIVATE.md` (commit `33bce42`, branche `master`) |
| AP-005 | Audit des fichiers existants | 2026-09-02 | **Perplexity** ; synthèse dans `BRAIN.md` § « Contexte technique clé » |
| AP-006 | Le mode standalone expose-t-il déjà un serveur OpenAI-compatible ? | 2026-09-02 | **Oui** : `GatewayService` sert `127.0.0.1:8787/v1/chat/completions` |
| AP-007 | Cartographie du relais `server.ts` + spec d'intégration | 2026-09-02 | **Perplexity** ; `docs/plans/antigravity-gateway-integration-spec.md` (commit `d26f132`) |
| AP-011 | Arbitrages de la spec §4 | 2026-09-02 | **Laurent** : kind `'antigravity'` ✔, commande `aiflowbridge-server auth antigravity` ✔, MVP **gateway-only** ✔ (picker Copilot Chat reporté en V2) |
