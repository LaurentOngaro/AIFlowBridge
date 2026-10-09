# BRAIN.md - Mémoire du projet AIFlowBridge

> Journal partagé et fil rouge du projet. Ce fichier est la **mémoire commune** entre les agents IA (Kilo Code, Kilo CLI) et le mainteneur humain.
>
> ⚠️ **Ce dépôt est public** : ce fichier ne doit contenir QUE des informations techniques publiables. Voir « Règles de contenu » ci-dessous.

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
2. **Mettre à jour le journal à la fin de toute tâche** (le hook `pre-commit` bloque par défaut tout commit qui ne touche ni `BRAIN.md` ni `ACTION_PLAN.md`).
3. Une entrée de journal = date, agent, action, résultat, liens éventuels. Rester concis et factuel.
4. Ne jamais réécrire l'historique du journal : on ajoute, on ne supprime pas (sauf erreur sensible, voir règles de contenu).
5. Les décisions nouvelles sont d'abord proposées dans le journal, puis consolidées dans « Décisions d'architecture » une fois validées par l'utilisateur.
6. **Aucun commit automatique :** Ne JAMAIS exécuter `git commit` sans demande explicite de l'utilisateur (ex: « fais le commit »). L'agent prépare le code, les tests et le journal, mais l'utilisateur conserve toujours la main sur la validation et l'historique git.

## Règles de contenu (dépôt public)

- ❌ Jamais de : tokens, clés API privées, codes OAuth secrets, cookies, emails privés, données personnelles, URLs internes/privées, montants de facturation détaillés.
- ✅ Autorisé : architecture, décisions techniques, état des tâches, erreurs assainies (sans secret), liens publics, noms de modèles et de providers. - Toute note sensible va dans le canal privé `AIFlowBridge-Private` (`BRAIN-PRIVATE.md`) ; les vrais secrets restent locaux hors git (`.ai/`).
- **Exception documentée pour les credentials OAuth publics de l'AGY CLI**
  (le `client_id` et le `client_secret` sont embarqués dans le binaire
  officiel d'Antigravity, donc techniquement publics) : ils sont hardcodés
  dans `src/aiflowbridge/antigravity/constants.ts` et whitelistés via
  `.github/secret_scanning.yml` (`paths-ignore` + `custom_patterns`).
  Cette exception est signée par l'utilisateur le 2026-09-05 et ne s'applique
  qu'à ces 2 valeurs figées (toute autre valeur dans `constants.ts`
  doit rester hors versionné).
- En cas de doute : ne pas écrire, demander à l'utilisateur.
- **Langue de `_Private/` (décision utilisateur du 2026-10-07)** : les documents déposés sous `_Private/` peuvent être rédigés en français, cet arbre étant gitignoré, exclu du VSIX et lisible par le seul auteur. Le reste du dépôt reste en anglais, y compris le texte de cette règle. Tout document promu vers `_helpers/` ou `docs/` est retraduit en anglais au moment de la promotion.

---

## État du projet (résumé courant)

- **Projet** : AIFlowBridge - assistant de code IA multi-providers pour VS Code,
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

## Contexte technique clé - état consolidé après la 2.17.0

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

1. **Copilot Chat (VS Code LM API)** : `vscode.LanguageModelChatProvider` -
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

> Les entrées ci-dessous documentent les **décisions architecturales** et les  **jalons de release**, qui restent utiles pour la mémoire long terme du projet.

### 2026-10-09 - Kilo (ACTION_PLAN : six entrees terminees restees dans « A faire »)

L'utilisateur signale que `ACTION_PLAN.md` n'etait pas a jour.
Cause reelle, plus structurelle que le contenu : **six entrees marquees `fait` siégeaient encore dans le tableau « A faire »** (AP-029reports de la session precedente, AP-033 / AP-035 / AP-036 / AP-037 / AP-038 de cejour).
Le protocole du fichier (ligne 11) exige de dater et de deplacer une action terminee, et le tableau « Fait » a une colonne Date que « A faire » n'a pas.

**Deux bugs de rendu en prime**, invisibles a la lecture du texte mais visibles au rendu :

