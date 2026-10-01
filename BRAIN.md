# BRAIN.md — Mémoire du projet AIFlowBridge

> Journal partagé et fil rouge du projet. Ce fichier est la **mémoire commune**
> entre les agents IA (Kilo Code, Kilo CLI) et le mainteneur humain.
>
> ⚠️ **Ce dépôt est public** : ce fichier ne doit contenir QUE des informations
> techniques publiables. Voir « Règles de contenu » ci-dessous.

---

## Répartition des rôles (validée par l'utilisateur le 2026-10-01)

| Acteur                | Rôle      | Périmètre                                                                                                                                                                                                                             |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **l'agent IA** (Kilo) | Exécution | Conception, spécifications, code, docs, tests, audit, `npm install/build/test`, scripts, gateway, flux OAuth réel, backlog (`ACTION_PLAN.md`), branches et PR ; remonte des résultats **assainis** dans `BRAIN.md` / `ACTION_PLAN.md` |
| **l'utilisateur**     | Décideur  | Arbitrage, validation des décisions d'architecture, gestion des secrets locaux, revue finale                                                                                                                                          |

L'exécution est **mono-agent** depuis le 2026-10-01.
La répartition tech lead / exécutant qui existait auparavant est caduque : un seul agent couvre tout le cycle, de la conception à la PR.
Il n'y a donc **aucun échange inter-agents** : tout passe par `ACTION_PLAN.md` et `BRAIN.md`, et les arbitrages passent par la section « Questions / Blocages » adressée à l'utilisateur.

## Règles d'usage (obligatoires pour tout agent)

1. **Lire ce fichier et `ACTION_PLAN.md` au début de toute session de travail.**
2. **Mettre à jour le journal à la fin de toute tâche** (le hook `pre-commit`
   bloque par défaut tout commit qui ne touche ni `BRAIN.md` ni `ACTION_PLAN.md`).
3. Une entrée de journal = date, agent, action, résultat, liens éventuels.
   Rester concis et factuel.
4. Ne jamais réécrire l'historique du journal : on ajoute, on ne supprime pas
   (sauf erreur sensible, voir règles de contenu).
5. Les décisions nouvelles sont d'abord proposées dans le journal, puis
   consolidées dans « Décisions d'architecture » une fois validées par l'utilisateur.
6. **Aucun commit automatique :** Ne JAMAIS exécuter `git commit` sans demande explicite de l'utilisateur (ex: « fais le commit »). L'agent prépare le code, les tests et le journal, mais l'utilisateur conserve toujours la main sur la validation et l'historique git.

## Règles de contenu (dépôt public)

- ❌ Jamais de : tokens, clés API privées, codes OAuth secrets, cookies,
  emails privés, données personnelles, URLs internes/privées, montants de
  facturation détaillés.
- ✅ Autorisé : architecture, décisions techniques, état des tâches, erreurs
  assainies (sans secret), liens publics, noms de modèles et de providers.
- Toute note sensible va dans le canal privé `AIFlowBridge-Private`
  (`BRAIN-PRIVATE.md`) ; les vrais secrets restent locaux hors git (`.ai/`).
- **Exception documentée pour les credentials OAuth publics de l'AGY CLI**
  (le `client_id` et le `client_secret` sont embarqués dans le binaire
  officiel d'Antigravity, donc techniquement publics) : ils sont hardcodés
  dans `src/aiflowbridge/antigravity/constants.ts` et whitelistés via
  `.github/secret_scanning.yml` (`paths-ignore` + `custom_patterns`).
  Cette exception est signée par l'utilisateur le 2026-09-05 et ne s'applique
  qu'à ces 2 valeurs figées (toute autre valeur dans `constants.ts`
  doit rester hors versionné).
- En cas de doute : ne pas écrire, demander à l'utilisateur.

---

## État du projet (résumé courant)

- **Projet** : AIFlowBridge — assistant de code IA multi-providers pour VS Code,
  avec proxy vision, métriques d'usage et **gateway locale OpenAI-compatible
  déjà fonctionnelle** (CLI `aiflowbridge-server`).
- **Providers actuels** : MiniMax, Xiaomi MiMo, DeepSeek (picker Copilot Chat) ;
  OpenRouter, Google AI Studio (BYOK), Z.ai GLM, MoonshotAI Kimi (passerelle
  seule) ; + gateway openai-compat/ollama générique. 38 entrées bundleées au
  snapshot 2026-10-01 (2.19.1).
- **Chantier actif** : provider Antigravity / Google Cloud Code Assist afin
  d'utiliser Gemini via le compte Google AI Pro dans Kilo CLI, en parallèle
  de MiniMax-M3 via le plan MiniMax.
- **Spec d'implémentation** : `docs/plans/antigravity-gateway-integration-spec.md`
  (AP-007, remplace le plan initial `antigravity-provider-kilo-cli.md`).

## Décisions d'architecture (validées)

| Date       | Décision                                                                                                                                                                                                 | Motif                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Passerelle locale OpenAI-compatible plutôt que plugin Kilo natif                                                                                                                                         | Réutilisable, isole le risque des endpoints Antigravity, préserve le provider MiniMax officiel                                                                                                                                                                                                                                                                                                                          |
| 2026-09-02 | Mémoire publique `BRAIN.md` + canal privé `AIFlowBridge-Private` + secrets locaux hors git                                                                                                               | Seul canal commun entre agents et mainteneur ; dépôt public donc contenu assaini                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-02 | Hooks git versionnés dans `.githooks/` + `core.hooksPath`                                                                                                                                                | Partage des hooks via le dépôt                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-09-02 | Hook pre-commit : pull obligatoire + mise à jour du journal                                                                                                                                              | Éviter toute perte de modifications, journal incontournable                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-02 | Répartition des rôles : tech lead / exécutant local / l'utilisateur décideur (**caduque depuis le 2026-10-01**, exécution mono-agent)                                                                    | Historique : maximiser l'autonomie, ne déléguer que l'exécution                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-02 | Antigravity = nouveau `ProviderKind` dans la gateway existante (pas de nouvelle passerelle)                                                                                                              | La gateway OpenAI-compatible existe et vise déjà Kilo Code (audit du 2026-09-02)                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-04 | Mode de facturation par profil `billing: 'token' \| 'plan'` + `RequestTelemetry.billedTo`                                                                                                                | Distinguer coût réel au token (BYOK) d'équivalent plan (OAuth AGY, MiniMax token plan) ; le dashboard marque `plan` avec badge + tooltip + notice                                                                                                                                                                                                                                                                       |
| 2026-09-04 | Voie BYOK Gemini comme défaut, OAuth AGY opt-in pour comptes whitelistés Cloud Code Assist                                                                                                               | Quota AI Studio Pro indépendant du quota Cloud Code Assist (`aicode-consumers` lockout personnel) ; BYOK `AIzaSy...` ne dépend d'aucune whitelist                                                                                                                                                                                                                                                                       |
| 2026-09-05 | Surface Gemini native `:streamGenerateContent?alt=sse` préférée à `/openai/chat/completions` sur la voie BYOK                                                                                            | La surface OpenAI-compat est feature-gated par projet GCP, retourne 429 quota=0 si non activée ; la native est toujours dispo et permet les free-tier Gemini                                                                                                                                                                                                                                                            |
| 2026-09-05 | Commande `AIFlowBridge: Switch Google AI Studio route` toggle baseUrl + nettoie les credentials de la voie inactive                                                                                      | Évite le piège "override silencieux" `globalStorage/models.json` qui forçait OAuth en local ; couplé au runtime avec `resetGlobalStorageRegistryOverride`                                                                                                                                                                                                                                                               |
| 2026-09-05 | Les credentials OAuth publics de l'AGY CLI (`client_id` + `client_secret`) sont hardcodés dans `src/aiflowbridge/antigravity/constants.ts` avec bypass `paths-ignore` dans `.github/secret_scanning.yml` | Ces credentials sont identiques à ceux embarqués dans le binaire Antigravity officiel de Google (extractibles depuis `~/.config/google/antigravity/credentials.json`). Sans eux, la voie OAuth AGY ne fonctionne pas out-of-the-box. Le whitelisting est documenté dans `.github/secret_scanning.yml` et expliqué dans le commentaire d'en-tête de `constants.ts`. Tous les autres secrets restent exclus du versionné. |
| 2026-09-05 | Parser de contenu partagé `content-parts.ts` sans import `vscode`, avertissements image injectés par l'appelant                                                                                          | `content-parts.ts` reste unit-testable sous vitest (pas de paquet `vscode` hors extension) ; `toGeminiNativeRequest` / `toAntigravityEnvelope` acceptent un sink `warn` optionnel, la gateway passe `logger.warn`, les tests omettent le sink                                                                                                                                                                           |
| 2026-09-05 | Streaming Gemini temps réel par défaut (`pipeThrough`), drain conservé en fallback, flag `bufferGeminiStream` défaut `false`                                                                             | Restaure le TTFT pré-2.17.0 sans réintroduire la perte d'octets (flush résiduel intact) ; repli drain sur erreur de pipe ; opérateur sur lien lossy peut forcer le buffer via `aiflowbridge.gateway.bufferGeminiStream: true`                                                                                                                                                                                           |
| 2026-09-05 | Résolveur de route effective settings > workspace > globalStorage > bundle pour le switcher Google AI Studio                                                                                             | Le toggle décidait sur le seul setting et pouvait pointer à l'envers face à un override stale ; la décision porte désormais sur l'URL effective, nettoie les deux overrides, nomme la source dans le toast                                                                                                                                                                                                              |

