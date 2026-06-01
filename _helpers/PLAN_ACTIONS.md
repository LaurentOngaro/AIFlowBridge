# PLAN D'ACTIONS — Préparation à la publication VS Code Marketplace

Ce document détaille les étapes d'implémentation pour rendre l'extension AIFlowBridge publiable sur le VS Code Marketplace. Il complète le fichier `TODO.md` en ajoutant les détails techniques nécessaires.

La priorisation suit le verdict de l'inventaire (cf. fin de ce document) : **3 bloquants critiques (CI, i18n, settings)**, puis **polish importants (README, AGENTS.md, TODO.md)**, puis **mineurs**.

---

## Convention de suivi

Chaque modification terminée :

- Cocher la case dans ce document (passer de `[ ]` à `[x]`)
- Mettre à jour le statut dans `TODO.md` si une section le référence
- Conserver l'historique de ce document (ne pas effacer les sections terminées)

---

# 🔴 SPRINT 1 — BLOQUANTS (à faire en premier, sans cela la CI ne passe pas et les releases sont cassées)

## S1.1 — Corriger la CI GitHub Actions

**Problème** : `.github/workflows/ci.yml` référence des scripts qui n'existent pas dans `package.json` (`npm run lint`, `npm run format:check`).

### Étape S1.1.1 — Supprimer les références à oxlint/oxfmt (non installés)

- [x] oxlint et oxfmt ne sont pas installés (vérifié avec `npm list`)
- [x] Supprimé les étapes `lint` et `format:check` du CI.yml
- [x] Remplacé par `npm test` (qui existe et passe)
- [x] Supprimé `.oxlintrc.json` et `.oxfmtrc.json` (config files inutiles)

### Étape S1.1.2 — Corriger le nom d'artefact obsolète

- [x] Remplacé `deepseek-v4-for-copilot.vsix` par `aiflowbridge.vsix` dans `.github/workflows/ci.yml`

### Étape S1.1.3 — Vérifier la version de Node dans la CI

- [x] `.nvmrc` = 24, CI utilise `node-version: 24` ✓

---

## S1.2 — Synchroniser i18n.ts et package.nls.json

**Problème** : les deux fichiers sources de vérité des traductions divergent. Un seul doit faire foi pour VS Code Marketplace (qui lit `package.nls.json`).

### Étape S1.2.1 — Source de vérité

- [x] **Décision** : `package.nls.json` doit afficher les bons textes au marketplace, `i18n.ts` les bons textes en runtime

### Étape S1.2.2 — Fusionner les clés manquantes

- [x] Ajouté à `package.nls.json` les clés présentes dans `i18n.ts` mais absentes :
  - `auth.apiKeyRequiredDetail`
  - `request.preflightRoundLimitExceeded`
  - `notice.toolDrift` avec URL complète
  - `error.http.401.withCreateApiKeyLink`
  - `error.http.422`
  - `error.http.generic`
  - `error.action.*` (5 clés)
  - `error.network.*` (9 clés)
  - `error.http.400` (avec point final pour cohérence)
  - `error.http.401` (avec "Please" pour cohérence)
  - `error.http.402/429/500/503` (avec "Please" et "retry later")
  - `extension.openRequestDumpsFolderFailed`
  - `command.setApiKey`
  - `command.clearApiKey`
  - `command.apiKeySaved` (avec point final)
  - `command.apiKeyRemoved` (avec point final)
  - `auth.notConfigured` (avec ": Set API Key" complet)

### Étape S1.2.3 — Refactorisation (optionnel pour V1)

- [ ] Migration vers `vscode.l10n.t()` (à faire dans Sprint 3 si temps)

---

## S1.3 — Supprimer `aiflowbridge.vision.enabled` (jamais utilisé)

**Problème** : le setting `aiflowbridge.vision.enabled` est déclaré dans `package.json` mais n'est jamais lu dans le code.

### Étape S1.3.1 — Vérifier l'utilisation

- [x] `grep -r "vision.enabled" src/` → 0 résultat (jamais lu)

### Étape S1.3.2 — Décision

- [x] **Option A choisie** : Supprimé le setting de `package.json` (lignes 296-300)

---

# 🟡 SPRINT 2 — POLISH IMPORTANTS (lisibilité, cohérence, conformité)

## S2.1 — Nettoyer `TODO.md` et supprimer `_helpers/PLAN_ACTIONS.md`

**Problème** : `TODO.md` contient des sections vides héritées (Bugs, Corrections immédiates) et référence un fichier `_helpers\PLAN_ACTIONS.md` qui n'existe plus. Le fichier `_helpers/PLAN_ACTIONS.md` actuel contient du contenu hérité d'un autre projet (Unity Asset Store).