- Une ligne vide au milieu du tableau « A faire » (introduite quand j'y ai insere AP-033) **coupait le tableau markdown en deux** : le rendu Markdown ne propage pas les colonnes d'un bloc a l'autre, donc une partie des lignes s'affichait sans entete.
- Une ligne vide au milieu du tableau « Fait », entre AP-034 et les entrees deplacees, meme effet.

**Restructuration** : « A faire » ne contient plus que les 2 entrees reellement en attente (AP-013, AP-025, les deux en attente d'une decision utilisateur), les 6 terminees sont passees dans « Fait » avec leur date reelle (AP-029 -> 2026-10-01, AP-033 -> 2026-10-07, AP-035 a AP-038 -> 2026-10-09).
Les dates ont ete relues dans le journal `BRAIN.md`, pas inventees.

**Leçon de methode** : mes deux premieres tentatives de reconstruction ont echoue (lignes dupliquees, puis lignes vides mal placees) parce que je recollais des plages de lignes brutes au lieu de reconstruire par section.
Il fallait parser, filtrer, puis reassembler.
La verification par blocs contigus de lignes `|` est celle qui prouve qu'un tableau n'est pas coupe.

**Note mise a jour** : la mention des captures perimees (`screenshots_v1.1.1` / `v1.4.0`) disait que `docs/screenshots.md` pointait vers un chemin inexistant ; c'etait vrai avant AP-038, plus maintenant.
Reformule pour distinguer le lien (corrige) de l'archive (toujours presente).

### 2026-10-09 - Kilo (Liens internes de la doc : 37 liens casses corriges, tous verifies)

En开启了 a la demande sur les ancres `architecture.md#model-registry` restees cassees.
La section existe bien dans `docs/architecture.md` ligne 91 (`## Model registry (3-tier)`) : l'ancre correcte est `#model-registry-3-tier`, les 9 liens pointaient vers un titre qui n'a jamais existe.
Corrections : `cost.md`, `gateway.md` (x4), `providers.md` (x3), `reasoning.md`.

**Deux autres familles de liens casses decouvertes au passage**, en elargissant le verificateur a tout le markdown du depot :

- Les 10 fichiers de `docs/agent-instructions/` pointaient vers `../AGENTS.md`, qui resout vers `docs/AGENTS.md` : un cran de trop bas, cible inexistante. Corrige en `../../AGENTS.md`. Ce sont les fichiers les plus lus du depot (contributeurs et agents), et chacun avait son lien racine casse.
- Les 18 images de `docs/screenshots.md` pointaient vers `screenshots_v2.15.5/...`, qui resout vers `docs/screenshots_v2.15.5/` : le repertoire reel est `resources/`. Corrige en `../resources/...`. Le README, lui, utilisait deja le bon prefixe, d'ou l'asymetrie. Impact : les images du doc screenshots etaient casseees sur GitHub et dans le VSIX.

**Verificateur ecrit pour l'occasion** (non commite, a relancer apres toute renommage de section) : calcule les ancres selon l'algorithme GitHub (minuscules, on retire tout sauf lettres/chiffres/espace/tiret, espaces -> tirets), ignore les blocs de code, decode le `%20` des URLs, et verifie ancres + existence des cibles sur les 35 fichiers markdown du depot.
Resultat final : 169 liens de fichier et 47 ancres, **0 casse**.
Les `src="..."` HTML du README sont verifies separement (le verificateur ne voit que les liens markdown).

Le premier passage avait produit 17 faux positifs sur des PNG : `resources/screenshots_v1.1.1/10_antigravity_connect.png` contient par hasard la sequence d'octets `\r\n`, et le scan de type fichier le prenait pour un fichier texte.
Le scan est desormais restreint aux extensions markdown, et `%20` est decode avant resolution.

### 2026-10-09 - Kilo (FormulationuniverselledelamaturitedelrouteOAuth)

Suite d'une question de l'utilisateur : la note « Field maturity » de `docs/providers.md` parlait de « very few users » et de « one user hitting the feature in production ».
C'etait exact au moment de l'ecriture, mais **une statistique d'effectif dans une documentation publique devient fausse** et un lecteur la prendrait pour un etat durable.

Reformulee sans aucun effectif : « This route has not been exercised at scale and its failure modes are not fully characterised.
Both routing defects described above were found in the field, after the feature had already shipped, which means parts of it may still be untested rather than merely unproven. »

La nuance utile est conservee : le defaut n'est pas « la route est fausse » mais « la route a des zones non testees ». **Regle a retenir** : une doc publique ne doit pas contenir de mesure d'audience ; les mesures restent dans le journal (`BRAIN.md`), qui est date et fait pour cela.

### 2026-10-09 - Kilo (Clarification documentaire Gemini + disclaimer honnete sur la route OAuth)

L'utilisateur signale l'ambiguite permanente entre « Google AI Studio OAuth » et « Antigravity », et demande un disclaimer honnete sur le fait que, jusqu'a aujourd'hui, l'usage d'OAuth a souvent ete en realite du routage BYOK.
Il note aussi etre probablement le seul cas d'usage reel, AIFlowBridge etant peu telecharge.

**Faits etablis avant redaction** (pour ne rien affirming de travers) :

- La route OAuth est livree en **2.17.0** ; le champ `authMode` de la telemetrie n'existe que depuis **2.18.2**. Les requetes anterieures sont `unknown` et ne permettent **pas** de determiner quelle route les a servies.
- Les profils sont construits une fois par activation : un changement de route ne prend effet qu'au rechargement de fenetre (comportement documente, la commande propose de recharger).
- Chez l'utilisateur : 151 requetes sur la branche OAuth, **0 succes** ; 120 succes sur la branche BYOK. La branche OAuth a donc ete empruntee, mais jamais avec succes.
- Les deux defauts de routage de 2.23.0 expliquent le « BYOK deguise en OAuth » : le selecteur pouvait annoncer OAuth alors que la gateway servait BYOK (donc facturation au token alors que l'utilisateur croyait etre sur son plan), et il ne verifiait pas que l'ecriture du reglage etait lisible.

**Documentation touchee** : `providers.md` (section OAuth reecrite avec encadre de nommage, statut « jamais observe fonctionnel », piege de facturation, et note de maturite terrain), `gateway.md`, `cost.md`, `dashboard.md`, `standalone.md`, `README.md`, `agent-instructions/registry.md` (nature metadata-only de `vendors.antigravity`), `agent-instructions/architecture.md` (les deux routes du vendor).
Vocabulaire uniformise : « Antigravity » = « Google AI Studio OAuth via Cloud Code Assist », jamais un backend separe.

**Note de maturite assumee** : ecrite explicitement dans la doc.
Le projet a tres peu d'utilisateurs, aucun retour sur cette route, et les deux defauts de routage ont ete trouves par un seul utilisateur en production.
La route est donc documentee comme non exercee a l'echelle, a diagnostiquer a la main en cas d'echec.

**Point d'honnetete** : le disclaimer indique qu'avant 2.23.0 selectionner OAuth ne garantissait pas le routage, et que `authMode` dans le dashboard est le moyen de verifier apres bascule.
Je n'affirme pas que « tout le monde a ete en BYOK » : la branche OAuth a bien ete empruntee chez cet utilisateur, c'est son resultat qui etait systematiquement un echec.

### 2026-10-09 - Kilo (Diagnostic de quota amont : distinguer un 429 récupérable d'un 429 sans allocation)

Origine : l'utilisateur signalait des `429 resource exhausted` sur Gemini via la route OAuth AGY, sans comprendre pourquoi la même version du modèle fonctionnait dans l'extension Antigravity.
Enquête : **la route OAuth n'a jamais fonctionné sur ce compte** (151 tentatives du 04-09 au 09-10, zéro succès 200 dans la télémétrie, contre 120 succès sur la route BYOK).
L'extension Antigravity consomme une autre source de quota que l'API Cloud Code Assist.

**Une hypothèse testée et infirmée** : le quota serait dimensionné par `x-goog-api-client`, notre valeur étant `gl-kiloCode/10.4.1`.
Rejeu de la même requête avec trois valeurs d'en-tête (la nôtre, absente, générique) : 429 dans les trois cas.
L'hypothèse est fausse, je l'ai énoncée puis retirée.

**Livrable** : `src/aiflowbridge/gateway/quota-diagnostics.ts`, module pur qui classe un refus amont en `rate-limited`, `quota-exhausted`, `zero-allocation` ou `billing-exhausted`, sur la présence du bloc `google.rpc.QuotaFailure` et d'une `RetryInfo`.
Le point dur : le corps Cloud Code Assist d'un projet sans allocation est **identique** à celui d'un budget épuisé, sans métrique ni date de réinitialisation.
Le module refuse de deviner quand il n'a pas de preuve (un 429 au corps illisible reste non classifié), parce qu'orienter vers la console pour un simple rate-limit serait pire que de ne rien dire.

Câblage : lecture via `clone()` pour ne pas consommer le corps des chemins aval, ligne actionnable dans `AIFlowBridge: Show logs` (niveau ERROR pour les deux états incurables), en-têtes `X-AIFlowBridge-Quota-State` et `X-AIFlowBridge-Quota-Reset`, corps amont laissé intact pour le client.

**Deux bugs trouvés par les tests** : la regex de détection de rate-limit matchait `rate`, donc `gene-rate-` de `generate_content_free_tier_requests` reclassait un quota journalier en rate-limit ; et le module affirmait `zero-allocation` sur un 429 au corps vide, sans preuve.
Corrigés tous les deux. 20 tests (15 unitaires + 5 de bout en bout), `npm run validate` vert (1428 tests, 80 fichiers).

### 2026-10-09 - Kilo (Clôture du dernier arbitrage : STYLE-1 dans BRAIN.md)

L'utilisateur tranche l'arbitrage ouvert par l'audit AUD02 : nettoyage plutôt qu'exemption.

Les 20 occurrences de U+2014 de `BRAIN.md` sont remplacées par un tiret ASCII.
Le remplacement est exact (réécriture = chaîne d'origine avec substitution), le contenu des entrées de journal est inchangé, seule la ponctuation l'est, et les fins de ligne LF sont préservées.
Le scan de `git ls-files` ne trouve plus aucun tiret cadratin ni demi-cadratin dans le dépôt suivi : c'était le dernier fichier concerné.

`.vscode/aiflowbridge.models.json`, un `{}` vide créé par la commande **Edit model registry** le 2026-10-09 et non suivi par git, est supprimé (il aurait été ajouté au dépôt par un `git add -A`).

### 2026-10-09 - Kilo (Correctif de routage Google AI Studio : GATE-1 et GATE-2)

Incident utilisateur sur Gemini : 402 « prepayment credits depleted » alors que l'utilisateur croyait être sur la route OAuth.
Diagnostic de bout en bout, puis correction de deux défauts hors périmètre de l'audit.

**GATE-1 (majeur)** : la commande `Switch Google AI Studio route` résolvait la route effective avec les clés vendor `['googleaistudio', 'antigravity']` alors que la gateway la résout avec `vendors['googleaistudio']` seul.
Or `vendors.antigravity` est documenté comme « metadata-only » (il épingle l'URL OAuth et les URLs externes pour la bascule et la découverte de modèlesustom).
Un override portant l'OAuth sous `antigravity` faisait donc conclure à la commande « déjà sur OAuth » et refusait d'agir, pendant que la gateway servait la surface BYOK.
Corrigé encentralisant la liste dans `GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS` (`googleaistudio` seul), plus une relecture de la valeur écrite : si la fenêtre ne sert pas le réglage, la commande le signale et nomme l'override à éditer au lieu de procéder, et **ne supprime pas** les vendors périmés, qui seraient le seul choix de route actif.

**GATE-2 (mineur)** : `validateRegistryContent` était appelé hors du `try/catch` de `loadTier`.
La passe de structure garantit les formes itérées, donc rien ne lève aujourd'hui, mais la garantie fail-soft reposait sur une invariant accidentelle.
Les deux passes partagent maintenant une seule frontière.

**Correction d'une affirmation** : j'avais avancé que le palier de registre était ignoré « silencieusement ».
Faux, et le test existant le prouve déjà : `validateRegistryStructure` valide `version` et `models`, et `loadTier` journalise le palier ignoré en WARN avec son chemin.

**Preuve de la logique** : exécution de `loadConfigFromContext` hors VS Code avec le même `settings.json` → les 7 modèles Gemini ressortent en `kind: 'googleaistudio'`, `billing: 'plan'`, `base=cloudcode`.
La logique était donc correcte, l'écart venait de ce que l'hôte servait.

**Ajouts** : `baseUrl` résolu ajouté à la ligne de diagnostic de synthèse des providers, 4 tests de garde, `npm run validate` vert (1408 tests, 79 fichiers).
Correctif appliqué aussi à la configuration locale de l'utilisateur : entrée `vendors.googleaistudio` ajoutée à son override `globalStorage/models.json` (sauvegarde `models.json.bak-before-oauth-route`).

### 2026-10-07 - Kilo (Implémentation de l'audit AUD02, bump mineur 2.23.0)

Les 13 constats de l'audit AUD02 sont traités. Trois corrections de sécurité d'abord, qui change le comportement observable du gateway.

**Boucle de garde loopback** (nouveau module pur `src/aiflowbridge/gateway/loopback-guard.ts`, VS-Code-free) : `Host` sur le port lié et `Origin` eventuellement présent doivent être loopback, sinon 403 sans appel amont.
C'est le `Host` qui arrête le DNS rebinding, l'`Origin` qui ferme le CSRF navigateur. **Écart assumé** : exiger `Content-Type: application/json`, comme le recommandait l'audit, aurait cassé des clients réels (`fetch` avec un corps string sans en-tête envoie `text/plain`, cas de 15 des 17 POST des tests existants) sans rien fermer de plus.
Le motif est écrit dans `readAndValidateBody()` et dans l'en-tête du module pour qu'un agent futur ne le réintroduise pas.

**SSRF** : `BLOCKED_HOSTS` couvre les endpoints par nom (`metadata`, `metadata.google.internal`, `metadata.goog`) et `192.0.0.192`, qu'une liste d'IP ne peut pas fermer puisque la résolution DNS a lieu après le contrôle. `fetch` passe en `redirect: 'manual'` et chaque saut est revalidé par `resolveProviderRedirect()` : budget 2 hops, `307`/`308` uniquement, garde SSRF, **même hostname** (c'est ce qui préserve la montée `http:` vers `https:` d'un relais).
Enfin `aiflowbridge.providers` passe en scope `application`, donc le `.vscode/settings.json` d'un dépôt cloné ne peut plus repointer un `baseUrl`.

**Export CSV** : `escapeCsvValue()` préfixe d'une apostrophe toute valeur ouvrant sur `=`, `+`, `-`, `@`, TAB ou CR, avant le quoting RFC 4180 qui n'empêche pas Excel d'évaluer un champ entre guillemets.
Appliqué au TypeScript et au miroir navigateur, où `\t` et `\r` doivent rester `\\t` / `\\r` sous peine de casser le littéral de regex dans le script injecté.

**Packaging** : `.vscodeignore` exclut `tests/`, `scripts/`, `.githooks/`, `.kilocode/`, `BRAIN.md`, `ACTION_PLAN.md`, `TODO.md`.
Artefact mesuré de 533 entrées / 8,9 Mo à **468 entrées / 4,7 Mo**. `tests/extension-bundle.test.ts` n'affirmait que des inclusions, il gagne les assertions d'exclusion.

**Divers** : alias d'id supprimé de `resolveDetailKey()` (les clés sont désormais `model.deepseek-flash.detail` et `model.deepseek-v4-pro.detail`), `package.nls.json` réduit de 143 à ses 5 clés réellement référencées par le manifeste, réglage `aiflowbridge.providers.googleaistudio.apiKey` supprimé (jamais lu, contraire à l'invariant SecretStorage), `scripts/` déplacé sous `_helpers/scripts/` avec ses 4 références, et les instructions d'agent alignées sur le vendor unique `aiflowbridge`.

**50 tests ajoutés** (25 dans les 2 nouveaux fichiers `tests/loopback-guard.test.ts` et `tests/integration/googleaistudio.smoke.test.ts`, 25 blocs dans 5 fichiers existants), suite de 1351 à 1401 tests. `npm run validate` vert (79 fichiers), `compile:standalone` vert, bundle standalone vérifié. **Bump mineur 2.23.0 demandé par l'utilisateur** (et non patch : la garde `Host` / `Origin` renvoie 403 là où la gateway répondait 200, et le refus de redirection change un comportement observable), sur `package.json`, `package-lock.json`, tampon `aiflowbridgeVersion` de `resources/pricing.json`, CHANGELOG et 5 docs. **Non commité** : règle « aucun commit automatique » (AP-020).

Reste ouvert, et c'est le seul point non tranché par moi : les 20 tirets cadratins de `BRAIN.md` (voir « Questions / Blocages »).

### 2026-10-07 - Kilo (Audit de code complet AUD02 + français autorisé dans `_Private/`)

Audit statique de l'intégralité de l'arbre de travail sur AIFlowBridge 2.22.1 : `src/` (100 fichiers), `tests/` (86), `resources/`, `package.json`, `.vscodeignore`, et contenu réel de `dist/aiflowbridge-2.16.1.vsix`.
Limite assumée : `npm test` et `npm run compile` n'ont pas été exécutés, tous les constats sont statiques et sourcés.

**13 constats, dont 3 de sécurité (majeurs)** : passerelle loopback sans authentification ni contrôle d'`Origin` / `Host` (CSRF via `Content-Type: text/plain` et DNS rebinding sur `/v1/sessions`, `/v1/replay/{id}`), SSRF incomplet (noms de métadonnées résolus par DNS non bloqués, `fetch()` sans `redirect: 'manual'`, `baseUrl` exposed au scope workspace), export CSV sans garde contre l'injection de formule (`responseSummary` provient de la sortie du modèle amont), VSIX publiant 825 Ko d'outillage de dev et le journal de projet IA (`tests/`, `scripts/`, `.githooks/`, `BRAIN.md`, `ACTION_PLAN.md`, `TODO.md`), et table d'alias d'id résiduelle dans `src/provider/models.ts:170` qui contredit l'invariant du registre.

**Décision utilisateur du 2026-10-07** : le français est autorisé pour les documents de `_Private/**`, l'arbre étant local-only et non publié.
Règle inscrite dans `AGENTS.md`, `docs/agent-instructions/style.md` et `docs/agent-instructions/working-notes.md` (section « Language »).
Les autres règles de style continuent de s'appliquer (diacritiques obligatoires, pas de tiret cadratin, guillemets ASCII, plafond de 250 caractères par ligne).

Rapport complet : `_Private/docs/2026-10-07_audit-code-review.md` (AUD02, privé).
Décisions encore ouvertes pour l'utilisateur : le sort des 20 tirets cadratins de `BRAIN.md` (ce fichier reste en français, la règle ne s'appliquant qu'à `_Private/`), et le déplacement de `scripts/` vers `_helpers/scripts/`.

### 2026-10-07 - Kilo (Kilo Code : le dropdown de raisonnement n'est pas alimenté par AIFlowBridge)

Signalement utilisateur : le sélecteur de mode de raisonnement de l'extension **Kilo Code** propose `Défaut` / `None` / `Thinking` pour `MiniMax-M3.1-Flash-Preview`, au lieu des 5 niveaux ajoutés par AP-029 (capture d'écran à l'appui).

**Ce n'est pas un défaut AIFlowBridge : la liste appartient à Kilo Code.** Vérifié dans la source de Kilo (`Kilo-Org/kilocode`, `main`) :

- `ThinkingSelector` (webview) rend `session.variantList(sessionID)`, plus une ligne `Default` (`common.default`) quand `allowClear` est actif. Le libellé est `value.charAt(0).toUpperCase() + value.slice(1)`, donc `none` -> `None`, `thinking` -> `Thinking`. Aucune clé i18n par variante.
- `variantList` vient de `model.variants`. Les variantes proviennent de la configuration Kilo (`kilo.json`, `provider.<id>.models.<model>.variants`) et des plugins de catalogue de Kilo. Le seul générateur pour un provider `@ai-sdk/openai-compatible` est `packages/core/src/plugin/variant.ts`, qui ne produit que `high` / `max` **pour GLM 5.2**. Aucun plugin ne génère `none` / `thinking` pour un modèle MiniMax.
- **`GET /v1/models` ne peut pas servir de source** : `buildModelCatalog()` ne renvoie que `{id, object, created, owned_by, name}`, et Kilo ne lit aucune métadonnée de variante de toute façon.

**Deuxième vérification, celle qui compte pour le correctif :** la valeur d'une variante arrive bien intacte au gateway.
La migration v1 -> v2 transforme chaque entrée de `variants` en `{ id, body: lowerer.request(options) }`, et le lowerer `@ai-sdk/openai-compatible` fait `result.reasoning_effort = options.reasoningEffort` **sans filtrer les valeurs** (contrairement au lowerer `@ai-sdk/openai`, qui replie l'effort dans `reasoning: { effort }`, et contrairement à `OpenAIReasoningEfforts` de `packages/llm` qui exclut `max`, mais qui ne s'applique pas à ce chemin).
Donc `xhigh` et `max` passent bien sur le fil, et `translatePayloadForUpstream()` les relaie verbatim pour un modèle qui déclare `reasoningEffortLevels`.

**Conséquence : le correctif est côté `kilo.json`, pas dans ce dépôt.** Le snippet exact est désormais documenté dans `docs/kilo-code.md` (section « Reasoning effort: Kilo Code owns the list, not AIFlowBridge ») avec l'ancre appelée depuis `docs/reasoning.md`, et résumé dans le CHANGELOG 2.22.0.
Point de vigilance ajouté à la doc : ne pas déclarer de variante `none` pour un modèle qui déclare un range, la gateway abandonnant la valeur non déclarée et épinglant `reasoning_split: true` - l'entrée promettrait ce que le modèle ne peut pas faire.

**Complément utilisateur, même journée.** En sélectionnant directement le provider **minimax** de Kilo pour M3.1 Flash Preview, l'utilisateur voit les bonnes valeurs : c'est cohérent avec le diagnostic, les variantes étant déclarées **par provider et par modèle**.
Le provider `minimax` natif embarque le catalogue de Kilo Code pour ce modèle, alors qu'un provider custom pointant sur la gateway ne porte que ce que la configuration locale déclare.
Le chemin natif contourne par ailleurs AIFlowBridge (protocole Anthropic Messages vers `api.minimax.io`, clé MiniMax saisie dans Kilo), ce qui explique qu'il n'ait rien à voir avec notre registre.

**Origine des entrées `None` / `Thinking`, trouvée dans la doc Kilo elle-même.**
`packages/kilo-docs/pages/code-with-ai/agents/custom-models.md` recommande, pour MiniMax sur un endpoint OpenAI-compatible, `variants: { thinking: { reasoning_split: true } }`.
C'est donc la doc de Kilo qui a produit la configuration fautive, et non une croyance : `reasoning_split` est un booléen de **format de réponse** (renvoie la réflexion dans `reasoning_content` au lieu de `<think>` inline), pas une profondeur.
Une paire construite dessus est un sélecteur de mise en forme déguisé, et `Thinking` retombe sur le même comportement amont que `High` dès que la profondeur vient de `reasoning_effort`.
Point à garder en tête quand une doc d'un tiers propose un snippet : vérifier ce que le champ fait réellement chez l'amont avant de le recopier.

**Le sélecteur d'effort de la boîte de dialogue Kilo s'arrête à `xhigh`.**
`CustomProviderModelCard.tsx` type `ReasoningEffortValue = "none" | "minimal" | "low" | "medium" | "high" | "xhigh"` : l'entrée `max` du registre M3.1 **n'est pas créable depuis l'UI**, il faut l'ajouter à la main dans `kilo.json`.
Détour incorrect par ailleurs : le champ `effort` du formulaire est l'effort de **sortie** (`OutputEffortValue` inclut `max`), pas la profondeur de raisonnement, et l'API OpenAI-compatible de MiniMax ne le prend pas.
En revanche la valeur `max` écrite à la main passe bien sur le fil (lowerer `@ai-sdk/openai-compatible` sans filtre de valeurs, contrairement à `OpenAIReasoningEfforts` de `packages/llm` qui exclut `max` mais ne s'applique pas à ce chemin).

**Leçon de méthode (même famille qu'AP-022 / AP-027).** Le premier réflexe est d'aller chercher un cache périmé ou une liste de niveaux dupliquée dans notre code.
La vérification utile est de remonter la chaîne jusqu'au propriétaire de la donnée : ici le propriétaire est le client, et la question à poser n'est pas « qu'est-ce qui n'a pas été régénéré ? » mais « qui produit cette liste ? ».

**Limite assumée** : le `kilo.json` en cause est sur la machine Windows de l'utilisateur, inaccessible depuis cet environnement ; le diagnostic repose sur la lecture de la source publique de Kilo Code et non sur l'inspection du fichier local.
Le contenu exact de la liste affichée par le provider `minimax` natif n'a pas pu être vérifié : ni le dépôt public ni `models.dev` (qui ne liste que `MiniMax-M3` et les M2.x) ne portent d'entrée `MiniMax-M3.1-Flash-Preview`, donc ce catalogue vient du gateway Kilo, hors de portée d'ici.
**Non commité** : règle « aucun commit automatique ».

### 2026-10-07 - Kilo (commande `Configure Kilo Code reasoning levels` : plus d'édition manuelle)

**Décision utilisateur, explicite :** demander à l'utilisateur d'éditer `kilo.json` à la main est contre-productif, donc ce n'est pas une solution acceptable.
Il faut que ce soit l'extension qui écrive la configuration du client.

**Preuve qui ferme la voie « le gateway porte les niveaux ».** `packages/kilo-vscode/src/shared/fetch-models.ts` (Kilo) : `fetchOpenAIModels` lit `body.data` et n'en extrait que `item.id` et `item.name`.
Tout le reste de la réponse `/v1/models` est ignoré.
Ajouter `variants` (ou `reasoning_effort_levels`, ou n'importe quelle métadonnée) à notre catalogue OpenAI n'aurait donc **aucun effet** sur le dropdown : ce n'est pas un oubli de notre format, c'est le client qui ne lit pas.
La seule voie restante est d'écrire le fichier de configuration Kilo, ce que fait désormais la commande.

**Implémentation.**

- `src/aiflowbridge/kilo-code-config.ts` (pur, sans `vscode`) : lecteur JSONC (`stripJsonComments` + `stripTrailingCommas`, scanners sensibles aux littéraux de chaîne pour ne pas casser une URL contenant `//`), `endpointKey` (compare `host:port`, `localhost` = `127.0.0.1`, suffixe `/v1` indifférent), `findGatewayProviderIds`, `buildEffortVariants`, `collectEffortLevelModels`, `applyEffortVariants` (pur, clone, remplace le bloc `variants` du modèle géré, force `reasoning: true`, crée la map `models` si le provider se repose sur l'auto-détection), `isAlreadyConfigured` (idempotence).
- `src/runtime/configureKiloCode.ts` : localise le fichier dans l'ordre de découverte de Kilo (`.config/kilo`, `.kilo`, `.kilocode` x `kilo.jsonc`, `kilo.json`, premier existant sinon `.config/kilo/kilo.json`), refuse d'écrire un fichier non parsable, détecte le provider (auto, QuickPick si plusieurs, InputBox si aucun), modale de confirmation détaillant le avant/après, écriture atomique tmp+rename puis `chmod 600` (le fichier contient généralement une clé de provider), `$schema` replacé en tête, résumé + révélation du fichier.

**Garde-fous retenus à dessein.** Le helper existant `resetGlobalStorageRegistryOverride` traite un fichier illisible comme `{}` et repart d'une base propre : c'est correct pour *notre* fichier de registre, et catastrophique pour une configuration tierce.
La version Kilo échoue et affiche le chemin à la place.
Le réécriture supprime aussi les commentaires d'un `.jsonc`, ce qui est dit dans la modale **avant** écriture plutôt que découvert après.
19 tests ajoutés dans `tests/kilo-code-config.test.ts` (parseur JSONC, détection de provider, génération, remplacement de la paire `none`/`thinking`, préservation des autres providers et de la clé, non-mutation, provider sans map `models`, idempotence, projection du registre).
Vérifié en plus par une simulation bout en bout hors VS Code sur un `kilo.jsonc` réaliste (commentaires + paire Kilo + clé MiniMax voisine) : provider détecté, 5 variantes écrites, provider voisin et clé intacts, deuxième passage idempotent.
`npm run validate` : 1344 tests verts (77 fichiers), compile et `typecheck:tests` verts.

**Limite assumée** : la commande n'a pas été exercée depuis VS Code (pas d'hôte ici) ; la logique métier est couverte par tests unitaires et par la simulation, mais le dialogue utilisateur (modale, QuickPick, révélation) n'a pas été validé en conditions réelles.
Le `kilo.json` de l'utilisateur est sur sa machine Windows, hors de portée.

**Non commité** : règle « aucun commit automatique ».

### 2026-10-07 - Kilo (automatisation de l'offre : plus rien à faire à la main)

**Retour utilisateur** : la commande fonctionne (« ok cela fonctionne après avoir lancé la nouvelle commande ») et la demande est explicite : « il faut documenter cela ou alors automatiser son exécution lorsque minimax 3.1 est sélectionné ».
Les deux sont faits, l'automatisation étant la partie qui change la vie.

**Choix du déclencheur : activation, pas moment de la requête.** Kilo Code construit son dropdown **au démarrage d'une session**, donc une écriture déclenchée par une requête arriverait trop tard pour réparer la session qui l'a produite ; elle ne servirait qu'à la suivante, en passant par un callback gateway -> hôte (surface transverse réelle) pour un résultat médiocre.
Le contrôle à l'activation couvre la session suivante sans que l'utilisateur ait à se souvenir de la commande, coûte une petite lecture de fichier, et n'a pas besoin de plomberie.
Décision à assumer : l'offre apparaît au (re)chargement de fenêtre, pas au premier envoi de requête.

**Ce qui déclenche, et surtout ce qui ne déclenche pas.** Nouvelle fonction pure `checkEffortVariantsNeeded()` : elle n'offre que si un provider Kilo pointe sur la gateway **et** que ses variantes diffèrent des niveaux déclarés.
Aucun provider détecté -> silence (à l'activation on ne peut pas deviner quel id l'utilisateur aurait choisi, et deviner et écrire dans un provider non concerné serait pire que de ne rien faire).
Fichier absent, illisible, aucun modèle à niveaux, configuration déjà correcte -> silence.
Un test verrouille ce cas limite : un provider id absent du fichier donne `offer: false`, parce qu'il n'y a rien à mettre à jour et que c'est la commande manuelle qui signale proprement le provider manquant.

**Offre, pas écriture silencieuse.** Message non modal listant les modèles concernés, avec trois actions : écrire maintenant / plus tard / ne plus demander (qui passe `aiflowbridge.kiloCode.promptReasoningLevels` à `false` en Global).
Raison inchangée : réécrire un `.jsonc` supprime ses commentaires, cela se demande, ça ne se fait pas dans le dos de l'utilisateur.
Le module est monté en fire-and-forget après `loadModelRegistry()` (le contrôle a besoin des modèles à niveaux) et garde un drapeau `offerEvaluated`, donc une fenêtre n'offre qu'une fois.

**Choix du wording** : la documentation ne dit pas « lancez cette commande », elle dit « dans le cas courant, il n'y a rien à faire ».
Une doc qui décrit une étape manuelle que l'extension fait déjà dévalue le produit ; la commande reste documentée comme le chemin manuel et le filet de sécurité.

7 tests ajoutés dans `tests/kilo-code-config.test.ts` (26 au total dans le fichier, 1351 dans la suite). `npm run validate` : 1351 tests verts, compile et `typecheck:tests` verts, `compile:standalone` vert.
**Limite assumée** : le dialogue utilisateur (message d'offre, bouton « ne plus demander ») n'a pas été exercé depuis VS Code dans cet environnement ; seul le prédicat est couvert par tests.

**Bump patch 2.22.1 demandé par l'utilisateur**, qui avait lui-même séparé les entrées Kilo dans le CHANGELOG : la livraison M3.1 (2.22.0) reste une section à part entière, le travail Kilo Code devient le patch.
Raison operationale donnée : le redémarrage cooperative de la gateway ne se déclenche que sur une version **strictement plus récente** que le pair qui tourne, donc sans bump un F5 rejoint l'instance 2.22.0 deja en vie au lieu de la remplacer.
Leçon utile : en dev loop F5, un bump de version est un mécanisme fonctionnel, pas une formalite de release.
**Non commité** : règle « aucun commit automatique ».

Demande utilisateur : le thinking de MiniMax M3.1 est toujours actif et le modèle était donc inutilisable avec le sélecteur « Thinking Effort » de Copilot Chat, qui n'offrait que None / High / Max, ce dernier étant un simple booléen `reasoning_split`.
Or l'upstream M3.1 expose une **profondeur** réglable via un vrai champ `reasoning_effort` à 5 niveaux : `low`, `medium`, `high`, `xhigh`, `max` (`none` y renvoie 400, `max` est le défaut amont).

**Décision : la profondeur est une propriété du modèle, déclarée dans le registre.** Nouveau champ optionnel `reasoningEffortLevels` (liste ordonnée, validée, fusionnée par `deepMergeModel`), qui pilote à la fois le contenu du dropdown et la valeur relayée.
C'est le même principe que `requiresThinkingParam` en AP-026 : la contrainte est portée par l'entrée de registre du modèle, pas par le vendor, donc un modèle qui expose un vrai `reasoning_effort` en hérite sans code.

**Deux formes mutuellement exclusives, décidées par cette seule déclaration.**

- Modèle **avec** `reasoningEffortLevels` (M3.1) : le sélecteur liste exactement ces niveaux, `reasoning_split` est épinglé à `true` (l'amont refuse `false` sur ce modèle, et c'est ce champ que le lecteur de stream consomme), la valeur est relayée **verbatim** en `reasoning_effort`.
- Modèle **sans** ce champ (M3 et antérieurs) : comportement inchangé, None / High / Max -> `reasoning_split` booléen, défaut `high`.
Aucune régression sur les modèles antérieurs, ce que la demande énonçait explicitement.

**Ordre de résolution** (identique sur les deux chemins, deux fonctions pures) : sélection du picker si c'est un niveau déclaré, sinon le setting `aiflowbridge.providers.minimax.reasoningEffort`, sinon le niveau le plus élevé de la liste (défaut amont).
Un niveau non déclaré est **abandonné** plutôt que relayé : une faute de frappe du client retombe sur le défaut amont au lieu d'envoyer un 400.

**Pourquoi une fonction pure de plus.** La résolution était inline dans `provideLanguageModelChatResponse`, donc testable seulement en instanciant le provider avec un faux `vscode`. `resolveMiniMaxReasoning()` la sort en fonction pure (entrée de registre, options, deux settings en paramètres) : 10 tests sans hôte VS Code.
C'est le prolongement direct de la leçon AP-026, où la politique « thinking obligatoire » avait été rendue testable de la même façon.

**Extension du test i18n.** Les clés `thinking.<level>` et `thinking.<level>.desc` sont construites dynamiquement depuis le registre, donc invisibles au scan statique.
Entrée déclarée dans `KNOWN_DYNAMIC_CALL_SITES` (`src/provider/models.ts`), avec repli sur un niveau capitalisé et une description vide pour un niveau sans traduction, afin qu'un registre utilisateur portant un nom de niveau inconnu produise quand même un dropdown lisible.

**Vérifié** : `npm run validate` (1310 tests, 27 nouveaux) et `compile:standalone` verts.
**Limite assumée** : les 5 niveaux et leur refus de `none` viennent de la documentation officielle MiniMax (`platform.minimax.io`, page OpenAI SDK), pas d'un appel réel, cette machine n'ayant pas de clé M Plan / MiniMax Code servie par M3.1.
**Non commité** : règle « aucun commit automatique ».

### 2026-10-03 - Kilo (Gemini : résultat d'outil en tableau de parts, 400 « Proto field is not repeating »)

Erreur remontée par l'utilisateur sur un chat Gemini 3.8 via la gateway : `Invalid JSON payload received.
Unknown name "response" at 'contents[2].parts[0].function_response': Proto field is not repeating, cannot start list.`, HTTP 400 `INVALID_ARGUMENT`.

**Cause.** Dans les deux traducteurs Gemini, la branche `role === 'tool'` faisait `msg.content as Record<string, unknown>` sans garde `Array.isArray`.
`typeof [] === 'object'`, donc un client qui envoie le résultat d'outil sous forme de tableau de content parts (`content: [{ type: 'text', text: '...' }]`, forme OpenAI valide) le voir passer tel quel dans `functionResponse.response`, sérialisé en `"response": [ ... ]`.
Or `FunctionResponse.response` est une `google.protobuf.Struct` sur les deux surfaces Gemini : un champ non repeated, donc une liste y est un 400.
Le même chemin accepte aussi une chaîne JSON qui décode en tableau (`'[1,2,3]'`), deuxième source du même 400.

**Preuve.** Repro exécutée sur `toGeminiNativeRequest` avant correctif : `content: [{type:'text',text:'file body'}]` produisait exactement `{"functionResponse":{"name":"tool","response":[{...}]}}` en `contents[2].parts[0]`, le chemin cited par l'erreur utilisateur.
Aucune mutation de message `tool` n'existe dans la gateway (`server.ts` n'a aucune branche `role === 'tool'`), donc la forme vient bien du client.

**Même cause structurelle que AP-027 : la logique était dupliquée.** `gemini-native.ts` (BYOK `googleaistudio`) et `envelope.ts` (OAuth Antigravity) avaient chacun leur copie de l'analyse du résultat d'outil, donc le même 400 sur les deux surfaces.
Correction dans le même sens qu'AP-027 : source unique `toFunctionResponseValue()` dans `src/aiflowbridge/antigravity/content-parts.ts` (module déjà partagé par les deux traducteurs), qui aplatit un tableau de parts en texte puis le ré-analyse, garde un objet JSON tel quel, et enveloppe tout le reste en `{ result: ... }`.
Un payload structuré survit au travers du tableau : `[{ text: '{"temp":18}' }]` donne toujours `{ temp: 18 }`.

**Second défaut latent corrigé au passage.** Le nom de la fonction venait de `msg.name ?? 'tool'` (resp. `'tool_response'`), alors qu'un message `tool` OpenAI porte l'information dans `tool_call_id` et que `name` est facultatif.
Un placeholder ne correspond à aucun `functionCall` déclaré.
Les deux traducteurs construisent maintenant une table `tool_call_id` -> nom en parcourant les tours assistant, et ne retombent sur le placeholder qu'en dernier recours.

**Diagnostic observable.** Le helper n'émet un `warn` que dans le cas qui échouait (`[Gemini] tool message content is a content-parts array (N entries) - flattened, functionResponse.response must be a JSON object`), donc `AIFlowBridge: Show logs` révèle désormais quels clients utilisent cette forme.
Volume faible par construction.

**Vérifié.** `npm run validate` : 1283 tests verts (7 nouveaux, 4 dans `tests/gemini-native.test.ts`, 3 dans `tests/antigravity-envelope.test.ts`, sur les deux surfaces), `compile:standalone` vert.
**Bump mineur 2.21.0 demandé par l'utilisateur** : `package.json`, `package-lock.json`, `resources/pricing.json` (`aiflowbridgeVersion`), `CHANGELOG.md` et les 4 docs mentionnant la version (`README.md`, `docs/providers.md`, `docs/cost.md`, `docs/architecture.md`).
Suppression des deux fichiers de plans devenus obsolètes dans `docs/plans/`.
**Limite assumée** : comme pour AP-027, aucun appel réel vers Gemini (pas de clé AI Studio exploitable depuis cette machine) ; la correction est prouvée par test unitaire sur la forme exacte du rapport, et non par un aller-retour upstream.
**Non commité** : règle « aucun commit automatique ».

### 2026-10-01 - Kilo (Gemini : mots-clés JSON Schema refusés par l'upstream)

Erreur remontée par l'utilisateur sur Gemini 3.8 Flash via la gateway : `Invalid JSON payload received.
Unknown name "propertyNames" at 'tools[0].function_declarations[45].parameters.properties[3].value': Cannot find field.`, HTTP 400 `INVALID_ARGUMENT`.

**Cause.** Le chemin Gemini natif (`generativelanguage.googleapis.com`, `isGenerativeLanguageBaseUrl`) nettoie les schémas d'outils via `cleanJsonSchema`, mais sa liste de mots-clés refusés ne contenait pas `propertyNames`, un mot-clé de validation JSON Schema draft-06+ présent dans les schémas d'outils envoyés par les clients.
Un seul mot-clé inconnu fait tomber la requête entière, même si l'outil est valide.

**Vraie cause structurelle : la liste était dupliquée.** `gemini-native.ts` (BYOK natif) et `envelope.ts` (OAuth AGY) avaient chacun leur `FORBIDDEN_SCHEMA_KEYS`, et elles avaient déjà divergé : la copie d'`envelope.ts` documentait `exclusiveMinimum` / `exclusiveMaximum` dans un commentaire, celle de `gemini-native.ts` non.
Deux listes, aucune ne fait autorité, c'est exactement ce que BRAIN signale pour BUG-07.
Correction : un module unique `src/aiflowbridge/antigravity/json-schema-clean.ts` porte le sanitiseur et ses listes, réexporté par `envelope.ts` pour ne pas casser sa surface publique.
Le doublon disparaît, donc le même écart ne peut plus se reproduire.

**Source de vérité pour la liste, pas mémoire.** Interrogation de la discovery API officielle de Google (`$discovery/rest?version=v1beta`, puis `v1` pour contrôle) : les 22 champs de `Schema` sont identiques dans les deux versions. `propertyNames` n'y est pas, ce qui confirme le diagnostic.
La liste des mots-clés refusés a été complétée avec les frères de la même famille qui échoueraient de la même façon : `const`, `oneOf` / `allOf` / `not` (Gemini n'accepte que `anyOf`), `patternProperties`, `prefixItems`, `contains`, `uniqueItems`, `additionalItems`, `unevaluated*`, `dependent*`, `if` / `then` / `else`, `content*`, `$anchor` / `$comment` / `$vocabulary`.

**Décision de ne pas élargir au-delà du bug, assumée et documentée.** La discovery indique que Gemini accepte `format`, `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `minProperties`, `maxProperties`, et l'ancien sanitiseur les retirait quand même.
Les conserver gagnerait en précision d'appel d'outil, mais le document de découverte est la surface *documentée*, et un mot-clé ne vaut pas le risque d'un 400 sur la requête entière pour un gain marginal.
Le code sépare donc explicitement `GEMINI_SCHEMA_FORBIDDEN_KEYS` (rejet upstream, la.base du correctif) de `GEMINI_SCHEMA_STRIPPED_KEYWORDS` (prudence historique, conservée), avec le raisonnement écrit dans les constantes.
**Aucun appel réel n'a pu être fait vers Gemini** : aucune clé AI Studio n'est configurée sur cette machine.
La transformation est donc prouvée par test unitaire et non par un appel upstream, ce qui est une limite assumée de cette vérification.

**Garde-fou ajouté.** `tests/gemini-json-schema.test.ts` vérifie que l'ensemble « acceptés » et l'ensemble « refusés » ne peuvent jamais se recouvrir (invariant), que le recouvrement avec l'ensemble « retirés par prudence » est exactement la liste attendue (donc toute dérive est visible), et que les mots-clés du rapport restent refusés (donc le correctif ne peut pas être défait par une édition bien intentionnée).

**Vérifié.** `npm run validate` : 1276 tests verts (13 nouveaux dans `gemini-json-schema.test.ts`, 1 nouveau dans `gemini-native.test.ts` qui rejoue le schéma exact du rapport, imbriqué au même niveau `properties[3]`), `build:standalone` vert.
Le chemin Gemini 3.8 est bien celui corrigé (`vendors.googleaistudio.baseUrl` = `https://generativelanguage.googleapis.com/v1beta`).
**Validation par l'utilisateur le 2026-10-01** : la requête qui échouait passe désormais, donc le correctif est confirmé contre l'API Gemini réelle, ce que je ne pouvais pas faire faute de clé AI Studio sur la machine.
**Une affirmation non vérifiée a été retirée au passage, dans les deux sens.** Je ne disposais d'aucun moyen de tester Z.ai ni Moonshot, donc l'énoncé « GLM 5.3 et Kimi K3 rejettent `thinking.type: disabled` » ne venait que de la doc existante, pas d'une vérification.
Le CHANGELOG le dit maintenant explicitement (parenthèse : leur refus provient du drapeau du registre et de la documentation, il n'a pas été reconfirmé contre l'upstream), et `docs/providers.md` a été reformulé pour ne plus affirmer un 400 côté GLM/Kimi mais décrire le seul comportement réellement garanti, la réécriture par la gateway.
Un changelog qui présente une déduction comme une mesure est le même défaut que le `requiresThinkingParam` jamais lu : une affirmation que rien ne vérifie.
**Non commité** : règle « aucun commit automatique ».

### 2026-10-01 - Kilo (MiniMax M3.1 Flash Preview : le raisonnement ne peut pas être coupé)

Erreur remontée par l'utilisateur via Kilo Code sur la gateway : `invalid params, model "MiniMax-M3.1-Flash-Preview" requires adaptive thinking; thinking.type="disabled" (including reasoning.effort=none) is not allowed (2013)`, HTTP 400.

**Diagnostic empirique, pas documentaire.** Une sonde contre l'API MiniMax (`api.minimax.io/v1/chat/completions`) a établi le refus exact avant d'écrire la moindre ligne : `reasoning_split: false` -> 400 `requires reasoning_split=true`, `thinking.type: "disabled"` -> 400, `reasoning_effort: "none"` -> 400, alors que l'absence de paramètre, `reasoning_split: true`, `thinking.type: "enabled"`, `thinking.type: "adaptive"` et `reasoning_effort: "high"` passent tous. `reasoning: {effort: "none"}` (objet) est ignoré par l'upstream.
MiniMax-M3 accepte `reasoning_split: false`, donc la contrainte est propre à M3.1.
Conséquence de conception : l'upstream ne laisse aucun choix, donc renvoyer une erreur à l'utilisateur le priverait de la seule chose qui marche.
La gateway sert la requête qu'elle peut réellement servir.

**Découverte : `requiresThinkingParam` existait déjà et n'était lu par personne.** Le champ est dans le registre, validé, fusionné, documenté, et déjà positionné à `true` sur GLM 5.3, Kimi K3 et DeepSeek, mais propagé dans `src/provider/base.ts` vers une structure dont aucun code ne le consomme.
Plutôt que d'inventer un drapeau ou une liste de noms codée en dur, la correction câble ce champ existant, ce qui referme au passage un trou déjà consigné comme « déclaré mais non branché ».

**Deux chemins de même symptôme, deux corrections.** La gateway traduisait déjà `reasoning: false` et `reasoning_effort: "none"` en `reasoning_split: false` (donc produisait elle-même le refus), et laissait passer `thinking` tel quel (donc l'erreur de l'utilisateur, venue d'un client qui envoie `thinking.type`).
Le provider Copilot Chat MiniMax, lui, obtenait `reasoning_split: false` du picker « Thinking Effort = None » ou du setting global.
Les deux sont traités, avec le même drapeau.

**Ordre d'application, une erreur de parcours.** Appliquer la politique avant la traduction supprimait `reasoning_effort: "none"`, que la traduction MiniMax doit précisément lire pour produire `reasoning_split` ; le test l'a révélé (`reasoning_split` undefined).
La traduction passe donc d'abord, la politique ensuite, dans les deux branches vendor.

**La politique est une propriété du modèle, pas du vendor.** Elle s'applique aussi aux providers non-MiniMax, ce qui répare au passage le cas que la documentation décrivait pour GLM 5.3 (« le gateway relaie le payload inchangé, évitez `thinking.type: disabled` »).
Cette phrase de la doc était une consigne de contournement là où le produit peut faire le travail.
Un corps qui ne dit rien du raisonnement n'est jamais touché : l'upstream garde son défaut, la gateway n'invente pas de paramètre.

**Vérifié de bout en bout, deux fois.** Gateway standalone relancée après refactor, 5 cas : `reasoning_effort: none`, `reasoning: false`, `thinking.type: disabled`, `reasoning_effort: high`, et absence totale de signal sur M3.1, plus `reasoning_effort: none` sur M3.
Les 6 répondent 200.
Les logs montrent les 3 forcages avec le message d'info, l'absence de forçage pour `high` et pour l'absence de signal, et `reasoning_split=false` inchangé sur M3.

**Constat hors périmètre, non corrigé.** Le catalogue affiche `MiniMax-M3.1-Flash-Preview pricing=in=0.3/M out=1.2/M` alors que le registre déclare explicitement l'absence de tarif publié pour ce modèle : le prix vient de `DEFAULT_GATEWAY_PROFILES` (`src/aiflowbridge/host-config.ts`), en dur et non aligné sur l'entrée du registre.
À trancher par l'utilisateur, hors du correctif demandé.

Gate : `npm run validate` (compile + 1262 tests + `typecheck:tests`) et `npm run build:standalone` verts.
**Non commité** : règle « aucun commit automatique ».

### 2026-10-01 - Kilo (Alias env nus pour les clés d'API, découverte générique)

Demande utilisateur, en deux temps : accepter les variables nues `DEEPSEEK_API_KEY`, `GOOGLEAISTUDIO_API_KEY`, `MINIMAX_API_KEY`, `MOONSHOT_API_KEY`, `OPENROUTER_API_KEY`, `XIAOMI_API_KEY`, `ZAI_API_KEY`, puis généraliser la recherche pour qu'un provider ajouté ultérieurement trouve sa clé sans code.

**L'ordre de priorité de la chaîne de clés est inchangé** : env (source 1) > `secrets.json` > `SecretStorage` VS Code.
L'alias est lu au même rang que le nom préfixé, pas à un rang inférieur : c'est la même source, donc un alias défini doit continuer à gagner sur le fichier.
Quand les deux sont définis, le nom préfixé gagne, ce qui préserve strictement le comportement de toute configuration existante.

**Deux mécanismes, pas un.** `envAliasForSecretKey()` dérive l'alias du nom canonique en retirant `AIFLOWBRIDGE_` (O(1), chemin nominal). `findBareEnvNameForSecretKey()` scanne l'environnement et valide qu'un nom est exactement `<VENDOR>_API_KEY` pour un vendor déclaré.
Le second est le filet générique demandé : il fonctionne même si le nom canonique d'un futur vendor ne suit pas la convention de retrait du préfixe.
Les deux positions sont complémentaires, pas redondantes.

**La source de vérité du scan est `API_KEY_SECRETS` (`src/consts.ts`), pas une table dédiée.** C'est la décision structurante : un vendor ajouté là est détecté automatiquement, et il n'existe pas de seconde liste où l'oublier pourrait se traduire par une clé lue comme « non configurée » sans erreur visible (la classe BUG-07 signalée plus haut dans ce fichier).
`SECRET_KEY_TO_ENV_NAME` reste la source de vérité du seul nom **préfixé**, qui n'est pas couvert par le scan.
`bareEnvNameForVendor()` est exportée pour que la couverture puisse être affirmée en itérant `API_KEY_SECRETS` : un test fait exactement cela, donc un vendor ajouté sans son nom nu câblé donne un test rouge plutôt qu'une panne silencieuse.

**Validations du nom, testées.** Rejet de `DEEPSEEK_KEY`, `DEEPSEEK_API_KEY_EXTRA`, `MY_DEEPSEEK_API_KEY`, `_API_KEY`, et de `AIFLOWBRIDGE_DEEPSEEK_API_KEY` (le token `AIFLOWBRIDGE_DEEPSEEK` ne correspond à aucun vendor).
La comparaison est insensible à la casse, car les noms d'environnement Windows le sont.

**Scan paresseux, pas de cache.** `get()` essaie d'abord les noms déclarés, et ne scanne l'environnement qu'ensuite ; le scan est refait à chaque lookup plutôt que mis en index, pour préserver la garantie documentée qu'un `dotenv` chargé après le démarrage est pris en compte.
Le coût (un `Object.keys(process.env)` filtré) est sans commune mesure avec un appel réseau.

**Hygiène des tests : ce fut le vrai point dur.** Cette machine exporte `MINIMAX_API_KEY` et `OPENROUTER_API_KEY`, ce qui a fait échouer des assertions jusque-là.
Un simple snapshot/restore de `process.env` ne suffit pas, car le backup capture déjà la pollution.
La solution retenue est un nettoyage explicite des 2 x N noms dérivés d'`API_KEY_SECRETS` (`clearVendorApiKeyEnv()` / `clearApiKeyEnv()`) en `beforeEach`, doublé d'un restore global en `afterEach` par sécurité.
Le nettoyage porte sur une liste fermée, alors que le scan est ouvert : c'est le bon partage, car la liste des noms que la chaîne peut lire est dérivée de la même source de vérité que le scan.

**Vérification de bout en bout.** Gateway standalone lancé avec `ZAI_API_KEY=sk-e2e-bare-zai` seul : les logs de démarrage donnent `API key for zai: Env (ZAI_API_KEY)`, les autres vendors préfixés restent sur leur nom `AIFLOWBRIDGE_*`, et `googleaistudio` / `moonshot` sortent `not configured`.

Gate : `npm run validate` (compile + 1245 tests + `typecheck:tests`) et `npm run compile:standalone` verts.
**Bump mineur 2.20.0 demandé par l'utilisateur** : `package.json`, `package-lock.json`, `resources/pricing.json` (`aiflowbridgeVersion` seul, le catalogue est inchangé donc `pricing:refresh` n'a pas été relancé), CHANGELOG et les 5 docs qui citent la version (README, `docs/providers.md`, `docs/cost.md`, `docs/architecture.md`).
**Non commité** : règle « aucun commit automatique ».
Docs mises à jour : `README.md`, `docs/standalone.md`, `docs/providers.md` (3 passages, dont une priorité erronée corrigée), `docs/development.md`, `docs/agent-instructions/{architecture,gateway,tasks}.md`.

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

### 2026-09-05 - Kilo (Bug : Muse spark 1.3 (id OpenRouter) 401 "No cookie auth credentials found")

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

### 2026-09-05 - Kilo (Coverage thought_signature en debug : le 100% MISSING reste un 200)

L'utilisateur rapporte un dernier warning `36/36 MISSING` qui aboutit quand même en 200 : l'upstream accepte en pratique les bursts first-turn sans signature préalable.
Le warn systématique est donc du bruit même à 100%.
Fix : `logThoughtSignatureCoverage()` passe entièrement en `debug` (plus aucun warn). La ligne reste disponible pour diagnostiquer un vrai 400 sans alarmer sur les turns sains.
Valeurs jamais loggées, inchangé.
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).

### 2026-09-05 - Kilo (Coverage partielle tolérée : warn seulement si 100% MISSING)

L'utilisateur confirme que ça fonctionne malgré les warnings : le log montre des couvertures partielles (`1/3`, `2/4`, `2/7` MISSING) qui aboutissent toutes en 200.
L'upstream tolère donc les turns rejoués où seules certaines calls portent une signature (les first-time calls n'en ont jamais eu).
Le warn à chaque requête partielle est du bruit qui masque les vrais problèmes.
Fix : `logThoughtSignatureCoverage()` ne warn qu'en cas de 100% MISSING (rejet 400 quasi-certain) ; couverture partielle et complète passent en debug.
Valeurs jamais loggées, inchangé.
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).

### 2026-09-05 - Kilo (Fix racine du 400 thought_signature : shape sibling + snoop streaming + log coverage)

Le 400 persistait malgré le cache opt-in pour deux raisons cumulées, confirmées par le log coverage (`3/3 functionCall parts MISSING signature [read:MISSING...]`) :

1. Le cache n'était alimenté que sur le chemin non-streaming alors que Kilo streame toujours (`streaming=true` sur toutes les requêtes du debug.log).
2. Erreur de shape : la gateway envoyait `thoughtSignature` comme ENFANT de `functionCall` (`{ functionCall: { name, args, thoughtSignature } }`), alors que l'API Gemini l'attend en SIBLING sur la part (`{ functionCall: { name, args }, thoughtSignature: "..." }`). L'API ignorait silencieusement le champ mal placé, puis rejetait avec 400. Le protocole natif Kilo (`gemini.ts`) confirme le shape sibling (`part.thoughtSignature`), tout comme la doc `thought-signatures` (signature sibling de functionCall/functionResponse).
Fix : `GeminiNativeRequest` + `GeminiNativeResponse` + les 3 parseurs streaming natifs passés au shape sibling ; `toGeminiNativeRequest` / `fromGeminiNativeResponse` / transforms émettent et lisent le sibling ; tests migrés (fixtures corrigées : ordre crochets `}]}},` + shape sibling) ; snoop passif des chunks streaming + `logThoughtSignatureCoverage()` inchangés (déjà sibling-aware).
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).
Pour vérifier : recharger, relancer la tâche Kilo, chercher `thought_signature coverage` : `sig` partout = la signature part au bon shape et le 400 doit disparaître.

### 2026-09-05 - Kilo (Fix racine du 400 thought_signature : snoop streaming + log coverage)

Le 400 persistait malgré le cache opt-in parce que (1) le cache n'était alimenté que sur le chemin non-streaming alors que Kilo streame toujours (`stream: true`), et (2) aucun log ne montrait si la signature partait vraiment vers l'amont.
Analyse du debug.log utilisateur (assaini) : activation 2.18.2 OK, registry OK, OAuth connecté, gateway redémarrée sur 8787. Séquence : 400 initial, puis 200, puis 400 à nouveau.
Le 200 intermédiaire prouve que le pass-through fonctionne quand la signature est présente ; le 400 suivant prouve que le cache ne l'a pas ré-injectée (vide car jamais alimenté en streaming).
Fix : (a) snoop passif des chunks OpenAI sur le chemin streaming `pipeThrough` quand le flag est actif (parse `data:` frames, stocke `id` + `extra_signature`, jamais loggé, jamais bloquant, zéro overhead quand flag off) ; (b) `logThoughtSignatureCoverage()` sur les deux builders (BYOK natif + AGY) : log `warn` avec `nom:sig|MISSING` par functionCall quand au moins un manque, `debug` quand complet.
Valeurs jamais loggées.
Gates : compile OK, 71 fichiers / 1177 tests verts, typecheck tests OK, standalone OK.
SANS committer (validation utilisateur requise).
Pour vérifier : recharger la fenêtre, relancer la tâche Kilo, ouvrir "AIFlowBridge: Show logs", chercher `thought_signature coverage` : `MISSING` = le client n'a rien envoyé et le cache était vide ; `sig` partout = la signature part et le 400 doit disparaître.

### 2026-09-05 - Kilo (Analyse poussée alternatives au cache opt-in + implémentation)

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

### 2026-09-05 - Kilo (Patch 2.18.2 : dashboard authMode BYOK / OAuth / plan / token)

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

### 2026-09-05 - Kilo (Patch 2.18.1 : docs gateway + README + thought_signature)

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

### 2026-09-05 - Kilo (Implémentation plan Gemini BUG-13 à BUG-17 + release 2.18.0)

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
Vérif manuelle BYOK (chat + 2 tools + image + TTFT + toggle aller/retour avec override stale) : non exécutée ici, clé réelle requise - à faire par l'utilisateur avant merge.
Aucun secret dans les fichiers versionnés ni dans les logs (extraits assainis uniquement).

### 2026-09-05 - Kilo (Bypass Secret Scanning pour les credentials publics AGY)

Pour débloquer le push du 2.17.0 bloqué par GitHub Secret Scanning sur
le `client_secret` OAuth d'Antigravity, l'utilisateur a autorisé
explicitement à garder ce secret dans le versionné. Les credentials
OAuth officiels de l'AGY CLI (client_id + client_secret) sont hardcodés
dans `src/aiflowbridge/antigravity/constants.ts` avec whitelist
correspondant dans `.github/secret_scanning.yml` (`paths-ignore` +
`custom_patterns`). Documentation de l'exception dans « Règles de
contenu » et dans la table « Décisions d'architecture ». Tous les autres
secrets restent exclus du versionné.

### 2026-09-05 - Kilo (Handoff vers nouvelle session : audit v2 + version 2.17.0)

Contexte : utilisateur `laurent`, code en `2.17.0`, branche feature Gemini/AGY.
Build actuelle : 1093/1093 → 1106/1106 → 1124/1124 tests verts au fil des fixes
documentés ci-dessous. `npm run compile` frais, `out/` à jour. L'utilisateur a
confirmé que Gemini 3.7 + 3.8 répondent correctement via la voie BYOK native
après le fix pipeline streaming (BUG-17 partiellement corrigé). Bascule entre
voies : `aiflowbridge.providers.googleaistudio.baseUrl` (`cloudcode-pa` =
OAuth AGY actif, `generativelanguage.googleapis.com/v1beta` = BYOK native).
Clé API `AIzaSy...` stockée dans `SecretStorage`. Le détail des bugs ouverts
(BUG-06, 13-17) est dans l'audit v2.

### 2026-09-05 - Kilo (Release 2.17.0 : voie BYOK Gemini + correctifs audit v1)

Nouvelle voie BYOK vers Gemini (`x-goog-api-key`, surface native), audit externe
intégral des routes OAuth + BYOK, switcher de route sécurisé, OAuth UX avec
ouverture navigateur, support vision documenté (mais BUG-14 images stipees
en BYOK - fix prévu 2.18.0). Détails des fixes dans l'audit v2 section 6.1.

### 2026-09-04 - Kilo (BYOK Gemini initial + facturation plan vs token)

Ajout de la voie BYOK `googleaistudio` avec prix publics, mode `billing` par
profil, dashboard avec badge `plan` + tooltip + notice, exports CSV/JSON avec
colonne `billedTo`. Modèles Gemini 3.8/3.7/3.6 Flash remplacent les ids 2.5.

### 2026-09-03 - Kilo (Implémentation initiale Antigravity / Google AI Studio)

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

### 2026-10-07 - Kilo (bascule de route Google AI Studio : bascule aveugle, donc inutilisable)

**Signalement utilisateur** : la commande `AIFlowBridge: Switch Google AI Studio route` est utilisée, mais « dans les 2 cas, je retombe sur la route BYOK », clé supprimée, requêtes en erreur.
L'utilisateur veut pouvoir rebasculer et **choisir** OAuth.

**Cause exacte, lisible en dix lignes.** La couche pure était correcte : `decideGoogleAIStudioRouteSwitch(currentBaseUrl, targetRoute?)` accepte déjà un `targetRoute` explicite, et le test « returns null when the effective route already matches the target » couvrait ce cas.
Le défaut était dans l'appelant (`src/aiflowbridge/index.ts`), qui appelait `decideRouteFromEffective(effective)` **sans cible**.
La cible était donc déduite comme l'inverse de la route courante à chaque invocation : BYOK -> OAuth -> BYOK.
Relancer la commande « pour vérifier » suffisait à retomber sur BYOK, ce qui se lit exactement comme « la bascule ne marche pas ».
Aggravant : la gateway construit ses profils de provider une fois par activation, donc après une bascule réussie les requêtes continuent de partir sur l'ancienne surface jusqu'au rechargement - l'utilisateur voyait le même symptôme et rebasculait.
Boucle fermée par le symptôme, pas par le code.

**Deux faiblesses de conception derrière, à retenir.**

- **Une bascule dont l'état n'est pas nommé est une source de flip.** Le nom de la commande dit « Switch », l'effet dit « l'inverse de ce qui existe ». Une commande dont l'effet est ambigu doit exposer l'état et la cible, sinon chaque vérification détruit le résultat.
- **Un changement qui n'a pas d'effet visible immédiat doit proposer l'étape suivante.** « Reload Window to pick up the new route » était dit dans un toast que personne ne voit avant que le problème ne se manifeste. Le correctif propose maintenant le rechargement au lieu de l'annoncer.

**Correctif.** Nouveau capacité optionnelle `IGatewayContext.pickRoute()` (+ `RouteChoice`), implémentée côté VS Code avec `vscode.window.showQuickPick`, absente en standalone où la commande est déjà refusée.
La commande présente les deux routes avec leur conséquence de facturation (OAuth = quota du compte, BYOK = facturé sur la clé), applique la route choisie, donc un second passage est un no-op, ne fait rien et signale la route courante si la boîte est fermée, et propose le rechargement de fenêtre via `confirm()`.
Passer sur BYOK avertit que les tokens OAuth sont révoqués, donc le retour exigera une nouvelle authentification. `hostnameRoute()` devient exportée pour que l'UI puisse étiqueter l'état courant.
**Non-régression rendue explicite par un test** : les deux routes demandées deux fois de suite restent stables, alors que la bascule aveugle demonstrativement rebascule - le test qui verrouille le défaut est celui qui échouerait si on revenait à l'inférence.

3 tests ajoutés dans `tests/runtime-switch-route.test.ts` (18 dans le fichier). `npm run validate` : 1404 tests verts (79 fichiers), compile et `typecheck:tests` verts, `compile:standalone` vert.
Docs : section « Switching between routes » de `docs/providers.md` réécrite (choix explicite, stabilité, rechargement, révocation), README (paragraphe et table des commandes), entrée CHANGELOG dans la section Fixed de la 2.23.0.
**Limite assumée** : le dialogue (QuickPick, modale de rechargement) n'a pas été exercé depuis VS Code dans cet environnement ; seul le comportement de décision est couvert par tests.
**Non commité** : règle « aucun commit automatique ».

### 2026-10-09 - Kilo (Clôture audit AUD02 : REDIR-1, DOC-DATA1, relecture QUOTA-1)

**Contexte** : Clôture formelle de l'audit AUD02 en version 2.23.0 suite aux travaux de la journée.

**1. REDIR-1 (majeur, résolu)** : L'amont acceptait le rejeu sur 301, 302, 303 alors que la documentation, les commentaires et le CHANGELOG 2.23.0 promettent 307 et 308 uniquement.
La RFC 9110 impose GET pour 303 et réécrit historiquement le POST pour 301/302, ce qui provoquait un rejeu de prompt en POST non préservationnel.
Correction : la fonction pure `resolveProviderRedirect()` reçoit désormais le statut HTTP (`status = 307` par défaut).
Tout statut distinct de 307 et 308 est explicitement refusé avec la raison `HTTP status ${status} does not preserve the POST method and body (only 307 and 308 are supported)`.
Dans `src/aiflowbridge/gateway/server.ts`, `callUpstream()` transmet `attempt.status` à `resolveProviderRedirect()` ; un refus lève une exception capturée et transformée en HTTP 502 Bad Gateway sans aucun rejeu du corps POST.
2 tests unitaires ajoutés dans `tests/aiflowbridge-providers.test.ts` (rejet de 301/302/303 et acceptation de 307/308) et 2 tests d'intégration dans `tests/gateway.test.ts` (vérification qu'un 301/302/303 amont ne rejoue jamais le corps POST et retourne 502, et qu'un 307 amont rejoue fidèlement le corps POST sur le même hôte en 200).

**2. DOC-DATA1 (mineur, résolu)** : Paragraphe ajouté sous `## Provider routing` dans `docs/agent-instructions/gateway.md` documentant le rôle de `resources/pricing.json` comme instantané OpenRouter régénéré à chaque release servant de repli tarifaire pour les modèles déclarés par l'utilisateur (`userModels` ou surcharge de registre), distinct des 38 modèles natifs tarifés par `resources/models.json` et les valeurs par défaut de famille.

**3. QUOTA-1 (relu et validé)** : Relecture dédiée approfondie du module de production `src/aiflowbridge/gateway/quota-diagnostics.ts` (ajouté lors de l'incident Gemini de l'après-midi).
Module pur sans état externe, normalisation robuste des erreurs JSON et des trames SSE, extraction des blocs `QuotaFailure` et `RetryInfo`, classification exacte (`rate-limited`, `quota-exhausted`, `zero-allocation`, `billing-exhausted`), absence de supposition hasardeuse sur 429 illisible et corps amont préservé intact pour le client.
Validé avec ses 20 tests (15 unitaires + 5 intégration).

**Validation globale** : `npm run validate` vert avec 1432 tests sur 80 fichiers, `compile:standalone` vert, packaging VSIX (`dist/aiflowbridge-2.23.0.vsix`) vérifié propre sans aucun fichier de dev ni fichier sensible (`scripts/`, `.githooks/`, `BRAIN.md`, `ACTION_PLAN.md`, `tests/`, `_Private/`).
**Configuration locale assainie** : à la demande de l'utilisateur, l'entrée temporaire `vendors.googleaistudio` injectée le 2026-10-09 dans `~/.config/Code/User/globalStorage/laurentongaro.aiflowbridge/models.json` a été supprimée par restauration de la sauvegarde `models.json.bak-before-oauth-route` (permissions 0600 préservées, JSON validé).
**Non commité** : respect strict de la règle projet AP-020 (aucun commit automatique sans demande explicite de l'utilisateur).

### 2026-10-09 - Kilo (Bump patch 2.23.1 et mise à jour CHANGELOG)

**Contexte** : À la demande explicite de l'utilisateur (« bumper en version patch et de mettre à jour le changelog pour le dernier commit, fait le stp »), passage en version patch 2.23.1 suite au commit `f480bb6` (enforce 307/308 pour les redirections amont et documentation du repli pricing.json).
**Version portée à 2.23.1** dans `package.json`, `package-lock.json`, `resources/pricing.json` (`aiflowbridgeVersion`), `README.md` (tampon snapshot et référence catalogue), `docs/architecture.md`, `docs/cost.md` et `docs/providers.md`.
**CHANGELOG.md** : ajout de la section `## 2.23.1` (Security : restriction stricte des redirections amont aux statuts HTTP 307 et 308 préservant la méthode POST et le corps de requête, rejet explicite en 502 de 301/302/303).
**Validation** : `npm run validate` vert (1432 tests sur 80 fichiers, horloge déterministe injectée dans `tests/quota-diagnostics.test.ts` pour éliminer un aléa de timing de 1ms sur `resetAt`), `compile:standalone` vert, packaging VSIX (`dist/aiflowbridge-2.23.1.vsix`).
**Commit** : commit git exécuté sur demande explicite de l'utilisateur (action AP-041).

