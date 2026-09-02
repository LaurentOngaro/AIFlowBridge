# BRAIN.md — Mémoire du projet AIFlowBridge

> Journal partagé et fil rouge du projet. Ce fichier est la **mémoire commune**
> entre les agents IA (Perplexity via connecteur GitHub, Kilo Code, Kilo CLI)
> et le mainteneur humain.
>
> ⚠️ **Ce dépôt est public** : ce fichier ne doit contenir QUE des informations
> techniques publiables. Voir « Règles de contenu » ci-dessous.

---

## Répartition des rôles (validée par Laurent le 2026-09-02)

| Acteur | Rôle | Périmètre |
|---|---|---|
| **Perplexity** (connecteur GitHub) | Tech lead | Conception, spécifications, écriture de code/docs/tests, audit et revue de code, gestion du backlog (`ACTION_PLAN.md`), branches et PR |
| **Kilo** (VS Code / CLI local) | Exécutant local | `npm install/build/test`, scripts, lancement de la gateway, flux OAuth réel, tests Kilo CLI ; remonte les résultats **assainis** dans `BRAIN.md` / `ACTION_PLAN.md` |
| **Laurent** | Décideur | Arbitrage, validation des décisions d'architecture, gestion des secrets locaux, revue finale des PR |

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
   consolidées dans « Décisions d'architecture » une fois validées par Laurent.

## Règles de contenu (dépôt public)

- ❌ Jamais de : tokens, clés API, codes OAuth, cookies, emails privés,
  données personnelles, URLs internes/privées, montants de facturation détaillés.
- ✅ Autorisé : architecture, décisions techniques, état des tâches, erreurs
  assainies (sans secret), liens publics, noms de modèles et de providers.
- Toute note sensible va dans le canal privé `AIFlowBridge-Private`
  (`BRAIN-PRIVATE.md`) ; les vrais secrets restent locaux hors git (`.ai/`).
- En cas de doute : ne pas écrire, demander à Laurent.

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
- **Branche de travail** : `feat/antigravity-provider` (squelette du module
  livré : modules purs + tests ; validation locale en cours via AP-013).
- **Spec d'implémentation** : `docs/plans/antigravity-gateway-integration-spec.md`.

## Décisions d'architecture (validées)

| Date | Décision | Motif |
|---|---|---|
| 2026-09-02 | Passerelle locale OpenAI-compatible plutôt que plugin Kilo natif | Réutilisable, isole le risque des endpoints Antigravity, préserve le provider MiniMax officiel |
| 2026-09-02 | Mémoire publique `BRAIN.md` + canal privé `AIFlowBridge-Private` + secrets locaux hors git | Seul canal commun Perplexity↔Kilo ; dépôt public donc contenu assaini |
| 2026-09-02 | Hooks git versionnés dans `.githooks/` + `core.hooksPath` | Partage des hooks via le dépôt |
| 2026-09-02 | Hook pre-commit : pull obligatoire + mise à jour du journal | Éviter toute perte de modifications, journal incontournable |
| 2026-09-02 | Répartition des rôles : Perplexity tech lead / Kilo exécutant local / Laurent décideur | Maximiser l'autonomie de Perplexity, ne déléguer que l'exécution |
| 2026-09-02 | Antigravity = nouveau `ProviderKind` dans la gateway existante | La gateway OpenAI-compatible existe et vise déjà Kilo Code |
| 2026-09-02 | Kind nommé `'antigravity'`, commande `aiflowbridge-server auth antigravity`, MVP **gateway-only** (picker Copilot Chat en V2) | Arbitrage Laurent (AP-011) |

## Contraintes et préférences

- Préférence pour les coûts déjà inclus dans des plans existants (Google AI Pro,
  MiniMax Token Plan) plutôt que la facturation API au token.
- Préférence pour les setups BYOK et la facturation directe chez le provider.
- Stack : TypeScript, extension VS Code, mode standalone Node.js.
- Langue de travail : français pour la documentation projet, anglais pour le code.

## Contexte technique clé — audit Perplexity du 2026-09-02

### Gateway standalone (déjà fonctionnelle)

- `src/aiflowbridge/gateway/server.ts` (~114 Ko) : `GatewayService`, serveur
  `node:http`. Routes : `/version`, `/health`, `/metrics`, `/v1/metrics`,
  `/v1/models`, `/v1/discovery`, `/v1/events` (SSE télémétrie),
  `/v1/replay/{id}`, `/v1/context`, `POST /v1/chat/completions`,
  `POST /shutdown`. Bind `127.0.0.1` ; clé locale `sk-aiflowbridge-local`.
- Clients documentés : **Kilo Code**, Continue, curl, Open WebUI.
- Flux completion : `forwardChatCompletion` (orchestrateur) →
  `readAndValidateBody` / `resolveChatProvider` (`selectProviderWithLanguage`,
  routage par langue) / `buildUpstreamRequest` (URL, clé, headers, traduction
  de payload, injection contexte workspace, override du modèle).
- Streaming : `Accept: application/json, text/event-stream` upstream, réponse
  **pipée verbatim** (`Readable.fromWeb().pipe(response)`) — aucun
  TransformStream existant.