### Étape S2.1.1 — Réécrire `TODO.md`

- [x] Sections "## Bugs" et "## Corrections immédiates" converties en placeholders structurés
- [x] Mise en intro de la référence au `_helpers/PLAN_ACTIONS.md` (qui est maintenant ce document)
- [x] Section "## Terminés" conservée avec l'historique des bugs résolus
- [x] Section "### Affichage (last:AFF02)" conservée avec les deux tickets ouverts

### Étape S2.1.2 — `_helpers/PLAN_ACTIONS.md`

- [x] Le contenu est déjà le plan d'action de publication (Sprints 1/2/3)

---

## S2.2 — Corriger les incohérences du README

**Problème** : le tableau providers en L.51-56 contient une information erronée (DeepSeek marqué "Proxied" alors qu'il a `imageInput: true`).

### Étape S2.2.1 — Corriger le tableau providers (L.51-56)

- [x] Modifié : DeepSeek "Proxied" reste (la vision est proxifiée pour tous), Xiaomi "Native" → "Proxied" (cohérence)
- [x] MiniMax "❌" → "✅ Proxied" (cohérent avec les autres)
- [x] Ajouté une note expliquant que `imageInput: true` active le bouton image dans Copilot mais que la vision est proxifiée

### Étape S2.2.2 — Synchroniser les settings

- [x] Ajouté à la table du README : `aiflowbridge.providers.minimax.temperature`, `topP`, `reasoningSplit`, `aiflowbridge.providers.xiaomi.reasoningRequiredForToolCalls`
- [x] Supprimé du README : `aiflowbridge.vision.enabled` (supprimé du code en S1.3)
- [x] Supprimé du README : référence à `aiflowbridge.vision.kiloVisionModel` (jamais persisté)
- [x] Corrigé `aiflowbridge.vision.excludedVendors` default dans README : `["deepseek"]` → `["aiflowbridge"]`

### Étape S2.2.3 — Vérifier la cohérence des exemples

- [x] L.136-141 (exemple Kilo Code) : modèles valides (`deepseek-v4-flash`, `minimax-v2.7`, `xiaomi-mimo-v2.5`)

---

## S2.3 — Mettre à jour AGENTS.md

**Problème** : AGENTS.md est obsolète — il référence l'ancienne structure de fichiers, l'ancien nom de projet ("provider" au lieu de "aiflowbridge"), et le titre "fork of deepseek-v4-for-copilot" n'est plus exact.

### Étape S2.3.1 — Mettre à jour l'overview

- [x] L.5 : remplacé par une description plus précise (multi-provider avec gateway OpenAI-compatible)
- [x] L.7 : "Fork of deepseek-v4-for-copilot, now significantly diverged" → "Originally forked from deepseek-v4-for-copilot, now significantly diverged"
- [x] L.8 : mainteneur conservé

### Étape S2.3.2 — Mettre à jour le File Structure (L.28-45)

- [x] Remplacé par la structure actuelle avec vision/, tools/, replay/, debug/, segment/
- [x] Ajouté consts.ts, auth.ts, config.ts, i18n.ts, logger.ts, extension.ts

### Étape S2.3.3 — Mettre à jour Key Architectural Decisions

- [x] L.53-55 : "deepseek" → "aiflowbridge (DeepSeek V4 Pro/Flash)"
- [x] L.64-70 (Vision Proxy) : section réécrite pour refléter le selector copilot/kilo et la fallback chain
- [x] L.73-79 (Gateway) : ajouté singleton mode, port configurable
- [x] Ajouté section "Logging" avec préfixes [AIFlowBridge]/[Gateway]/etc.

### Étape S2.3.4 — Mettre à jour Common Tasks

- [x] L.91-95 (Adding a New Provider) : ajouté étapes pour `src/aiflowbridge/providers.ts` et `EXTERNAL_URLS`
- [x] L.99-102 (Adding a New Model) : ajouté étapes pour `package.nls.json` et README.md

### Étape S2.3.5 — Important Files, Configuration, Testing, Notes

- [x] Important Files : ajout de logger.ts, i18n.ts
- [x] Configuration : clarifié vision.copilotVisionModel et gateway providers
- [x] Testing : `npm run test` → `npm test`, ajouté quality gates
- [x] Notes : ajout "Vision proxy is opt-out"

---

## S2.4 — Ajouter la commande `aiflowbridge.setVisionModel` au package.json

**Problème** : la commande est référencée dans `src/aiflowbridge/index.ts:123` et `src/runtime/provider.ts:42` mais on croyait absente de `package.json:contributes.commands`.

### Étape S2.4.1 — Vérification

- [x] `grep "aiflowbridge.setVisionModel" package.json` → déjà déclarée ligne 76-79 :
  ```json
  {
    "command": "aiflowbridge.setVisionModel",
    "category": "AIFlowBridge",
    "title": "AIFlowBridge: Set vision proxy model"
  }
  ```

**Note** : Le plan original mentionnait `aiflowbridge.providers.deepseek.setVisionModel` mais le code réel utilise `aiflowbridge.setVisionModel` (commande globale, pas spécifique à un provider).

---

## S2.5 — Nettoyer `.kilo/plans/` du tracking git

**Problème** : `1779780240537-crisp-planet.md` est tracké dans le repo. C'est de l'état interne de Kilo Code qui ne doit pas polluer l'historique git.

### Étape S2.5.1 — Untrack le fichier

- [x] `git rm --cached .kilo/plans/1779780240537-crisp-planet.md` exécuté
- [x] Ajouté `.kilo/` au `.gitignore`
- [ ] Commit : `chore: untrack Kilo internal plans` (à faire par l'utilisateur)

---

# 🟢 SPRINT 3 — MINEURS (polish de qualité)

## S3.1 — Renommer la constante `TODO_TRACKER_PREFIX`

**Problème** : dans `src/provider/debug/classifier.ts:12`, la constante `TODO_TRACKER_PREFIX` ressemble à un commentaire TODO mais c'est juste une chaîne métier ("You are a background task tracker").

### Étape S3.1.1 — Renommer

- [ ] `grep -n "TODO_TRACKER_PREFIX" src/` pour localiser toutes les références
- [ ] Renommer en `TASK_TRACKER_PREFIX` (ou `BACKGROUND_TRACKER_PREFIX`)
- [ ] Tester que les tests passent toujours

---

## S3.2 — Vérifier `release-please` config

### Étape S3.2.1 — Vérifier le manifest

- [ ] Ouvrir `.github/release-please-manifest.json`
- [ ] Vérifier que `".": "0.5.0"` correspond à la version actuelle
- [ ] Sinon, mettre à jour

### Étape S3.2.2 — Vérifier la config

- [ ] Ouvrir `.github/release-please-config.json`
- [ ] Vérifier `package-name: "aiflowbridge"`
- [ ] Vérifier `changelog-path` pointe vers `CHANGELOG.md`
- [ ] Vérifier le `release-type` (suggéré : `node` pour ce projet)

---

## S3.3 — Ajouter des tests manquants

**Couverture actuelle** : 197 tests sur 11 fichiers, pas de mesure de coverage.

### Étape S3.3.1 — Tests gateway (priorité haute)

- [ ] Créer `tests/gateway.test.ts`
- [ ] Tester :
  - `GET /health` retourne 200 + status JSON
  - `GET /v1/models` retourne la liste des providers configurés
  - `GET /v1/metrics` retourne les compteurs de télémétrie
  - `POST /v1/chat/completions` sans provider configuré → 503
  - `POST /v1/chat/completions` avec provider invalide → erreur propagée
  - `POST /v1/chat/completions` avec body JSON invalide → 400
  - Singleton detection : si port occupé et `/health` répond `ok:true service:"AIFlowBridge"` → réutilise

### Étape S3.3.2 — Tests providers normalisation (priorité haute)

- [ ] Créer `tests/aiflowbridge-providers.test.ts`
- [ ] Tester `normalizeProviderProfiles()` :
  - Tableau vide → []
  - Profils valides → conservés tels quels
  - Profils avec champs manquants → complétés avec défauts
  - Profils avec `kind` invalide → `openai-compat` par défaut
  - Profils désactivés → flag `enabled: false`
  - Validation de `id` (doublons, format)

### Étape S3.3.3 — Tests dashboard UI (priorité moyenne)

- [ ] Créer `tests/dashboard.test.ts`
- [ ] Tester le rendu HTML du dashboard (snapshot test)
- [ ] Tester le calcul des totaux/totaux par provider

### Étape S3.3.4 — Tests statusbar (priorité basse)

- [ ] Créer `tests/statusbar.test.ts`
- [ ] Tester la mise à jour du status selon l'état du gateway (running/stopped)

---

## S3.4 — Renommer `setVisionProxyModel` pour clarté

**Problème** : `setVisionProxyModel` est trompeur — c'est en fait une commande interactive pour choisir un modèle via quickPick, pas juste "set".

### Étape S3.4.1 — Renommer

- [ ] `grep -rn "setVisionProxyModel" src/` pour localiser les références
- [ ] Renommer en `chooseVisionProxyModel` (ou `pickVisionProxyModel`)
- [ ] Renommer la commande dans `package.json` si elle est exposée

---

## S3.5 — Mise à jour de la checklist pré-publication

**Note** : oxlint/oxfmt ne sont plus utilisés (paquets non installés, configs supprimées en S1.1.1).

### Étape S3.5.1 — Mettre à jour la checklist pré-publication

- [x] Supprimé les références à `npm run lint` et `npm run format:check` (n'existent plus)
- [x] Ajouté `npm run compile` et `npx vitest run` comme quality gates

### Étape S3.5.2 — Documenter le workflow (Sprint 3 optionnel)

- [ ] Dans le README (section "Development") :
  - `npm run compile` : compile TypeScript
  - `npm run watch` : watch mode
  - `npm test` : lance vitest
  - `npm run package` : produit le VSIX

---

# 📊 Inventaire — Verdict et métriques

## État actuel

| Critère                       | État                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| **Compilation TypeScript**    | ✅ OK, 0 erreur                                                                        |
| **Tests**                     | ✅ 197/197 passent (11 fichiers)                                                       |
| **Manifeste**                 | ✅ Complet (name, displayName, version, publisher, license, repository, engines, icon) |
| **Icône**                     | ✅ `resources/icon.png`                                                                |
| **LICENSE**                   | ✅ Fichier présent (MIT)                                                               |
| **CHANGELOG**                 | ✅ À jour                                                                              |
| **`.vscodeignore`**           | ✅ Correct                                                                             |
| **API keys**                  | ✅ `vscode.SecretStorage` (keychain OS)                                                |
| **i18n**                      | ✅ Synchronisé (`i18n.ts` ↔ `package.nls.json`)                                       |
| **Logger**                    | ✅ `vscode.LogOutputChannel`                                                           |
| **Vision proxy**              | ✅ Simplifié (Copilot uniquement)                                                      |
| **Gateway singleton**         | ✅ Détection port + join instance                                                      |
| **Walkthrough**               | ✅ `WALKTHROUGH_ID` configuré                                                          |
| **CI GitHub Actions**         | ✅ Corrigée (artefact `aiflowbridge.vsix`, `npm test` au lieu de lint/format inexistants) |
| **TODO.md**                   | 🟡 Sections vides, reférence fichier inexistante                                       |
| **\_helpers/PLAN_ACTIONS.md** | ❌ Contenu hérité Unity Store à supprimer                                              |
| **AGENTS.md**                 | 🟡 Structure obsolète                                                                  |
| **README.md**                 | 🟡 Tableau providers incorrect                                                         |
| **Couverture tests**          | 🟡 Pas de mesure, gros trous (gateway, UI)                                             |

## Verdict

**🟡 Sprint 1 terminé** — bloquants critiques résolus (CI corrigée, i18n synchronisé, settings nettoyés).

**🟡 Sprint 2 (polish) terminé** — README, AGENTS.md, TODO.md mis à jour, commande vision vérifiée, `.kilo/` untracké.

**🟢 Sprint 3 (mineurs) optionnel** — tests, renommages, doc.

## Estimation du temps par sprint

| Sprint       | Description                                         | Estimation     | Statut      |
| ------------ | --------------------------------------------------- | -------------- | ----------- |
| **Sprint 1** | Bloquants (CI, i18n, settings)                      | 1h30           | ✅ Terminé   |
| **Sprint 2** | Polish importants (README, AGENTS, TODO, commandes) | 1h30           | ✅ Terminé   |
| **Sprint 3** | Mineurs (tests, polish)                             | 2h (optionnel) | 🟢 À faire  |
| **Total**    |                                                     | **4-5h**       | ~66% fait   |

## Suggéré pour l'exécution

- **Session 1** : Sprint 1 (bloquants) → pousser sur main → vérifier que CI passe
- **Session 2** : Sprint 2 (polish) → vérifier que la VSIX se construit correctement via `npm run package`
- **Session 3** (optionnelle) : Sprint 3 (tests + mineurs) + publication effective

## Pré-publication (checklist finale)

Avant de publier, vérifier :

- [ ] `npm run compile` passe (0 erreur)
- [ ] `npx vitest run` passe (197/197)
- [ ] `npm run package` produit un VSIX valide
- [ ] Installer le VSIX localement via `code --install-extension dist/aiflowbridge-0.5.1.vsix`
- [ ] Tester l'activation (logs `[AIFlowBridge] activate...`)
- [ ] Tester la configuration d'une API key (DeepSeek, MiniMax, Xiaomi)
- [ ] Tester l'utilisation d'un modèle dans Copilot Chat
- [ ] Vérifier la CI GitHub Actions passe (après push sur main)
- [ ] Vérifier que le `publisher` "LaurentOngaro" est bien enregistré sur le marketplace
- [ ] Avoir un `VSCE_PAT` (Personal Access Token) prêt pour `npm run publish`
- [ ] Confirmer que `release-please-manifest.json` est à `0.5.1`
