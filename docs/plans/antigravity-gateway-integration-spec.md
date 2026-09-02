# Spec d'intégration : kind `antigravity` dans la gateway AIFlowBridge

- Livrable : AP-007 (cartographie de `server.ts` + spec d'intégration)
- Auteur : Perplexity (lecture par fragments via recherche GitHub)
- Date : 2026-09-02
- Référence : `docs/plans/antigravity-provider-kilo-cli.md` (plan initial,
  désormais révisé : la gateway existe, ce document la remplace comme spec
  d'implémentation)

---

## 1. Cartographie de la gateway (constaté dans le code)

### 1.1 Routage HTTP

`GatewayService.handleRequest()` (`src/aiflowbridge/gateway/server.ts`)
construit `new URL(request.url ?? '/', config.gateway.baseUrl)` et route par
`pathname` + méthode. Routes identifiées :

| Route | Méthode | Rôle | Auth |
|---|---|---|---|
| `/version` | GET | Sonde + `shutdownToken` (loopback) | non |
| `/health` | GET | Snapshot d'état | non (loopback) |
| `/metrics`, `/v1/metrics` | GET | Télémétrie cumulative | non (loopback) |
| `/v1/models` | GET | Catalogue OpenAI (auto-synthétisé du registry) | non (loopback) |
| `/v1/discovery` | GET | Snippets de config clients (Continue, Kilo, curl) | non (loopback) |
| `/v1/events` | GET | SSE télémétrie longue durée (heartbeat 15 s) | non (loopback) |
| `/v1/replay/{requestId}` | GET | Re-lecture d'une réponse depuis le TelemetryStore | non (loopback) |
| `/v1/context` | GET | Contexte workspace détecté (JSON) | non (loopback) |
| `/v1/chat/completions` | POST | Relais OpenAI-compatible (stream + non-stream) | bearer local |
| `/shutdown` | POST | Arrêt (token par instance) | token |

La gateway bind `127.0.0.1` uniquement ; `GET /v1/models` expose les headers
`X-AIFlowBridge-Pricing-GeneratedAt` / `X-AIFlowBridge-Pricing-Version`.

### 1.2 Flux d'une completion

`forwardChatCompletion` est un orchestrateur (~570 lignes) déléguant à trois
helpers privés (refactor documenté au CHANGELOG) :

1. **`readAndValidateBody()`** — lecture du corps, parse JSON, 400 sinon.
2. **`resolveChatProvider()`** — capture du prompt-summary, nom du modèle,
   puis `selectProviderWithLanguage(providers, model, defaultModel, langHint,
   routingTable)` (`src/aiflowbridge/context/language-routing.ts`) ;
   503 si aucun provider, 404 + liste des ids si le modèle ne matche rien.
3. **`buildUpstreamRequest()`** — retourne
   `{ upstreamUrl, resolvedKey, upstreamHeaders, upstreamBody }` :
   - `upstreamUrl = resolveUpstreamUrl(provider, 'chat/completions')` ;
   - résolution de clé : env `AIFLOWBRIDGE_<VENDOR>_API_KEY` →
     `<globalStorageDir>/secrets.json` (chmod 600) → commande VS Code ;
     warning unique si absente (sauf kind `ollama`) ;
   - headers : `Authorization: Bearer`, `X-AIFlowBridge-Request-Id`,
     attribution OpenRouter le cas échéant ;
   - **traduction de payload** : champs spécifiques AIFB → forme upstream
     (précédent : `reasoning: true/false` de Kilo → shape MiniMax) ;
   - injection du contexte workspace en préfixe system ;
   - override du nom de modèle par celui du provider ;
   - 502 structuré si le bearer est rejeté par la forme attendue.

L'orchestrateur garde : compteur in-flight (429 + `Retry-After` au-delà de
`gateway.maxConcurrentRequests`), AbortController, slot par provider,
watchdogs, et la bifurcation streaming / non-streaming / backoff /
catch / finally.

### 1.3 Streaming

- Requête upstream : `Accept: application/json, text/event-stream`.
- Réponse : **pipe verbatim** — `Readable.fromWeb(upstream.body).pipe(response)`.
  Aucune transformation de trames n'existe aujourd'hui (`TransformStream` :
  0 occurrence dans le dépôt).
- Erreurs : `sanitizeUpstreamErrorMessage()` retire query string et toute
  référence `api_key` / `Authorization` / `Bearer` des corps 502 ;
  `redactProviderForLog()` masque `apiKey` (`apiKeyPresent: boolean`).

### 1.4 Modèle de providers

- `ProviderProfile { id, label, kind, model?, baseUrl, ... }` avec
  `ProviderKind = 'openai-compat' | 'ollama'` (`src/aiflowbridge/types.ts`).
- Registry 3 tiers : `resources/models.json` (bundled) <
  `<globalStorage>/models.json` < `<workspace>/.vscode/aiflowbridge.models.json`,
  + `aiflowbridge.userModels`. Schéma : `resources/models.schema.json`
  (enum `family` par vendor).
- Checklist d'ajout de vendor (`docs/agent-instructions/tasks.md`) :
  entrée vendor dans `resources/models.json` (`baseUrl`, `apiKeySecret`,
  `externalUrls`), modèles bundled, enum du schéma, `VENDOR_ALIASES` dans
  `src/aiflowbridge/api-key-resolver.ts`, `VENDOR_CHOICES` / `VENDOR_LABELS`
  dans `src/runtime/addCustomModel.ts`, settings `aiflowbridge.providers.<vendor>.*`
  dans `package.json`.
- Sélection : table de routage `language → providerId` puis fallback
  `selectProvider(model, defaultModel)` ; le `404` liste les ids disponibles.
- Précédent de code spécifique vendor côté gateway : `token-counter.ts`
  (appel MiniMax `/v1/responses/input_tokens`).

---

## 2. Design du kind `antigravity`

### 2.1 Principe

```
Kilo CLI --(OpenAI chat)--> GatewayService
                             │ kind 'antigravity'
                             ├─ buildUpstreamRequest :
                             │    token = antigravityAuth.getAccessToken()
                             │    body  = toAntigravityEnvelope(openaiBody)
                             │    url   = CLOUDCODE_STREAM_URL
                             ├─ fetch upstream (SSE Antigravity)
                             ├─ TransformStream Antigravity→OpenAI  <-- NOUVEAU
                             └─ pipe(response)
```

Le provider Antigravity reste un `ProviderProfile` ; trois comportements
divergent du kind `openai-compat` et doivent être branchés sur `kind ===
'antigravity'` :

| Étape | openai-compat | antigravity |
|---|---|---|
| Auth | clé statique (env / secrets.json) | access token OAuth court, refresh automatique |
| Corps requête | pass-through + traductions mineures | enveloppe `{ project, model, request, requestType, userAgent, requestId }` |
| Réponse stream | pipe verbatim | **TransformStream de conversion SSE** |
| Réponse non-stream | pass-through | accumulation du flux → JSON OpenAI |

### 2.2 Nouveaux modules

```
src/aiflowbridge/antigravity/
├── constants.ts        # endpoints, scopes, UA, headers (centralisés)
├── types.ts            # AntigravityTokens, LoadCodeAssistResult, ModelInfo, SseEvent
├── pkce.ts             # verifier/challenge S256 (node:crypto)
├── auth.ts             # flux OAuth (callback local + mode manuel), refresh
├── token-store.ts      # persistance dans secrets.json (convention chmod 600)
├── project.ts          # loadCodeAssist → projectId / plan / quotaInfo
├── catalog.ts          # fetchAvailableModels → entrées registry
├── envelope.ts         # OpenAI body → enveloppe Antigravity (pur, testable)
├── sse-transform.ts    # TransformStream SSE Antigravity → OpenAI (pur)
└── index.ts            # exports publics du module
```

Règle : **aucun appel réseau** dans `pkce.ts`, `envelope.ts`,
`sse-transform.ts` (purs, couverts par tests unitaires vitest).

### 2.3 Authentification

- Storage : `secrets.json` existant, clé `antigravity` →
  `{ refreshToken, accessToken, expiresAt, projectId, email, scopes }`.
  Réutilise la convention `chmod 600` déjà documentée (SECURITY.md).
- `AntigravityTokenManager.getAccessToken()` : retourne l'access token en
  cache si valide (marge 60 s), sinon refresh via
  `https://oauth2.googleapis.com/token` ; en cas d'échec 401 upstream, un
  retry unique après refresh forcé.
- Point d'insertion dans `buildUpstreamRequest()` : pour
  `kind === 'antigravity'`, `resolvedKey = await tokenManager.getAccessToken()`
  au lieu de la résolution env/secrets statique. Le warning « no API key »
  existant doit être inhibé pour ce kind (comme `ollama`).
- Commande CLI (standalone) : `aiflowbridge-server auth antigravity`
  (login) / `auth antigravity --status` / `auth antigravity --logout`.
  Côté extension : commande `AIFlowBridge: Connect Antigravity (Google)`.
- Flux : Authorization Code + PKCE, callback `http://127.0.0.1:<port libre>`,
  mode manuel (coller l'URL) pour WSL/SSH.

### 2.4 Corps de requête (`envelope.ts`)

Entrée : body OpenAI validé (après `readAndValidateBody` + injection
workspace). Sortie :

```json
{
  "project": "<projectId>",
  "model": "<modelId>",
  "request": {
    "contents": [ /* user/model/tool mappés */ ],
    "systemInstruction": { "parts": [ { "text": "<messages system>" } ] },
    "generationConfig": { "temperature": 0.7, "maxOutputTokens": 8192 },
    "tools": [ /* schémas nettoyés */ ]
  },
  "requestType": "agent",
  "userAgent": "antigravity",
  "requestId": "agent-<ts>-<rand>"
}
```

Mappings : `system` → `systemInstruction` ; `user`/`assistant` →
`contents` (`model` pour assistant) ; `tool` → `functionResponse` ;
`tool_calls` → `functionCall` ; `temperature/top_p/max_tokens/stop` →
`generationConfig`. Nettoyage des JSON Schema d'outils : retirer `$schema`,
`$id`, `$ref`, `$defs`, `additionalProperties`, bornes (`minLength`,
`minimum`, `pattern`…) non supportées ; `type: "object"` racine obligatoire.

### 2.5 Conversion SSE (`sse-transform.ts`)

`TransformStream<Uint8Array, Uint8Array>` inséré entre
`Readable.fromWeb(upstream.body)` et `.pipe(response)` pour le kind
`antigravity` :

1. découpage des trames `data: {...}\n\n` (buffer inter-chunks) ;
2. extraction de `response.candidates[0].content.parts[]` ;
3. émission de chunks `chat.completion.chunk` :
   `delta.content` (texte), `delta.tool_calls` (functionCall, index stables) ;
4. `usageMetadata` → chunk `usage` final (Kilo l'exploite si présent) ;
5. terminaison par `data: [DONE]\n\n` ;
6. erreurs upstream → trame d'erreur OpenAI normalisée (jamais de fuite
   de token : réutiliser `sanitizeUpstreamErrorMessage`).

Non-streaming : accumulateur qui consomme le même transformateur et
assemble un `chat.completion` complet (cohérent avec `/v1/replay/{id}`).

### 2.6 Catalogue de modèles

- MVP : entrées statiques dans `resources/models.json` (vendor
  `antigravity`, `family` ajouté à l'enum du schéma, `baseUrl` = endpoint
  Cloud Code Assist, `apiKeySecret = 'aiflowbridge.providers.antigravity'`),
  modèles bundled à définir après observation réelle du compte (AP-012).
- V2 : rafraîchissement dynamique via `fetchAvailableModels` au login et
  périodiquement, écrit dans le registry globalStorage (mécanisme 3 tiers
  existant).
- Sélection : ids de modèles exposés tels quels dans `GET /v1/models` ;
  `selectProvider` les matche comme tout autre provider. Prévoir
  `VENDOR_ALIASES['antigravity'] = ['antigravity', 'gemini']`.

### 2.7 Checklist des fichiers touchés (hors nouveau module)

| Fichier | Modification |
|---|---|
| `src/aiflowbridge/types.ts` | `ProviderKind` += `'antigravity'` |
| `src/aiflowbridge/gateway/server.ts` | branches kind : auth async, enveloppe, TransformStream |
| `src/aiflowbridge/api-key-resolver.ts` | alias vendor + bypass clé statique |
| `resources/models.json` | vendor + modèles bundled |
| `resources/models.schema.json` | enum `family` |
| `src/runtime/addCustomModel.ts` | `VENDOR_CHOICES` / `VENDOR_LABELS` (ou exclusion explicite) |
| `package.json` | settings `aiflowbridge.providers.antigravity.*`, commande de connexion |
| `src/standalone/main.ts` | sous-commande `auth antigravity` |
| `docs/gateway.md`, `docs/providers.md` | documentation du nouveau provider |

## 3. Risques spécifiques et parades

| Risque | Parade |
|---|---|
| Endpoints internes Google changeants | `constants.ts` unique + tests contractuels sur fixtures |
| Flux 200 vide (modèle restreint) | erreur explicite « modèle non autorisé pour ce compte » |
| Cassure du pipe verbatim pour les autres kinds | branche strictement conditionnée à `kind === 'antigravity'` |
| Fuite de token dans logs/502 | réutiliser `redactProviderForLog` / `sanitizeUpstreamErrorMessage` ; tests dédiés |
| Watchdogs/orchestrateur incompatibles avec le transform | le TransformStream vit côté réponse, l'orchestrateur reste inchangé |

## 4. Questions ouvertes (pour Kilo / Laurent)

1. Kilo → vérifier en local (`npm test`) que les 1038 tests passent avant
   branche (AP-009), et reporter la version Node utilisée.
2. Kilo → AP-010 : confirmer port/chemin réels de la gateway en local.
3. Laurent → valider le nom du kind (`'antigravity'`) et de la commande
   (`aiflowbridge-server auth antigravity`).
4. Laurent → valider que les modèles Antigravity apparaissent aussi dans le
   picker Copilot Chat (option `AntigravityChatProvider extends
   BaseChatProvider`), ou gateway-only en MVP.