- Clés : env `AIFLOWBRIDGE_<VENDOR>_API_KEY` → `secrets.json` (chmod 600) →
  commande VS Code ; warning unique si absente (sauf `ollama`).
- Erreurs : `sanitizeUpstreamErrorMessage()` (retire query string + credentials
  des 502), `redactProviderForLog()` (`apiKeyPresent`).
- Standalone : binaire `aiflowbridge-server`, config
  `~/.aiflowbridge/config.json` hot-reload, build `npm run build:standalone`,
  `IGatewayContext` + `vscode-context-adapter.ts` + shim `vscode-shim.ts`.

### Providers (deux chemins d'exposition)

1. **Copilot Chat (VS Code LM API)** : `vscode.LanguageModelChatProvider` —
   `BaseChatProvider`, MiniMax, Xiaomi, DeepSeek, `UnifiedChatProvider` ; clés
   en SecretStorage (`API_KEY_SECRETS`, `src/consts.ts`).
2. **Gateway** : `ProviderProfile { id, label, kind, model, baseUrl }`,
   `ProviderKind = 'openai-compat' | 'ollama'` ; registry 3 tiers
   (`resources/models.json` < globalStorage < workspace) ; checklist vendor
   dans `docs/agent-instructions/tasks.md` ; `VENDOR_ALIASES`
   (`api-key-resolver.ts`), `VENDOR_CHOICES`/`VENDOR_LABELS`
   (`addCustomModel.ts`).

### Intégration Antigravity (spec AP-007, squelette AP-008)

- Nouveau `ProviderKind 'antigravity'` ; 3 divergences vs openai-compat :
  auth OAuth async, enveloppe requête, **TransformStream SSE** (code nouveau).
- Module `src/aiflowbridge/antigravity/` :
  - **livrés (purs + testés)** : `constants.ts`, `types.ts`, `pkce.ts`,
    `envelope.ts` (OpenAI → enveloppe, sanitization des schémas d'outils,
    alternance des rôles), `sse-transform.ts` (SSE → chunks OpenAI, usage,
    finish reasons, `[DONE]`, accumulateur non-stream), `index.ts` ;
  - **à venir (réseau)** : `auth.ts`, `token-store.ts`, `project.ts`,
    `catalog.ts` (AP-014).
- Spec complète : `docs/plans/antigravity-gateway-integration-spec.md`.

## Liens utiles

- Spec d'intégration (active) : `docs/plans/antigravity-gateway-integration-spec.md`
- Plan initial (historique) : `docs/plans/antigravity-provider-kilo-cli.md`
- Zone d'échange opérationnelle : `ACTION_PLAN.md`
- Règles agents Kilo : `.kilocode/rules/00-brain-protocol.md`
- Canal privé : dépôt `AIFlowBridge-Private` → `BRAIN-PRIVATE.md`

---

## Journal (plus récent en haut)

### 2026-09-02 — Perplexity (AP-008 : squelette du module, en cours)
- Arbitrages Laurent actés (AP-011) : kind `'antigravity'`, commande
  `aiflowbridge-server auth antigravity`, MVP gateway-only.
- Branche `feat/antigravity-provider` créée ; modules purs livrés :
  `constants.ts`, `types.ts`, `pkce.ts` (RFC 7636, vecteur annexe B testé),
  `envelope.ts` (mappings complets + sanitization + alternance des rôles),
  `sse-transform.ts` (converter incrémental + TransformStream + accumulateur
  non-stream), `index.ts` ; 3 fichiers de tests vitest (26 cas).
- En attente : validation locale par Kilo (AP-013 : compile + tests), puis
  modules réseau (AP-014).

### 2026-09-02 — Perplexity (AP-007 : cartographie + spec)
- Cartographie complète de `server.ts` : routage par pathname, orchestrateur
  `forwardChatCompletion` en 3 helpers, pipe SSE verbatim (TransformStream
  à créer), résolution de clés statiques (token manager OAuth à créer).
- Livrable : `docs/plans/antigravity-gateway-integration-spec.md`
  (commit `d26f132`).

### 2026-09-02 — Perplexity (audit et rôles)
- Découverte : lecture de fichiers possible via la recherche de code GitHub
  (fragments `text_matches`), malgré l'échec de l'outil de lecture directe.
- Audit AP-005/AP-006 : la gateway OpenAI-compatible existe déjà et vise Kilo
  Code ; Antigravity = nouveau `ProviderKind`. Répartition des rôles validée
  (commit `8b752ae`).

### 2026-09-02 — Perplexity
- Infrastructure de collaboration : `BRAIN.md`, `ACTION_PLAN.md`, hook
  `pre-commit`, `scripts/install-hooks.js`, règles Kilo (commit `f7bc109`).
- Canal privé `AIFlowBridge-Private/BRAIN-PRIVATE.md` (commit `33bce42`).

### 2026-09-02 — Perplexity
- Plan initial Antigravity `docs/plans/antigravity-provider-kilo-cli.md`
  (commit `2ba3a4c`), révisé par la spec AP-007.
