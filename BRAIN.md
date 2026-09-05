# BRAIN.md — Mémoire du projet AIFlowBridge

> Journal partagé et fil rouge du projet. Ce fichier est la **mémoire commune**
> entre les agents IA (Perplexity via connecteur GitHub, Kilo Code, Kilo CLI)
> et le mainteneur humain.
>
> ⚠️ **Ce dépôt est public** : ce fichier ne doit contenir QUE des informations
> techniques publiables. Voir « Règles de contenu » ci-dessous.

---

## Répartition des rôles (validée par l'utilisateur le 2026-09-02)

| Acteur                             | Rôle            | Périmètre                                                                                                                                                           |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Perplexity** (connecteur GitHub) | Tech lead       | Conception, spécifications, écriture de code/docs/tests, audit et revue de code, gestion du backlog (`ACTION_PLAN.md`), branches et PR                              |
| **Kilo** (VS Code / CLI local)     | Exécutant local | `npm install/build/test`, scripts, lancement de la gateway, flux OAuth réel, tests Kilo CLI ; remonte les résultats **assainis** dans `BRAIN.md` / `ACTION_PLAN.md` |
| **l'utilisateur**                  | Décideur        | Arbitrage, validation des décisions d'architecture, gestion des secrets locaux, revue finale des PR                                                                 |

Capacités réelles de Perplexity (mesurées le 2026-09-02) :

- ✅ lister l'arborescence, lire des fragments de fichiers via la recherche de
  code GitHub (`search_code`), créer/modifier des fichiers, créer branches et PR ;
- ⚠️ lecture par fragments ciblés (pas de fichier intégral garanti ; index de
  recherche parfois en léger retard sur le dernier commit) ;
- ❌ aucune exécution : build, tests, terminal, OAuth réel → toujours Kilo.

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
- **Providers actuels** : MiniMax, Xiaomi MiMo, DeepSeek, OpenRouter
  (+ gateway openai-compat/ollama générique).
- **Chantier actif** : provider Antigravity / Google Cloud Code Assist afin
  d'utiliser Gemini via le compte Google AI Pro dans Kilo CLI, en parallèle
  de MiniMax-M3 via le plan MiniMax.
- **Spec d'implémentation** : `docs/plans/antigravity-gateway-integration-spec.md`
  (AP-007, remplace le plan initial `antigravity-provider-kilo-cli.md`).

## Décisions d'architecture (validées)

| Date       | Décision                                                                                                                | Motif                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Passerelle locale OpenAI-compatible plutôt que plugin Kilo natif                                                        | Réutilisable, isole le risque des endpoints Antigravity, préserve le provider MiniMax officiel                                                       |
| 2026-09-02 | Mémoire publique `BRAIN.md` + canal privé `AIFlowBridge-Private` + secrets locaux hors git                              | Seul canal commun Perplexity↔Kilo ; dépôt public donc contenu assaini                                                                              |
| 2026-09-02 | Hooks git versionnés dans `.githooks/` + `core.hooksPath`                                                               | Partage des hooks via le dépôt                                                                                                                     |
| 2026-09-02 | Hook pre-commit : pull obligatoire + mise à jour du journal                                                             | Éviter toute perte de modifications, journal incontournable                                                                                        |
| 2026-09-02 | Répartition des rôles : Perplexity tech lead / Kilo exécutant local / l'utilisateur décideur                              | Maximiser l'autonomie de Perplexity, ne déléguer que l'exécution                                                                                   |
| 2026-09-02 | Antigravity = nouveau `ProviderKind` dans la gateway existante (pas de nouvelle passerelle)                             | La gateway OpenAI-compatible existe et vise déjà Kilo Code (audit du 2026-09-02)                                                                   |
| 2026-09-04 | Mode de facturation par profil `billing: 'token' \| 'plan'` + `RequestTelemetry.billedTo`                              | Distinguer coût réel au token (BYOK) d'équivalent plan (OAuth AGY, MiniMax token plan) ; le dashboard marque `plan` avec badge + tooltip + notice        |
| 2026-09-04 | Voie BYOK Gemini comme défaut, OAuth AGY opt-in pour comptes whitelistés Cloud Code Assist                              | Quota AI Studio Pro indépendant du quota Cloud Code Assist (`aicode-consumers` lockout personnel) ; BYOK `AIzaSy...` ne dépend d'aucune whitelist         |
| 2026-09-05 | Surface Gemini native `:streamGenerateContent?alt=sse` préférée à `/openai/chat/completions` sur la voie BYOK              | La surface OpenAI-compat est feature-gated par projet GCP, retourne 429 quota=0 si non activée ; la native est toujours dispo et permet les free-tier Gemini     |
| 2026-09-05 | Commande `AIFlowBridge: Switch Google AI Studio route` toggle baseUrl + nettoie les credentials de la voie inactive   | Évite le piège "override silencieux" `globalStorage/models.json` qui forçait OAuth en local ; couplé au runtime avec `resetGlobalStorageRegistryOverride`        |
| 2026-09-05 | Les credentials OAuth publics de l'AGY CLI (`client_id` + `client_secret`) sont hardcodés dans `src/aiflowbridge/antigravity/constants.ts` avec bypass `paths-ignore` dans `.github/secret_scanning.yml` | Ces credentials sont identiques à ceux embarqués dans le binaire Antigravity officiel de Google (extractibles depuis `~/.config/google/antigravity/credentials.json`). Sans eux, la voie OAuth AGY ne fonctionne pas out-of-the-box. Le whitelisting est documenté dans `.github/secret_scanning.yml` et expliqué dans le commentaire d'en-tête de `constants.ts`. Tous les autres secrets restent exclus du versionné. |

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
  Détail complet dans `_Private/docs/audits/2026-09-05-gemini-integration-audit.md` §6 (déplacé du public le 2026-09-05 : contient email, project id et chemins locaux).
- **Documentation à actualiser (audit v2 §6.3) :** `docs/providers.md` lignes
  90/92/113 + `README.md:26` version pin à `2.15.7`.

## Liens utiles

- Spec d'intégration (active) : `docs/plans/antigravity-gateway-integration-spec.md`
- Audit Gemini (v2, privé) : `_Private/docs/audits/2026-09-05-gemini-integration-audit.md`
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

### 2026-09-02 — Perplexity (AP-007 : cartographie + spec Antigravity)

Cartographie complète de `server.ts`, livrable
`docs/plans/antigravity-gateway-integration-spec.md` (design kind `antigravity`,
10 modules, fichiers touchés, risques, 4 questions ouvertes).

### 2026-09-02 — Perplexity (Audit, rôles et infrastructure)

Audit AP-005/AP-006 confirmant la réutilisation de la gateway existante ;
répartition des rôles Perplexity/Kilo/utilisateur. Infrastructure de
collaboration : `BRAIN.md`, `ACTION_PLAN.md`, hook `pre-commit`,
`scripts/install-hooks.js`, règles Kilo, canal privé `AIFlowBridge-Private`.

### 2026-09-02 — Perplexity (Plan initial Antigravity)

Plan initial `docs/plans/antigravity-provider-kilo-cli.md`, révisé ensuite
par la spec AP-007.