## Contraintes et préférences

- Préférence pour les coûts déjà inclus dans des plans existants (Google AI Pro,
  MiniMax Token Plan) plutôt que la facturation API au token.
- Préférence pour les setups BYOK et la facturation directe chez le provider.
- Stack : TypeScript, extension VS Code, mode standalone Node.js.
- Langue de travail : français pour la documentation projet, anglais pour le code.

## Contexte technique clé — état consolidé après la 2.17.0

### Gateway standalone (déjà fonctionnelle)

- `src/aiflowbridge/gateway/server.ts` : `GatewayService`, serveur `node:http`.
  Routes : `/version`, `/health`, `/metrics`, `/v1/metrics`, `/v1/models`,
  `/v1/discovery`, `/v1/events` (SSE télémétrie), `/v1/replay/{id}`, `/v1/context`,
  `POST /v1/chat/completions`, `POST /shutdown`. Bind `127.0.0.1` ; clé locale
  `sk-aiflowbridge-local`. Clients documentés : **Kilo Code**, Continue, curl,
  Open WebUI.
- Orchestrateur `forwardChatCompletion` → `readAndValidateBody` /
  `resolveChatProvider` (`selectProviderWithLanguage`, routage par langue) /
  `buildUpstreamRequest` (URL, clé, headers, traduction payload, injection
  contexte workspace, override du modèle).
- Streaming : drain de l'upstream → application du transform SSE natif/AGY →
  replay via `Readable.fromWeb`. Voir audit v2 BUG-17 (régression temps-réel,
  fix prévu dans la 2.18.0).
- Clés : env `AIFLOWBRIDGE_<VENDOR>_API_KEY` → `secrets.json` (chmod 600) →
  `SecretStorage` (VS Code) ou `~/.aiflowbridge/secrets.json` (standalone) →
  commande VS Code ; warning unique si absente (sauf `ollama`).
- Erreurs : `sanitizeUpstreamErrorMessage()` (retire query string + credentials
  des 502), `redactProviderForLog()` (`apiKeyPresent`).
- Standalone : binaire `aiflowbridge-server`, config
  `~/.aiflowbridge/config.json` hot-reload, build `npm run build:standalone`,
  `IGatewayContext` + `vscode-context-adapter.ts` + shim `vscode-shim.ts`.

### Providers (deux chemins d'exposition)

1. **Copilot Chat (VS Code LM API)** : `vscode.LanguageModelChatProvider` —
   `BaseChatProvider`, MiniMax, Xiaomi, DeepSeek, `UnifiedChatProvider` ; clés
   en SecretStorage (`API_KEY_SECRETS`, `src/consts.ts`). Gemini absent (AP-013).
2. **Gateway** : `ProviderProfile { id, label, kind, model, baseUrl, billing? }`,
   `ProviderKind = 'openai-compat' | 'ollama' | 'antigravity'` ; registry 3 tiers
   (`resources/models.json` < globalStorage < workspace) ; checklist vendor dans
   `docs/agent-instructions/tasks.md` ; `VENDOR_ALIASES` (`api-key-resolver.ts`),
   `VENDOR_CHOICES`/`VENDOR_LABELS` (`addCustomModel.ts`).
3. **Path B, vendors passerelle seule** (depuis 2.12.0) : `openrouter`,
   `googleaistudio` (voie BYOK), `zai` (GLM 5.3) et `moonshot` (Kimi K3) depuis
   2.19.0. Aucune classe `vscode.LanguageModelChatProvider` : le catalogue
   passerelle est produit par `synthesizeProvidersFromBuiltInModels` à partir du
   registry, et le seul registre de clé nécessaire est `API_KEY_SECRETS`. Un
   vendor Path B a malgré tout besoin de la paire `setApiKey` / `clearApiKey`
   pour avoir un point d'entrée UI, sans quoi la clé n'est saisissable que via
   `secrets.json` ou une variable d'environnement. Ajouter un vendor Path B
   implique **5 zones** non vérifiées à la compilation, chacune avec un test :
   `KNOWN_FAMILIES`, `models.schema.json` (enum), `package.json` (enum
   `userModels`), `SECRET_KEY_TO_ENV_NAME`, `SECRET_SHORT_TO_FULL`.

### Intégration Gemini / Antigravity (spec AP-007 + audits 2026-09-05 v1 et v2)

- **Deux voies distinctes** pour le même vendor `googleaistudio` :
  - **BYOK native** (`kind: 'openai-compat'` sur
    `generativelanguage.googleapis.com/v1beta`) : clé `AIzaSy...` via
    `x-goog-api-key` header, surface `:generateContent` (REST) ou
    `:streamGenerateContent?alt=sse` (SSE). Translation OpenAI ↔ Gemini
    native dans `src/aiflowbridge/antigravity/gemini-native.ts`. Default pour
    Gemini 3.6 / 3.7 / 3.8 Flash avec prix public `$0.30 / $2.50` par 1M (USD).
  - **Antigravity OAuth** (`kind: 'googleaistudio'` sur
    `cloudcode-pa.googleapis.com`) : tokens OAuth + PKCE, surface
    `v1internal:streamGenerateContent?alt=sse` avec enveloppe AGY
    (`{project, model, request, requestType, userAgent, requestId}`) et
    transform SSE dédié. Billing forcé à `plan` ; token dans `secrets.json`
    sous la clé `antigravity` (alias `googleaistudio` historique nettoyé).
  - Commande `aiflowBridge.switchGoogleAIStudioRoute` bascule les deux avec
    cleanup credentials + override globalStorage.
- **Modules purs** sous `src/aiflowbridge/antigravity/` : `constants.ts`,
  `types.ts`, `pkce.ts`, `envelope.ts` (AGY), `sse-transform.ts` (AGY),
  `token-store.ts`, `auth.ts`, `project.ts`, `catalog.ts`, `gemini-native.ts`
  (BYOK), `index.ts`, `googleai-studio-route.ts` (route switcher).
- **Bugs résolus (audit v1) :** BUG-01 (`x-goog-api-key`), BUG-02 (override
  cleanup), BUG-03/04 (`functionCall` streaming + non-streaming),
  BUG-05 (BYOK default), BUG-07 (env mapping), BUG-08 deferred,
  BUG-09 (init order), BUG-10 (finish_reason mapping), BUG-11 (token alias
  cleanup).
- **Bugs ouverts (audit v2) :** BUG-13 (role alternation user→user sur tool
  results parallèles), BUG-14 (vision stipee sur BYOK), BUG-15 (finish_reason
  = "stop" au lieu de "tool_calls"), BUG-16 (switcher ignore override
  globalStorage), BUG-17 (streaming temps-réel cassé par le drain),
  BUG-06 (lockout `aicode-consumers` pour comptes non whitelistés).
  Détail complet dans `_Private/archives/2026-09-05-gemini-integration-audit.md` §6 (archivé le 2026-09-05 : contient email, project id et chemins locaux).
- **Documentation à actualiser (audit v2 §6.3) :** `docs/providers.md` lignes
  90/92/113 + `README.md:26` version pin à `2.15.7`.

## Liens utiles

