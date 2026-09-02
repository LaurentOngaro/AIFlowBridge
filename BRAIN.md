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
- **Providers actuels** : MiniMax, Xiaomi MiMo, DeepSeek (+ gateway
  openai-compat/ollama générique).
- **Chantier actif** : provider Antigravity / Google Cloud Code Assist afin
  d'utiliser Gemini via le compte Google AI Pro dans Kilo CLI, en parallèle
  de MiniMax-M3 via le plan MiniMax.
- **Plan de référence** : `docs/plans/antigravity-provider-kilo-cli.md`
  (à réviser : la gateway existe déjà, voir audit ci-dessous).

## Décisions d'architecture (validées)

| Date | Décision | Motif |
|---|---|---|
| 2026-09-02 | Passerelle locale OpenAI-compatible plutôt que plugin Kilo natif | Réutilisable, isole le risque des endpoints Antigravity, préserve le provider MiniMax officiel |
| 2026-09-02 | Mémoire publique `BRAIN.md` + canal privé `AIFlowBridge-Private` + secrets locaux hors git | Seul canal commun Perplexity↔Kilo ; dépôt public donc contenu assaini |
| 2026-09-02 | Hooks git versionnés dans `.githooks/` + `core.hooksPath` | Partage des hooks via le dépôt |
| 2026-09-02 | Hook pre-commit : pull obligatoire + mise à jour du journal | Éviter toute perte de modifications, journal incontournable |
| 2026-09-02 | Répartition des rôles : Perplexity tech lead / Kilo exécutant local / Laurent décideur | Maximiser l'autonomie de Perplexity, ne déléguer que l'exécution |
| 2026-09-02 | Antigravity = nouveau `ProviderKind` dans la gateway existante (pas de nouvelle passerelle) | La gateway OpenAI-compatible existe et vise déjà Kilo Code (audit du 2026-09-02) |

## Contraintes et préférences

- Préférence pour les coûts déjà inclus dans des plans existants (Google AI Pro,
  MiniMax Token Plan) plutôt que la facturation API au token.
- Préférence pour les setups BYOK et la facturation directe chez le provider.
- Stack : TypeScript, extension VS Code, mode standalone Node.js.
- Langue de travail : français pour la documentation projet, anglais pour le code.

## Contexte technique clé — audit Perplexity du 2026-09-02

### Gateway standalone (déjà fonctionnelle)

- `src/aiflowbridge/gateway/server.ts` (~114 Ko) : `GatewayService`, serveur
  `node:http`, endpoints OpenAI-compatibles (`/v1/chat/completions`, sonde
  `/version`), limite de concurrence (429 + `Retry-After`), statut/télémétrie.
- Clients déjà documentés : **Kilo Code**, Continue, curl, Open WebUI sur
  `http://127.0.0.1:8787/v1` ; clé locale `sk-aiflowbridge-local`
  (`gateway/bearer-key.ts`) ; snippets clients dans `gateway/discovery.ts`.
- Verrou mono-instance partagé VS Code/standalone (`gateway/lock.ts`),
  sondage de version (`gateway/probe.ts`), headers OpenRouter dédiés.
- Injection d'un préfixe system de contexte workspace dans chaque appel
  (`src/aiflowbridge/context/workspace-context.ts`).
- Standalone : binaire `aiflowbridge-server` (`package.json#bin`), config
  `~/.aiflowbridge/config.json` avec hot-reload, secrets via env
  `AIFLOWBRIDGE_<VENDOR>_API_KEY` puis `secrets.json` (chmod 600),
  build `npm run build:standalone` (`tsconfig.standalone.json`), shim
  `src/standalone/vscode-shim.ts`, contexte `createStandaloneContext()`.
- Découplage hôte : `IGatewayContext` + `vscode-context-adapter.ts`
  (secrets VS Code → `ctx.secrets`, globalStorage → `ctx.globalStorageDir`).

### Providers (deux chemins d'exposition)

1. **Copilot Chat (VS Code LM API)** : classes `vscode.LanguageModelChatProvider`
   — `BaseChatProvider` (`src/provider/base.ts`), `MiniMaxChatProvider`,
   `XiaomiChatProvider`, `DeepSeekChatProvider`, `UnifiedChatProvider`.
   Clés API en SecretStorage VS Code (`API_KEY_SECRETS` par vendor,
   `src/consts.ts`), base URL par `getProviderBaseUrl(vendor)` (`src/config.ts`).
2. **Gateway** : `ProviderProfile` (`id`, `label`, `kind`) avec
   `ProviderKind = 'openai-compat' | 'ollama'` (`src/aiflowbridge/types.ts`),
   profils synthétisés dans `host-config.ts`, relais upstream dans `server.ts`.
   Client HTTP : `src/client/core.ts` (fetch, `stream_options.include_usage`).

### Conséquence pour Antigravity

- Ajouter `ProviderKind 'antigravity'` + profil provider + branche de relais
  dans `server.ts` (enveloppe `project/model/request` + conversion SSE) ;
- module OAuth PKCE dans `src/aiflowbridge/antigravity/`, refresh token en
  `secrets.json` (convention existante, chmod 600) ;
- commande CLI d'authentification à ajouter au binaire `aiflowbridge-server` ;
- option VS Code : `AntigravityChatProvider extends BaseChatProvider` ;
- tests : suivre les patterns vitest existants (`tests/gateway*.test.ts`,
  `tests/standalone/`).

### Endpoints Antigravity (non officiels, à centraliser)

- OAuth Google Authorization Code + PKCE ; API Cloud Code Assist :
  `cloudcode-pa.googleapis.com/v1internal:{loadCodeAssist,
  fetchAvailableModels,streamGenerateContent?alt=sse}`.

## Liens utiles

- Plan Antigravity : `docs/plans/antigravity-provider-kilo-cli.md`
- Zone d'échange opérationnelle : `ACTION_PLAN.md`
- Règles agents Kilo : `.kilocode/rules/00-brain-protocol.md`
- Canal privé : dépôt `AIFlowBridge-Private` → `BRAIN-PRIVATE.md`

---

## Journal (plus récent en haut)

### 2026-09-02 — Perplexity (audit et rôles)
- Découverte : lecture de fichiers possible via la recherche de code GitHub
  (fragments `text_matches`), malgré l'échec de l'outil de lecture directe.
- Audit AP-005/AP-006 réalisé par Perplexity : la gateway OpenAI-compatible
  existe déjà et vise Kilo Code ; Antigravity devient un nouveau
  `ProviderKind`, pas une nouvelle passerelle. Synthèse complète ci-dessus.
- Répartition des rôles validée par Laurent : Perplexity tech lead (code,
  audit, backlog, PR), Kilo exécutant local (build/tests/OAuth), Laurent
  décideur.

### 2026-09-02 — Perplexity
- Création de l'infrastructure de collaboration : `BRAIN.md`, `ACTION_PLAN.md`,
  hook `pre-commit` (pull requis + journal obligatoire), `scripts/install-hooks.js`,
  règles Kilo `.kilocode/rules/00-brain-protocol.md` (commit `f7bc109`).
- Canal privé `AIFlowBridge-Private/BRAIN-PRIVATE.md` (commit `33bce42`).

### 2026-09-02 — Perplexity
- Création du plan d'implémentation Antigravity :
  `docs/plans/antigravity-provider-kilo-cli.md` (commit `2ba3a4c`).
- Décision initiale : passerelle OpenAI-compatible (confirmée par l'audit,
  mais en réutilisant la gateway existante).
