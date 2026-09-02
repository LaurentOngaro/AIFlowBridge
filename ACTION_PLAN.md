# ACTION_PLAN.md — Zone d'échange Perplexity ↔ VS Code (Kilo)

> File d'attente opérationnelle du projet. `BRAIN.md` garde la mémoire long
> terme ; ce fichier porte les **actions courtes et leur suivi**.

## Protocole d'échange

1. **Tout agent lit `BRAIN.md` puis ce fichier en début de session.**
2. Chaque action a : un ID (`AP-NNN`), un responsable, un statut, des notes.
3. Responsables : `Perplexity` (via connecteur GitHub), `Kilo` (extension ou
   CLI, piloté par Laurent), `Laurent` (humain).
4. Statuts : `à faire` → `en cours` → `fait` | `bloqué`.
5. En terminant une action : cocher, dater, noter le résultat (commit, erreur
   assainie, constat) et ajouter une entrée au journal de `BRAIN.md`.
6. **Blocage ou question pour l'autre agent** → section « Questions / Blocages ».
7. Perplexity ne peut pas lire le contenu des fichiers existants ni exécuter
   le code : les lectures locales, builds, tests et exécutions sont pour Kilo.

---

## À faire

| ID | Action | Responsable | Statut | Notes |
|---|---|---|---|---|
| AP-001 | Ajouter à `package.json` : `"scripts": { "prepare": "node scripts/install-hooks.js" }` (fusionner avec les scripts existants) | Kilo | à faire | Perplexity ne peut pas éditer `package.json` sans en lire le contenu ; vérifier qu'aucun script `prepare` existant n'est écrasé |
| AP-002 | Exécuter `node scripts/install-hooks.js`, vérifier `git config core.hooksPath` (= `.githooks`), puis tester un commit factice | Kilo | à faire | Le hook doit bloquer si BRAIN/ACTION_PLAN non mis à jour |
| AP-003 | Ajouter `.ai/` au `.gitignore` (notes privées locales) sans écraser les entrées existantes | Kilo | à faire | Fusionner, ne pas réécrire le fichier |
| AP-004 | Ajouter dans `AGENTS.md` un pointeur obligatoire : « Lire BRAIN.md et ACTION_PLAN.md avant toute tâche ; les mettre à jour avant tout commit » | Kilo | à faire | Conserver le contenu existant d'AGENTS.md |
| AP-005 | Audit des fichiers existants : `src/standalone/main.ts`, `src/provider/base.ts`, `src/provider/index.ts`, `src/auth.ts`, `src/config.ts`, `src/types.ts` ; rédiger la synthèse (interfaces, points d'extension, stockage des secrets) dans `BRAIN.md` § « Contexte technique clé » | Kilo | à faire | Prérequis au PoC OAuth Antigravity |
| AP-006 | Vérifier si le mode standalone expose déjà un serveur HTTP et des routes OpenAI-compatibles ; reporter le constat dans `BRAIN.md` | Kilo | à faire | Conditionne le point d'entrée de la passerelle |

## En cours

_(vide)_

## Questions / Blocages

_(vide — ex. : « Kilo → Perplexity : le fichier X attend le format Y, confirmer »)_

## Fait

| ID | Action | Date | Résultat |
|---|---|---|---|
| AP-000 | Plan d'implémentation Antigravity | 2026-09-02 | `docs/plans/antigravity-provider-kilo-cli.md` (commit `2ba3a4c`) |
| AP-000b | Infrastructure de collaboration (BRAIN, ACTION_PLAN, hooks, règles Kilo) | 2026-09-02 | Fichiers créés par Perplexity sur `main` |