- Spec d'intégration (active) : `docs/plans/antigravity-gateway-integration-spec.md`
- Audit Gemini (v2, archivé) : `_Private/archives/2026-09-05-gemini-integration-audit.md`
- Plan initial (historique) : `docs/plans/antigravity-provider-kilo-cli.md`
- Zone d'échange opérationnelle : `ACTION_PLAN.md`
- Règles agents Kilo : `.kilocode/rules/00-brain-protocol.md`
- Canal privé : dépôt `AIFlowBridge-Private` → `BRAIN-PRIVATE.md`

---

## Journal (plus recent en haut)

> Note : ce journal a été compacté le 2026-09-05 avant handoff vers une nouvelle
> session. Les entrées redondantes de micro-débogage (x-goog-api-key, finish_reason,
> streaming drain, etc.) sont remplacées par les références aux **BUG-01..17 de
> l'audit v2** dans « Contexte technique clé → Intégration Gemini / Antigravity ».
> Les entrées ci-dessous documentent les **décisions architecturales** et les
> **jalons de release**, qui restent utiles pour la mémoire long terme du projet.

### 2026-10-01 - Antigravity (Clôture et nettoyage des questions/blocages de l'ACTION_PLAN)

Nettoyage de la section « Questions / Blocages » de `ACTION_PLAN.md` :

- Confirmation que la base URL Z.ai `paas/v4` fonctionne en production (testé par l'utilisateur avec succès).
- Clôture de l'arbitrage de release (minor 2.19.0 et patch 2.19.1 livrés).
- Statut MiMo v2.6 clarifié avec l'auto-routage `sk-*` validé sur `api.xiaomimimo.com`.
- MiniMax M3.1 stabilisé sans pricing (réservé M Plan).

### 2026-10-01 - Antigravity (Interdiction stricte de tout commit automatique par les agents)

Mise à jour formelle des instructions pour interdire catégoriquement tout commit automatique :

- **Documents mis à jour** : `AGENTS.md` (règle obligatoire sous *Project memory and workflow*), `docs/agent-instructions/tasks.md` (section dédiée *Committing*), `.kilocode/rules/00-brain-protocol.md` (section *Règles sur les commits*) et `BRAIN.md` (règle d'usage 6).
- **Règle absolue** : Les agents IA ne doivent JAMAIS exécuter `git commit` de leur propre initiative. Seul l'utilisateur décide du moment de commiter ou donne une consigne explicite (ex: « fais le commit »). La réussite des tests, la fin d'une tâche ou la préparation de la documentation ne valent en aucun cas autorisation de commiter.

### 2026-10-01 - Antigravity (Release patch 2.19.1 et actualisation du CHANGELOG)

Publication du correctif patch 2.19.1 :

- **Version** : passage en 2.19.1 dans `package.json` et `package-lock.json`.
- **CHANGELOG.md** : ajout de la section `## 2.19.1` documentant la résolution des erreurs 401 sur Xiaomi MiMo via l'auto-routage intelligent par préfixe de clé (`sk-*` vers `https://api.xiaomimimo.com/v1`, `tp-*` vers `https://token-plan-ams.xiaomimimo.com/v1`).
- **Documentation** : synchronisation des métadonnées de version (2.19.1) dans `README.md`, `docs/cost.md`, `docs/architecture.md` et `docs/providers.md`.

### 2026-10-01 - Antigravity (Fix Xiaomi MiMo : auto-routage des clés Pay-as-you-go sk-*vs Token Plan tp-*)

Correction du bug 401 "Invalid API Key" rencontré avec les clés Xiaomi MiMo standard :

- **Cause racine** : Xiaomi sépare strictement ses clusters d'API : les clés standard Pay-as-you-go (`sk-*`) sont valides uniquement sur `https://api.xiaomimimo.com/v1`, tandis que les clés de forfaits Token Plan (`tp-*` ou `ttp-*`) sont valides uniquement sur les clusters Token Plan (ex: `https://token-plan-ams.xiaomimimo.com/v1`). Le catalogue bundle utilisait `token-plan-ams.xiaomimimo.com`, rejetant silencieusement les clés `sk-*` avec un HTTP 401 d'invalidité de clé.
- **Solution implémentée** : création de `resolveXiaomiBaseUrl` dans `src/config.ts` et intégration dans `resolveUpstreamUrl` (passerelle gateway) ainsi que dans `XiaomiChatProvider.sendRequest` (Copilot Chat direct). L'auto-routage inspecte le préfixe de la clé résolue : si la clé commence par `sk-*` et que l'URL cible un cluster `token-plan-*.xiaomimimo.com`, elle est automatiquement redirigée vers `https://api.xiaomimimo.com/v1` ; inversement, si la clé commence par `tp-*`/`ttp-*` et que l'URL est `api.xiaomimimo.com`, elle bascule sur `token-plan-ams.xiaomimimo.com`. Les relais privés personnalisés hors domaine `xiaomimimo.com` sont préservés intacts.
- **Tests** : 5 tests unitaires ajoutés dans `tests/config.test.ts` et assertions ajoutées dans `tests/gateway.test.ts`. 73 suites de tests sur 73 réussies (1 214 tests).

### 2026-10-01 - Kilo (Worktree V2, Bump mineur 2.19.0, Changelog Keep-a-Changelog et actualisation complète README / docs)

Finalisation et documentation dans le worktree dédié `.kilo/worktree/model-catalog-refresh-V2` (branche `feat/model-catalog-refresh-v2`), sans altération des worktrees existants.
Dépendances installées via `npm ci` dédié (garantit la compatibilité du packaging vsce sans symlink).
Bump mineur 2.19.0 consolidé (`package.json`, `package-lock.json`).

Livrables réalisés sur cette étape :

- **`CHANGELOG.md`** : restructuré selon la convention Keep a Changelog avec sections explicites `Breaking Changes` (retrait de `deepseek-v4-flash` au profit de `deepseek-flash`, renommage `deepseek-pro` en `deepseek-v4-pro`, purges des modèles obsolètes M2/M2.1/M2.5/MiMo-V2-omni/pro), `Added` (vendors `zai` et `moonshot`, MiMo V2.6 suite, DeepSeek V4.1 Flash, MiniMax M3.1 Flash Preview, 15 modèles OpenRouter free récents, smoke tests), `Changed` (catalogue étendu à 38 modèles, gestion du thinking obligatoire), `Fixed` (label toast i18n pour Google AI Studio).
- **`README.md`** : refonte du bandeau de nouveautés v2.19.0 (mise en avant de Z.ai GLM 5.3 et MoonshotAI Kimi K3, 38 modèles au catalogue, 15 modèles free), intégration des clés Z.ai / Moonshot dans le Quick Start (commandes VS Code et variables d'env), actualisation du comparatif de coûts (MiMo V2.6 Flash à 0.05 $/M in, GLM 5.3 Flash à 0.15 $/M in), mise à jour des commandes et du bloc Roadmap / Historique de release.
- **`docs/cost.md`** : horodatage et version portés à `2026-10-01 / 2.19.0`, intégration des grilles tarifaires indicatives des 7 familles de modèles (incluant Z.ai GLM et MoonshotAI Kimi), simulation de dépenses mensuelles actualisée avec MiMo V2.6 Flash et GLM 5.3 Flash, volume de catalogue synchronisé à 38 modèles.
- **`docs/providers.md`** : métadonnées snapshot portées au 2026-10-01 (AIFlowBridge 2.19.0) et mention des 15 modèles OpenRouter free.
- **`docs/gateway.md`** : exemples de routage linguistique (`deepseek-v4-pro`), exemples de configuration Kilo Code rafraîchis avec les modèles actuels, mention des 38 modèles synthétisés.
- **`docs/reasoning.md`** : ajout d'une section sur les modèles à raisonnement non désactivable (Z.ai GLM 5.3 et MoonshotAI Kimi) et recommandation de paramétrage `reasoning_effort` (`low`/`high`/`max`) pour éviter les rejets HTTP 400.
- **`docs/jetbrains-continue.md`**, **`docs/dashboard.md`**, **`docs/architecture.md`**, et guides agents (`docs/agent-instructions/`) : alignement des identifiants réels (`deepseek-flash`, etc.), suppression des références résiduelles aux anciens modèles purgés.
- **Style et validation** : un paragraphe physique par paragraphe markdown, aucun caractère em-dash ou en-dash (ASCII `-`), guillemets ASCII, diacritiques françaises préservées. Suite de tests validée (73 fichiers, 1 209 tests réussis), typecheck OK, exécutable autonome standalone et package VSIX générés avec succès.

### 2026-10-01 - Kilo (Minor 2.19.0 : rafraîchissement du catalogue + vendors passerelle seule zai / moonshot)

Implémentation du plan `.kilo/plans/1790836404534-model-catalog-refresh.md` dans le worktree `../AIFlowBridge-model-catalog-refresh` (branche `feat/model-catalog-refresh`).

**Gate T0 (partiel, à lire avant toute décision).** Les variables d'environnement `ZAI_KEY` / `MOONSHOT_KEY` / `XIAOMI_KEY` / `DEEPSEEK_KEY` / `MINIMAX_KEY` / `GEMINI_KEY` n'existaient pas sur cette machine, donc les `curl` authentifiés du gate n'ont pas pu être joués.
Ce qui a pu être vérifié l'a été, contre la source :

- **OpenRouter** (API publique, sans clé) : `GET /api/v1/models` renvoie 462 modèles dont **16 ids `:free`**. 3 des 7 ids bundleés sont toujours présents (`nvidia/nemotron-3-ultra-550b-a55b:free`, `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free`), 4 ont quitté le free tier (`openai/gpt-oss-120b`, `meta-llama/llama-3.3-70b-instruct`, `qwen/qwen3-coder`, `qwen/qwen3-next-80b-a3b-instruct`) et 12 sont nouveaux. `nvidia/nemotron-3.5-content-safety:free` a été **exclu** de la liste bundleée : c'est un classifieur guardrail, pas un modèle de chat. Le bloc free est reconstruit à chaque refresh car ce tier tourne.
- **Z.ai** (`docs.z.ai`) : `glm-5.3`, `glm-5.3-flash`, `glm-5.3-flashx` confirmés, 1M de contexte, sortie max 128K, thinking non désactivable, `reasoning_effort` `low`/`high`/`max` défaut `max`, prix 1.4/4.4, 0.15/0.50, 0.37/1.25. **Base URL : la doc officielle est ambiguë** - le tableau "How to Use" annonce `https://api.z.ai/api/coding/paas/v4` pour le protocole Chat Completion, mais les 3 exemples de code (cURL, SDK Python, SDK OpenAI) utilisent tous `https://api.z.ai/api/paas/v4`. Le registry prend `paas` (pay-as-you-go) ; un abonné GLM Coding Plan doit basculer via `aiflowbridge.providers.zai.baseUrl`. À trancher avec une vraie clé.
- **MoonshotAI** (`platform.kimi.ai`) : `kimi-k3` (1 048 576 de contexte, `max_completion_tokens` 131072 par défaut et jusqu'à 1048576, vision image+vidéo, thinking toujours actif, 3.00/15.00), `kimi-k2.7-code` et `-highspeed` (262 144 de contexte, thinking non désactivable, `tool_choice` `auto`/`none` seulement, `temperature` 1.0 / `top_p` 0.95 / `n` 1 / pénalités 0 **figés**, 0.95/4.00 et 1.90/8.00), `kimi-k2.6` (262 144, seul modèle courant qui accepte le mode non-thinking, 0.95/4.00). Les séries `kimi-k2` (arrêtées le 2026-05-25), `kimi-k2.5` et `moonshot-v1` (arrêtées le 2026-08-31) sont retirées par le plan et le smoke test le vérifie.
- **DeepSeek** (`api-docs.deepseek.com`) : `deepseek-flash` est bien l'id amont de V4.1-Flash, 1M de contexte, sortie max 384K, vision oui, thinking activé par défaut, tarifs peak 0.30/1.20. `deepseek-v4-pro` = V4-Pro-0813, 1M, 384K, **pas de vision**, peak 1.32/3.96. La doc confirme que `deepseek-v4-flash` et `deepseek-v4-flash-vision-exp` restent acceptés mais sont servis par V4.1-Flash.
- **MiniMax** (`platform.minimax.io`) : `MiniMax-M3.1-Flash-Preview` existe (1M, multimodal, profondeur de raisonnement réglable) mais **uniquement via M Plan et MiniMax Code**. M2 / M2.1 / M2.1-highspeed / M2.5 / M2.5-highspeed sont listés en "Legacy Models" par l'amont, ce qui confirme la purge. **Aucun tarif pay-as-you-go n'est publié pour M3.1** : l'entrée du registry est donc déclarée **sans bloc `pricing`**, et une clé Token Plan legacy recevra un 403.
- **Non vérifié** : les ids `mimo-v2.6-flash` / `mimo-v2.6-pro` / `mimo-v2.6-pro-ultraspeed` (le endpoint MiMo renvoie 401 sans clé et `platform.xiaomimimo.com` est une SPA sans doc lisible) et les alias `gemini-flash-latest` / `gemini-flash-lite-latest` (les pages `ai.google.dev` n'ont pas pu être récupérées). Ces 5 ids viennent du plan et sont donc **déclarés mais non confirmés**. Le préfixe `mimo` de `VENDOR_ALIASES.xiaomi` matche les 3 ids MiMo quelle que soit leur casse (le matcher compare sur `lowered`), donc une erreur de casse ne casserait pas la résolution de clé ; en cas de 404 amont, corriger l'id ou passer par `aiflowbridge.providers.<vendor>.modelIdOverrides`.

**Rupture assumée.** `deepseek-v4-flash` sort du catalogue bundle (l'id amont réel est `deepseek-flash`) et l'id de catalogue `deepseek-pro` devient `deepseek-v4-pro`.
Une config cliente qui épingle l'un des deux reçoit `503 No gateway provider matches model`.
C'est une raison de passer en **minor 2.19.0** et non en patch.

**Autres points non triviaux.**

- `KNOWN_FAMILIES` (`modelRegistry.schema.ts`) n'est **pas** vérifié à la compilation : une famille non déclarée fait tomber l'entrée en fail-soft (un `warn` dans les logs, le modèle disparaît du catalogue, aucune erreur visible). `SECRET_KEY_TO_ENV_NAME` et `SECRET_SHORT_TO_FULL` (`api-key-sources.ts`) ne sont pas vérifiés non plus : une omission rend la variable d'env silencieusement ignorée (cf BUG-07 pour Google AI Studio). T3 et T4 du plan traitent ces deux zones, chacune avec un test dédié.
- L'ordre du tableau `models` dans `resources/models.json` est l'ordre de synthèse du catalogue passerelle, et `tests/host-config.test.ts` épingle `gemini-3.8-flash` comme première entrée synthétisée. Les nouveaux modèles sont donc ajoutés en fin de tableau, sauf les 2 alias Gemini `-latest` placés juste après le bloc `gemini-3.x` (l'invariant "3.8 en premier" reste respecté).
- `provider.googleaistudio.name` manquait dans `src/i18n.ts` alors que `src/runtime/provider.ts` l'appelle via `t()` : les toasts des commandes de clé Google AI Studio affichaient le littéral de la clé. Corrigé au passage, et les 3 vendors sans classe provider (googleaistudio BYOK, zai, moonshot) passent maintenant par un helper `registerApiKeyCommands` commun au lieu de 3 blocs inline dupliqués.
- `maxOutputTokens` n'est consommé que par le chemin Copilot Chat (`src/config.ts`), pas par la synthèse passerelle : pour les vendors Path B c'est de la métadonnée d'affichage, donc les valeurs non publiées par l'amont (série Kimi K2.7) n'ont aucun risque de troncature.

**Portée de la release.** Le picker Copilot Chat reste inchangé (DeepSeek / MiniMax / Xiaomi uniquement, cf AP-013) : `zai` et `moonshot` sont Path B, visibles dans le dashboard et `GET /v1/models` uniquement.

**Documentation T8 finalisée.** Ajout des sections dédiées Z.ai GLM et MoonshotAI Kimi dans `docs/providers.md`, mise à jour du tableau OpenRouter avec les 15 modèles free réels, affinement du compte de modèles Copilot Chat directs (11 modèles), exemple standalone mis à jour avec `zai.apiKey` et `moonshot.apiKey`, et tests unitaires `tests/api-key-resolver.test.ts` étendus avec les 4 cas et le non-leak OpenRouter (14 tests au total).

### 2026-09-05 — Kilo (Bug : Muse spark 1.3 (id OpenRouter) 401 "No cookie auth credentials found")

L'utilisateur a sélectionné `meta/muse-spark-1.3` (ajouté via `aiflowbridge.userModels` avec `family: "openrouter"`) et a obtenu un 401 `No cookie auth credentials found` sur `http://127.0.0.1:8787/v1/chat/completions`.
Cause racine : `resolveVendorApiKey` matche uniquement les IDs commençant par `openrouter-` (préfixe canonique AIFlowBridge) ou par le vendor canonique (`openrouter` exact).
Les IDs upstream OpenRouter sont `<provider>/<model>` (`meta/muse-spark-1.3`, `openai/gpt-oss-120b:free`, `anthropic/claude-opus-4.8`, `mistralai/mistral-large-2512`, ...).
Le préfixe `meta/` n'est pas un vendor AIFlowBridge, donc `resolveVendorApiKey` retournait `undefined`, la requête partait sans clé `Authorization`, OpenRouter rejetait avec 401.
Le 401 upstream confirme (`Missing Authentication header` en curl direct sur `https://openrouter.ai/api/v1/chat/completions` sans clé).
Fix : `resolveVendorApiKey` reçoit un family-fallback : si aucun vendor connu ne matche l'ID et que l'ID contient un `/`, retourner la clé OpenRouter.
Couvre les 100+ ids OpenRouter avec leurs préfixes upstream arbitraires.
Les vendors directs (DeepSeek / MiniMax / Xiaomi / Gemini BYOK) gardent leurs clés dédiées (pas de slash par défaut, ou alias préfixé connu).
Tests : `tests/api-key-resolver.test.ts` étendu de 9 à 12 (3 nouveaux : family fallback, non-leak vers OpenRouter, secret OpenRouter manquant).
Gates : compile OK, 71 fichiers / 1180 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).

### 2026-09-05 — Kilo (Coverage thought_signature en debug : le 100% MISSING reste un 200)

L'utilisateur rapporte un dernier warning `36/36 MISSING` qui aboutit quand même en 200 : l'upstream accepte en pratique les bursts first-turn sans signature préalable.
Le warn systématique est donc du bruit même à 100%.
Fix : `logThoughtSignatureCoverage()` passe entièrement en `debug` (plus aucun warn). La ligne reste disponible pour diagnostiquer un vrai 400 sans alarmer sur les turns sains.
Valeurs jamais loggées, inchangé.
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).

### 2026-09-05 — Kilo (Coverage partielle tolérée : warn seulement si 100% MISSING)

L'utilisateur confirme que ça fonctionne malgré les warnings : le log montre des couvertures partielles (`1/3`, `2/4`, `2/7` MISSING) qui aboutissent toutes en 200.
L'upstream tolère donc les turns rejoués où seules certaines calls portent une signature (les first-time calls n'en ont jamais eu).
Le warn à chaque requête partielle est du bruit qui masque les vrais problèmes.
Fix : `logThoughtSignatureCoverage()` ne warn qu'en cas de 100% MISSING (rejet 400 quasi-certain) ; couverture partielle et complète passent en debug.
Valeurs jamais loggées, inchangé.
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).

### 2026-09-05 — Kilo (Fix racine du 400 thought_signature : shape sibling + snoop streaming + log coverage)

Le 400 persistait malgré le cache opt-in pour deux raisons cumulées, confirmées par le log coverage (`3/3 functionCall parts MISSING signature [read:MISSING...]`) :

1. Le cache n'était alimenté que sur le chemin non-streaming alors que Kilo streame toujours (`streaming=true` sur toutes les requêtes du debug.log).
2. Erreur de shape : la gateway envoyait `thoughtSignature` comme ENFANT de `functionCall` (`{ functionCall: { name, args, thoughtSignature } }`), alors que l'API Gemini l'attend en SIBLING sur la part (`{ functionCall: { name, args }, thoughtSignature: "..." }`). L'API ignorait silencieusement le champ mal placé, puis rejetait avec 400. Le protocole natif Kilo (`gemini.ts`) confirme le shape sibling (`part.thoughtSignature`), tout comme la doc `thought-signatures` (signature sibling de functionCall/functionResponse).
Fix : `GeminiNativeRequest` + `GeminiNativeResponse` + les 3 parseurs streaming natifs passés au shape sibling ; `toGeminiNativeRequest` / `fromGeminiNativeResponse` / transforms émettent et lisent le sibling ; tests migrés (fixtures corrigées : ordre crochets `}]}},` + shape sibling) ; snoop passif des chunks streaming + `logThoughtSignatureCoverage()` inchangés (déjà sibling-aware).
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).
Pour vérifier : recharger, relancer la tâche Kilo, chercher `thought_signature coverage` : `sig` partout = la signature part au bon shape et le 400 doit disparaître.

### 2026-09-05 — Kilo (Fix racine du 400 thought_signature : snoop streaming + log coverage)

Le 400 persistait malgré le cache opt-in parce que (1) le cache n'était alimenté que sur le chemin non-streaming alors que Kilo streame toujours (`stream: true`), et (2) aucun log ne montrait si la signature partait vraiment vers l'amont.
Analyse du debug.log utilisateur (assaini) : activation 2.18.2 OK, registry OK, OAuth connecté, gateway redémarrée sur 8787. Séquence : 400 initial, puis 200, puis 400 à nouveau.
Le 200 intermédiaire prouve que le pass-through fonctionne quand la signature est présente ; le 400 suivant prouve que le cache ne l'a pas ré-injectée (vide car jamais alimenté en streaming).
Fix : (a) snoop passif des chunks OpenAI sur le chemin streaming `pipeThrough` quand le flag est actif (parse `data:` frames, stocke `id` + `extra_signature`, jamais loggé, jamais bloquant, zéro overhead quand flag off) ; (b) `logThoughtSignatureCoverage()` sur les deux builders (BYOK natif + AGY) : log `warn` avec `nom:sig|MISSING` par functionCall quand au moins un manque, `debug` quand complet.
Valeurs jamais loggées.
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).
Pour vérifier : recharger la fenêtre, relancer la tâche Kilo, ouvrir "AIFlowBridge: Show logs", chercher `thought_signature coverage` : `MISSING` = le client n'a rien envoyé et le cache était vide ; `sig` partout = la signature part et le 400 doit disparaître.

### 2026-09-05 — Kilo (Analyse poussée alternatives au cache opt-in + implémentation)

L'utilisateur a demandé une analyse poussée des alternatives au cache gateway opt-in avant d'implémenter.
Analyse effectuée :

- Kilo Code CLI (`packages/llm/src/protocols/openai-chat.ts`) : schéma strict `OpenAIChatAssistantToolCall = { id, type, function: { name, arguments } }` sans champ `extra_signature`. `lowerToolCall` ne porte que `part.id / part.name / encodeJson(part.input)`. `parse` via `ToolStream.appendOrStart` : seul `id / name / text` est extrait, tout champ `extra_signature` retourné par le gateway est ignoré. Aucune référence `extra_signature` / `thoughtSignature` dans tout le repo Kilo.
- Kilo Code CLI (`packages/llm/src/protocols/gemini.ts`) : protocole natif Gemini gère `thoughtSignature` correctement (part.thoughtSignature en sibling de functionCall, `reasoningSignature` forwardé via providerMetadata.google, cache par reasoning part). Donc Kilo sait faire le round-trip en natif, mais pas via le protocole `openai-chat` qui est celui utilisé quand on pointe Kilo vers notre gateway `http://127.0.0.1:8787/v1`.
- LiteLLM : stocke la signature dans `provider_specific_fields` des tool calls et la ré-émet automatiquement. OmniRoute (fix v3.8.2) : cache la signature keyée par connexion + tool-call id et la ré-attache sur le tour suivant. Les deux confirment le pattern cache serveur comme workaround standard pour clients OpenAI-compat qui droppent la signature.
- Google AI Dev Forum : contournement via champ `extra_content` sur la compat OpenAI, mais non supporté par notre gateway. `thinkingBudget: 0` désactive le thinking mais perd la qualité (contournement, pas un fix).
Conclusion : le cache serveur opt-in est la seule alternative viable côté gateway sans toucher au client.
Le fix long-terme appartient à Kilo upstream (persister `extra_signature` comme il persiste déjà `reasoning_opaque`).
Implémenté : `src/aiflowbridge/antigavity/thought-signature-cache.ts` (factory, TTL 30 min, cap 500, eviction oldest-first, sweep lazy), lookup injecté dans `toGeminiNativeRequest` et `toAntigravityEnvelope` (client-supplied gagne toujours), `GatewayService.thoughtSignatureCache` par instance, `cacheThoughtSignatures()` alimenté depuis non-streaming BYOK + AGY (streaming : signatures déjà sur les chunks, cache via accumulation future), setting `aiflowbridge.gateway.injectThoughtSignature` défaut `false` (types, host-config, package.json), docs gateway.md + kilo-code.md.
Tests : `tests/thought-signature-cache.test.ts` (5 tests), extension `gemini-thought-signature.test.ts` (11 tests : pass-through + gap-filler + priorité client).
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
Aucun commit (validation utilisateur requise). Aucun secret versionné.

### 2026-09-05 — Kilo (Patch 2.18.2 : dashboard authMode BYOK / OAuth / plan / token)

L'utilisateur a demandé une confirmation avant tout commit : ce patch reste en working tree, non commité.
Contenu ajouté :

- Type `AuthMode = 'byok' | 'oauth' | 'plan' | 'token' | 'unknown'` exporté depuis `src/aiflowbridge/types.ts`.
- Nouveau champ optionnel `authMode` sur `RequestTelemetry`, agrégat `byAuth: Record<string, ProviderSnapshot>` sur `TelemetrySnapshot`, propagation dans `applyEntryToSnapshot`, `applyEntryInMemory`, `removeEntry`, `restore`, `clearInMemory`, `snapshot` de `TelemetryStore`.
- Helper pur `resolveAuthMode({ provider, isAntigravityOAuth })` dans `src/aiflowbridge/auth-mode.ts`. Logique : branche AGY OAuth -> `oauth` ; `provider.billing === 'plan'` -> `plan` ; kind antigravity / googleaistudio -> `oauth` ; reste -> `byok`.
- Câblage côté `gateway/server.ts` : `recordTelemetry()` accepte une option `{ isAntigravityOAuth }`, le flag est précalculé une fois en début de pipeline et passé aux 4 sites d'enregistrement (backoff 4xx/5xx, streaming success, non-streaming success, catch d'erreur).
- Côté Copilot Chat : `recordFromCopilotChat` accepte `authMode` optionnel.
- Dashboard : nouvelle colonne "Auth" sur la table Recent (pill coloré par mode), nouveau panneau "By auth" à côté de "By client" et "By source", filtre dropdown "Auth" statique dans le Filters panel, intégration dans `applyFilters` / `updateTotals` / `updateScopeNote` / `clearFilters`, ajout au search-haystack (typing `byok` filtre), ajout au tri (`data-sort-key="authMode"`), ajout aux exports CSV et JSON (`authMode` colonne / champ).
- Rétro-compat : snapshot `byAuth` optionnel, `authMode` coalescé à `unknown` en lecture pour les entrées pré-2.18.2, ancien schéma on-disk reste chargeable.
Nouveau `tests/auth-mode.test.ts` (9 tests) : résolveur + lecture coalescée + `applyEntryToSnapshot` avec agrégation `byAuth`.
Mise à jour `tests/dashboard.test.ts` : colspan bumped 11/12, panel count 10, CSV header +3 champs (`authMode` inséré après `source`), filtres metadata étendu.
Gates 2026-09-05 : compile OK, typecheck tests OK, standalone OK, 70 fichiers / 1169 tests verts.
Bump `package.json` + `package-lock.json` en 2.18.2, snapshots `2.18.2 / 2026-09-05` sur README/providers/architecture/cost, entrée CHANGELOG 2.18.2.
Docs `docs/dashboard.md` : section "By auth" ajoutée, panel count passé de 9 à 10.
Aucun secret dans les fichiers versionnés ni dans les logs (extraits assainis uniquement).

### 2026-09-05 — Kilo (Patch 2.18.1 : docs gateway + README + thought_signature)

L'utilisateur a demandé une confirmation avant tout commit : ce patch reste en working tree, non commité.
Contenu ajouté : `docs/gateway.md` documente `aiflowbridge.gateway.bufferGeminiStream` (table settings + note streaming temps réel sous la section Kilo Code), `README.md` surface le streaming temps réel par défaut et le résolveur effective-route dans la section OAuth.
Correction d'un bug de suivi remonté en chat sur Gemini 3.8 OAuth : `400 Function call is missing a thought_signature`.
La gateway ne propageait pas l'opaque `thought_signature` retournée par le modèle ; sur le tour suivant l'API rejetait la requête.
Le fix étend `GeminiNativeRequest` (champs `functionCall.thoughtSignature` et `functionResponse.thoughtSignature`), `CloudCodePart.thoughtSignature` côté AGY, `OpenAiChatMessage.tool_calls[i].extra_signature` et `OpenAiChatMessage.extra_signature` côté tool message, et la propagation aller-retour (`toGeminiNativeRequest`, `toAntigravityEnvelope`, `fromGeminiNativeResponse`, `createGeminiNativeToOpenAiSseStream`, `createAntigravityToOpenAiTransformStream`, `accumulateAntigravityResponse`).
Le client OpenAI (Kilo, Continue) reçoit `extra_signature` sur `tool_calls[i]` et l'échoie au tour suivant.
Nouveau `tests/gemini-thought-signature.test.ts` (8 tests) couvre la propagation sur les deux surfaces et les deux chemins streaming/non-streaming.
Bump `package.json` + `package-lock.json` en 2.18.1, snapshots `2.18.1 / 2026-09-05` sur README/providers/architecture/cost, entrée CHANGELOG 2.18.1 étendue (docs + thought_signature).
Vérif chaîne exacte `AIFlowBridge 2.15.7 - data snapshot 2026-08-06` : absente partout (remplacée en 2.18.0) ; reliquats `2.15.7` / `2026-08-06` légitimes (anciennes sections CHANGELOG, journal, audit read-only `2026-08-06-audit-v2.15.5.md`, `resources/pricing.json` généré rafraîchi par commande, pas à la main).
Gates 2026-09-05 : compile OK, typecheck tests OK, standalone OK, 69 fichiers / 1160 tests verts.
Aucun secret dans les fichiers versionnés ni dans les logs (extraits assainis uniquement).

### 2026-09-05 — Kilo (Implémentation plan Gemini BUG-13 à BUG-17 + release 2.18.0)

Plan `_Private/archives/2026-09-05-gemini-bug13-17-implementation-plan.md` exécuté dans l'ordre P0 → P2 + docs.
P0 : alternance user/model native (`pushMerged`, texte + `functionCall` dans une seule entrée model, `tool` consécutifs fusionnés) sur `gemini-native.ts` et `envelope.ts` via parser partagé `content-parts.ts`.
Vision `inlineData` base64 sur les deux surfaces, URL http(s) droppée avec `logger.warn` (jamais forwardée en texte).
`finish_reason: tool_calls` sur 4 sites (`fromGeminiNativeResponse`, `createGeminiNativeToOpenAiSseStream`, `mapFinishReason` + `sawToolCall` côté AGY streaming, `accumulateAntigravityResponse`).
P1 : streaming temps réel restauré (`pipeThrough`, flush résiduel intact), drain en fallback + flag `bufferGeminiStream` défaut `false` (`types.ts`, `host-config.ts`, `package.json`, `server.ts`).
P2 : résolveur `resolveEffectiveBaseUrl` + `decideRouteFromEffective` (settings > workspace > globalStorage > bundle), switcher lit les deux tiers override via `readRegistryVendorBaseUrl`, strip `googleaistudio` + `antigravity` sur les deux fichiers ; `token-store.ts` `clear({route})` sélectif, fin du fallback lecture `googleaistudio`.
SCHEMA-01 (`kind` + `family` enums), DISCOVERY-01 (`x-goog-api-key` + 401 explicite), DOC-01 à DOC-07 (sections BYOK/AGY réécrites, `vendors.antigravity` metadata-only), TEST-01 (rename `gateway-minimax-standby.test.ts`), STYLE-01 (zéro em-dash vérifié).
Nouveaux `tests/gemini-vision.test.ts` (7 tests) + `tests/gateway-streaming-ttft.test.ts` (2 tests), extensions `gemini-native` / `envelope` / `sse-transform` / `switch-route` / `registry-override`.
Gates : `npm run compile` OK, `npm test` 68 fichiers / 1152 tests verts, `npm run typecheck:tests` OK, `npm run compile:standalone` OK.
Bump 2.18.0 (`package.json`, snapshot `2026-09-05` sur README/providers/architecture/cost, entrée CHANGELOG).
Vérif manuelle BYOK (chat + 2 tools + image + TTFT + toggle aller/retour avec override stale) : non exécutée ici, clé réelle requise — à faire par l'utilisateur avant merge.
Aucun secret dans les fichiers versionnés ni dans les logs (extraits assainis uniquement).

### 2026-09-05 — Kilo (Bypass Secret Scanning pour les credentials publics AGY)

Pour débloquer le push du 2.17.0 bloqué par GitHub Secret Scanning sur
le `client_secret` OAuth d'Antigravity, l'utilisateur a autorisé
explicitement à garder ce secret dans le versionné. Les credentials
OAuth officiels de l'AGY CLI (client_id + client_secret) sont hardcodés
dans `src/aiflowbridge/antigravity/constants.ts` avec whitelist
correspondant dans `.github/secret_scanning.yml` (`paths-ignore` +
`custom_patterns`). Documentation de l'exception dans « Règles de
contenu » et dans la table « Décisions d'architecture ». Tous les autres
secrets restent exclus du versionné.

### 2026-09-05 — Kilo (Handoff vers nouvelle session : audit v2 + version 2.17.0)

Contexte : utilisateur `laurent`, code en `2.17.0`, branche feature Gemini/AGY.
Build actuelle : 1093/1093 → 1106/1106 → 1124/1124 tests verts au fil des fixes
documentés ci-dessous. `npm run compile` frais, `out/` à jour. L'utilisateur a
confirmé que Gemini 3.7 + 3.8 répondent correctement via la voie BYOK native
après le fix pipeline streaming (BUG-17 partiellement corrigé). Bascule entre
voies : `aiflowbridge.providers.googleaistudio.baseUrl` (`cloudcode-pa` =
OAuth AGY actif, `generativelanguage.googleapis.com/v1beta` = BYOK native).
Clé API `AIzaSy...` stockée dans `SecretStorage`. Le détail des bugs ouverts
(BUG-06, 13-17) est dans l'audit v2.

### 2026-09-05 — Kilo (Release 2.17.0 : voie BYOK Gemini + correctifs audit v1)

Nouvelle voie BYOK vers Gemini (`x-goog-api-key`, surface native), audit externe
intégral des routes OAuth + BYOK, switcher de route sécurisé, OAuth UX avec
ouverture navigateur, support vision documenté (mais BUG-14 images stipees
en BYOK — fix prévu 2.18.0). Détails des fixes dans l'audit v2 section 6.1.

### 2026-09-04 — Kilo (BYOK Gemini initial + facturation plan vs token)

Ajout de la voie BYOK `googleaistudio` avec prix publics, mode `billing` par
profil, dashboard avec badge `plan` + tooltip + notice, exports CSV/JSON avec
colonne `billedTo`. Modèles Gemini 3.8/3.7/3.6 Flash remplacent les ids 2.5.

### 2026-09-03 — Kilo (Implémentation initiale Antigravity / Google AI Studio)

Modules purs sous `src/aiflowbridge/antigravity/` (constants, types, pkce,
auth, token-store, project, catalog, envelope, sse-transform, index).
Catalogue et plomberie : extension `ProviderKind`, alias vendor, catalogue
bundled, commande CLI standalone `auth googleaistudio`. Raccordement
Gateway reporté en AP-008b (puis traité le 2026-09-05). Spec AP-007 source.

### 2026-10-01 - Kilo (Mono-agent : suppression de la référence Perplexity)

L'utilisateur a acté que Perplexity n'est **plus du tout** utilisé dans la gestion du projet. Toutes les mentions ont été retirées de la documentation interne.

**Ce qui a changé.** Le modèle « tech lead / exécutant » a été remplacé par une exécution **mono-agent** : un seul agent IA couvre conception, code, docs, tests, audit, build, gateway, branches et PR.
La répartition des capacités ne mérite plus d'être décrite, puisqu'il n'y a plus qu'un acteur de chaque côté : l'agent, et l'utilisateur qui arbitre.

Fichiers touchés :

- `.kilocode/rules/00-brain-protocol.md` : section « Répartition des rôles » réécrite en mono-agent, et « Communication entre agents » (« il n'y a plus d'échange entre agents ») à la place d'un dialogue à deux.
- `ACTION_PLAN.md` : titre (« File d'attente opérationnelle du projet »), protocole d'échange, colonne responsable d'AP-013, et les 4 questions ouvertes réorientées de `Kilo → Perplexity :` vers `En attente d'arbitrage utilisateur :`.
- `BRAIN.md` : en-tête, section « Répartition des rôles », 2 lignes de la table des décisions, et les 3 entrées de journal du 2026-09-02.
- `docs/plans/antigravity-gateway-integration-spec.md` : ligne « Auteur ».

**Sur les entrées de journal du 2026-09-02.** Elles ont été réécrites (le préfixe d'auteur `Perplexity` a été retiré du titre `### 2026-09-02 (...)`) plutôt que supprimées : le contenu utile - la spec AP-007, l'audit AP-005/006, le plan initial - est conservé, seule l'attribution d'auteur disparaît.
Raison : un journal qui mentionne un acteur inexistant invite un agent à chercher un partenaire de revue qui n'a plus lieu d'être.
La ligne de décision du 2026-09-02 sur la répartition des rôles est conservée et marquée **caduque depuis le 2026-10-01** plutôt qu'effacée, pour que l'historique reste lisible.

**Non touché : `resources/pricing.json`.** Les 5 occurrences de « perplexity » y sont des **ids de modèles OpenRouter** (`perplexity/sonar`, `perplexity/sonar-pro`, `perplexity/sonar-reasoning-pro`, `perplexity/sonar-pro-search`, `perplexity/sonar-deep-research`), pas des mentions de rôle.
Les supprimer casserait le calcul de coût de ces modèles.

### 2026-10-01 - Kilo (Traitement d'un audit externe : 4 constats, doc + tests + scripts)

Audit externe de `main` à `2a755319` (2.19.2), quatre constats retenus, puis bump patch en **2.19.3** (`package.json`, `package-lock.json`).
Aucun bug d'exécution : trois incohérences documentaires et une faiblesse de prévention.
Version bumpée parce que la promesse de capacité et le garde-fou de publication changent, pas seulement le texte : un utilisateur qui lit le README et un mainteneur qui publient en local sont tous deux concernés.

**1.
Promesse de capacité non tenue dans le README (P1).** Deux passages promettaient de mêler OpenRouter, Gemini et les vendors directs « dans le même sélecteur Copilot Chat », alors que le picker ne porte que les vendors Path A (DeepSeek, MiniMax, Xiaomi MiMo) et qu'AP-013 suit la promotion Path B vers Path A.
Le README disait déjà la bonne chose plus bas (section « Gateway-only vendors », étape 3 du quick start) : c'est le résumé en tête qui mentait.
Les deux phrases sont réécrites avec la frontière Path A / Path B explicite et un renvoi vers le mécanisme réel (Kilo Code / Continue posés sur la même gateway).
**Le même dédoublement existait dans `docs/`** : `docs/gateway.md` affirmait que `GET /v1/models` renvoie « le même ensemble que le sélecteur Copilot Chat » (c'est un sur-ensemble depuis l'ajout des vendors passerelle seule), et `docs/providers.md` promettait qu'un modèle ajouté par `AIFlowBridge: Add a custom model` apparaît « immédiatement dans le picker Copilot Chat » (vrai pour `deepseek` / `minimax` / `xiaomi`, faux pour `openrouter` / `zai` / `moonshot` / `googleaistudio`).
Les deux sont corrigés.
**AP-013 reste `à faire`** et n'est pas touchée : c'est une évolution produit, pas un correctif de documentation.

**2.
Libellés de liens menteurs (P2).** Le dernier commit avait remplacé deux ancres mortes par `docs/gateway.md#workspace-context-get-v1context` en laissant le libellé `docs/architecture.md` - l'URL est bonne, le texte affiché est faux, et aucun contrôle d'ancre ne détecte ce décalage.
**Un contrôle d'ancre ne vérifie que la destination.** L'audit proposait en conséquence de contrôler aussi les liens dont le texte ressemble à un chemin de fichier ; c'est fait, et il a sorti 5 liens relatifs cassés que le même commit avait introduits ou laissés (`(vision-proxy.md)`, `(reasoning.md)`, `(screenshots.md)` dans le README, idem dans `docs/dashboard.md`) plus 6 liens morts dans `docs/standalone.md` (`../gateway.md`, `./lock-and-restart.md`, `./autostart/systemd.md` au lieu de `linux-systemd.md`, etc.).
Tous corrigés.
Un contrôle de liens relatifs sur 20 fichiers markdown ne laisse que les images de `docs/screenshots.md`, qui ne sont pas versionnées (elles vivent dans le paquet publié).

**3.
Scanner i18n trop étroit (P2).** `tests/i18n.test.ts` ne reconnaissait que `\bt\(\s*'([^']+)'`, donc ni les guillemets doubles, ni les templates sans interpolation, ni les appels dont la clé est calculée.
L'audit précisait à juste titre que c'est une limite du test et non la preuve qu'une clé manque aujourd'hui.
**L'hypothèse qu'il proposait de vérifier est vérifiée** : injection d'un `t("audit.probe.absent.key")` en guillemets doubles dans `src/`, test rouge avec la clé nommée, restauration, test vert.
Sous l'ancien scanner, ce même appel passait inaperçu.
Le scanner accepte désormais les trois styles de guillemets, y compris sur un appel à la ligne suivante.
Le trou restant - les clés calculées - est fermé par le haut plutôt que par AST : `collectDynamicCallSites()` liste les 3 fichiers concernés (`client/error.ts`, `provider/models.ts`, `runtime/provider.ts`), la déclaration `export function t(` est exclue, et la liste est épinglée par une liste blanche assortie de sa justification.
Un nouveau site dynamique casse le test tant qu'il n'est pas déclaré.
AST completreporté : la forme actuelle échoue proprement sur 3 sites, tous documentés, contre un parseur TypeScript à maintenir.

**4.
Chemins de publication divergents (P2).** `npm run package` enchaînait `compile` + `test` + `typecheck:tests`, tandis que `npm run publish:vscode` et `publish:openvsx` s'arrêtaient à `compile` + `test`.
Vérification faite avant de trancher : la CI (`ci.yml`) et les workflows `release.yml` / `rescue.yml` passent tous par `npm run package`, donc `typecheck:tests` était bien appliqué à tout ce qui est publié - **l'écart ne touchait que la publication manuelle en local**, moins protégé mais non cassé.
Correction par convergence plutôt que par ajout : nouveau script `validate` (`compile` + `test` + `typecheck:tests`) appelé par `package`, `publish:vscode` et `publish:openvsx`.
Une seule définition du garde-fou, les trois chemins alignés, aucune modification des workflows.

### 2026-10-01 - Kilo (Patch 2.19.2 : trois défauts silencieux corrigés + ménage Git)

Audit de `main` après fusion des deux sessions de travail et suppression des worktrees. Quatre points traités, puis bump patch en 2.19.2.

**1.
Trois clés i18n jamais définies.** `vision.configuredMissing`, `vision.configuredMissingVendor` et `vision.configuredModelMissing` sont référencées depuis `src/provider/vision/model.ts` (lignes 62, 139, 140) mais n'ont **jamais** été ajoutées à `src/i18n.ts` (`git log -S` ne renvoie aucun commit d'ajout ; premier usage `b44537b9`, juillet 2026).
Le mode d'échec est silenceux : `t()` retourne la clé brute pour une entrée inconnue, et **avant** d'appliquer les substitutions `{0}`.
Symptômes réels : un toast affichant `vision.configuredModelMissing` avec l'id de modèle configuré silencieusement perdu, et une ligne du Quick Pick vision dont le libellé « vendor: » affichait `vision.configuredMissingVendor`.
C'est exactement le mode d'échec du bug `provider.googleaistudio.name` corrigé en 2.19.0 : ni erreur de compilation, ni test en échec. **Leçon structurelle** : une clé i18n manquante est un bug invisible, il faut un garde-fou.

**Garde-fou ajouté : `tests/i18n.test.ts`.** Il parcourt `src/`, extrait chaque littéral passé à `t()` et échoue si l'un manque dans la table.
Cela impose d'exporter la table (`export const en`) pour permettre l'assertion.
Un test de non-vacuité vérifie que le scanner trouve bien plus de 40 clés et que la table en contient plus de 60 : sans lui, une régression de la regex ferait passer le test pour la mauvaise raison.
**Le test figeait le bug, ce qui est la partie la plus instructive.** `tests/vision.test.ts:161` attendait explicitement `showWarningMessage('vision.configuredModelMissing')`, avec un commentaire qui justifiait l'attente par le fait que la clé manquait dans la table.
Ajouter la clé a cassé cette assertion : résultat correct, mais il a fallu réécrire le test pour qu'il asserte le **comportement** plutôt que la copie - l'id de modèle doit être interpolé dans le message, la clé brute ne doit pas être ce que voit l'utilisateur, et aucun `{0}` ne doit subsister.
Une telle assertion « le bug est le comportement attendu » est pire qu'une absence de test : elle empêche la correction et donne une fausse confiance.

Les tests restants couvrent le fallback de `t()`, la substitution `{0}`, les 7 libellés de vendors utilisés par les commandes de clé, et l'absence de `{` parasite dans les nouvelles clés.

**2. Test instable.** `tests/gateway-antigravity.test.ts` dérivait le port de la gateway du port de l'upstream mock (`mockUpstreamPort + 10`).
Le mock écoute sur un port éphémère choisi par l'OS, et six autres fichiers de test lient des ports en parallèle : le port dérivé pouvait être déjà pris.
Observed : un échec sur ~10 exécutions complètes, puis 6 exécutions propres d'affilée.
Le test lie maintenant `port: 0` et relit le port réel via `config.gateway.port` après `start()` - mécanisme déjà documenté dans `docs/architecture.md` pour le cas `port: 0`.
La config étant stockée par référence dans `GatewayService`, la relecture est fiable.

**3. Ancre morte.** Deux liens du README pointaient vers `docs/architecture.md#workspace-context`, section supprimée.
La documentation réelle est dans `docs/gateway.md#workspace-context-get-v1context`.
Après correction, un script de vérification des ancres sur 33 fichiers markdown ne trouve plus aucun lien cassé. **Piège méthodologique rencontré** : ma première version du script collapsait les espaces multiples, alors que l'algorithme de `github-slugger` ne le fait pas (chaque espace devient un tiret).
J'ai obtenu 4 faux positifs avant de corriger le script et de retomber à 1 seul vrai lien cassé.

**4.
Ménage Git.** Les 6 enregistrements de worktree périmés ont été supprimés (`git worktree prune`), les 3 branches de feature fusionnées (`feat/model-catalog-refresh`, `-v2`) supprimées, et le `stash@{0}` droppé. `git branch -d` a refusé `feat/model-catalog-refresh-2` parce qu'elle portait 1 commit non fusionné : vérification faite, deux éléments continuaient d'exister uniquement là et ont été rapatriés dans `main` avant la suppression forcée - la distinction Path A / Path B dans `AGENTS.md`, et la section README « Gateway-only vendors » (matrice contexte / vision / prix des 4 vendors passerelle seule + les 5 comportements amont qui sont des erreurs dures).
Le reste de ce commit docs avait été refait à l'identique par le travail parallèle déjà fusionné.

**Point de méthode.** `git branch -d` a fait son travail de garde-fou : il m'a empêché de supprimer une branche qui contenait encore du contenu non repris.
Force-delete aveugle aurait perdu la section README et la mise à jour d'AGENTS.md sans que rien ne le signale.

### 2026-09-02 (AP-007 : cartographie + spec Antigravity)

Cartographie complète de `server.ts`, livrable
`docs/plans/antigravity-gateway-integration-spec.md` (design kind `antigravity`,
10 modules, fichiers touchés, risques, 4 questions ouvertes).

### 2026-09-02 (Audit, rôles et infrastructure)

Audit AP-005/AP-006 confirmant la réutilisation de la gateway existante ;
définition de la répartition des rôles de l'époque. Infrastructure de
collaboration : `BRAIN.md`, `ACTION_PLAN.md`, hook `pre-commit`,
`scripts/install-hooks.js`, règles Kilo, canal privé `AIFlowBridge-Private`.

### 2026-09-02 (Plan initial Antigravity)

Plan initial `docs/plans/antigravity-provider-kilo-cli.md`, révisé ensuite
par la spec AP-007.
