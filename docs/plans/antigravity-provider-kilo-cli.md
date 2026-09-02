# Plan : Fournisseur Antigravity dans AIFlowBridge

- Projet : AIFlowBridge
- Dépôt : `LaurentOngaro/AIFlowBridge`
- Date : 2026-09-02
- Statut : proposition / draft d'implémentation
- Cible initiale : Kilo CLI via passerelle locale OpenAI-compatible
- Cible ultérieure : extension VS Code AIFlowBridge et autres clients OpenAI-compatible
- Branche de travail suggérée : `feat/antigravity-provider`

## Objectif

Permettre d'utiliser dans Kilo CLI :

1. Gemini via le compte Google connecté à Antigravity / Cloud Code Assist, afin de bénéficier des droits associés au compte Google AI Pro ;
2. MiniMax-M3 via le plan MiniMax déjà supporté directement par Kilo Code.

L'utilisateur sélectionne alors, dans le même agent Kilo CLI :

- `openai-compatible/...` ou `aiflowbridge/...` pour Gemini exposé par AIFlowBridge ;
- le provider MiniMax officiel de Kilo pour `MiniMax-M3`.

L'objectif n'est pas de créer une clé Gemini API payante ni de réutiliser un jeton Google à d'autres fins que l'accès Antigravity/Cloud Code Assist autorisé au compte connecté.

## Architecture recommandée

AIFlowBridge s'exécute comme service local et présente Antigravity à Kilo CLI comme un endpoint OpenAI-compatible :

```text
Kilo CLI
  │
  │ Provider OpenAI-compatible
  │ baseURL : http://127.0.0.1:<port>/v1
  │ model   : antigravity/<model-id>
  ▼
AIFlowBridge standalone
  │
  ├── OAuth Google + PKCE
  ├── Stockage sécurisé et refresh des jetons
  ├── loadCodeAssist : projet / plan / quotas
  ├── fetchAvailableModels : catalogue et quotas par modèle
  ├── conversion OpenAI Chat Completions -> Gemini request envelope
  └── conversion SSE Antigravity -> SSE OpenAI
  ▼
Google Cloud Code Assist / Antigravity
  │
  └── Gemini ou autres modèles autorisés au compte connecté
```

MiniMax reste configuré comme provider officiel Kilo et ne passe pas par ce bridge. Cela limite le couplage et permet de comparer les deux modèles dans Kilo sans ajouter un point de défaillance à MiniMax.

## Pourquoi une passerelle plutôt qu'un plugin Kilo

Kilo Code accepte les providers personnalisés OpenAI Chat Completions. Une passerelle locale permet :

- d'utiliser le même backend dans Kilo CLI et dans l'extension VS Code ;
- de réutiliser la passerelle avec d'autres clients compatibles OpenAI ;
- d'éviter de dépendre des interfaces internes ou plugins Kilo ;
- d'isoler l'adaptation à l'endpoint Antigravity dans AIFlowBridge ;
- de conserver MiniMax comme chemin officiel et stable ;
- de réduire le risque de fuite des jetons OAuth vers une configuration de projet.

Références utiles :

- Kilo Code, OpenAI-compatible providers : https://kilo.ai/docs/ai-providers/openai-compatible
- Kilo Code, modèles personnalisés : https://kilo.ai/docs/code-with-ai/agents/custom-models
- PicoClaw, provider Antigravity / Cloud Code Assist : https://docs.picoclaw.io/docs/providers/antigravity/

## Éléments existants à réutiliser

Structure observée dans le dépôt :

- `src/standalone/main.ts` : point d'entrée standalone ;
- `src/standalone/vscode-shim.ts` : shim permettant au code extension de fonctionner hors VS Code ;
- `src/provider/base.ts` et `src/provider/index.ts` : abstraction/enregistrement des providers ;
- `src/provider/minimax.ts` : exemple d'intégration d'un provider asiatique à quota/token plan ;
- `src/provider/convert.ts` : conversion de formats ;
- `src/provider/stream.ts` : traitement des flux ;
- `src/provider/request.ts` et `src/provider/errors.ts` : requêtes et erreurs ;
- `src/runtime/installStandalone.ts` : installation/distribution du mode standalone ;
- `src/auth.ts` et `src/config.ts` : emplacements probables pour l'authentification et la configuration ;
- `src/client/core.ts` et `src/client/error.ts` : client HTTP et gestion d'erreurs ;
- `src/types.ts` : types partagés.

À confirmer lors de l'implémentation :

- si le mode standalone expose déjà un serveur HTTP OpenAI-compatible ;
- quel objet représente actuellement un modèle, une session et une réponse streamée ;
- où se trouve le stockage des secrets dans l'extension et dans le mode standalone ;
- si la télémétrie et les métriques peuvent distinguer plusieurs providers upstream.

## Nouveaux modules proposés

```text
src/provider/antigravity/
├── index.ts                    # enregistrement du provider et exports publics
├── constants.ts                # endpoints, UA, scopes, options non secrètes
├── types.ts                    # types OAuth, projet, modèles, SSE Antigravity
├── pkce.ts                     # génération verifier/challenge S256
├── oauth.ts                    # flux Authorization Code + PKCE + refresh
├── callback-server.ts          # callback local et mode manuel
├── auth-store.ts               # chiffrement / stockage / rechargement des jetons
├── project.ts                  # loadCodeAssist et résolution du projectId
├── models.ts                   # fetchAvailableModels et mapping OpenAI /models
├── client.ts                   # appels Antigravity, headers, refresh-on-401
├── openai-convert.ts           # Chat Completions -> enveloppe Gemini request
├── sse-convert.ts              # SSE Antigravity -> SSE OpenAI
├── tool-schema.ts              # nettoyage des JSON schemas pour outils
├── usage.ts                    # plan, crédits, quotas et snapshots de métriques
├── errors.ts                   # normalisation 401/403/429/5xx/quota/empty-stream
└── README.md                   # installation, sécurité et limites connues
```

Points d'intégration existants :

- `src/standalone/main.ts` : commandes `auth`, `models`, `serve`, `usage` ;
- `src/provider/index.ts` : enregistrement du provider `antigravity` ;
- `src/standalone/config-loader.ts` : configuration `antigravity.*` ;
- `src/standalone/storage-dir.ts` : choix du dossier sécurisé pour les jetons ;
- `src/runtime/provider.ts` : exposition dans l'extension si la même couche est réutilisée.

## Protocole Antigravity à implémenter

Les détails publics observés sur les implémentations communautaires indiquent :

### Endpoints

| Endpoint | Méthode | Usage |
|---|---|---|
| `https://accounts.google.com/o/oauth2/v2/auth` | GET | Autorisation OAuth |
| `https://oauth2.googleapis.com/token` | POST | Échange de code et refresh |
| `https://www.googleapis.com/oauth2/v1/userinfo?alt=json` | GET | Email du compte |
| `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` | POST | Projet, plan, crédits |
| `https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` | POST | Modèles disponibles et quotas |
| `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` | POST | Réponse générative streamée |

Ces endpoints sont internes et peuvent changer. Ils doivent être centralisés dans `constants.ts` et couverts par des erreurs explicites.

### Scopes observés

```text
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/cclog
https://www.googleapis.com/auth/experimentsandconfigs
```

### En-têtes recommandés

```text
Authorization: Bearer <access_token>
Content-Type: application/json
User-Agent: antigravity
X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
```

Pour `loadCodeAssist`, ajouter un `Client-Metadata` JSON comportant notamment :

```json
{
  "ideType": "ANTIGRAVITY",
  "platform": "PLATFORM_UNSPECIFIED",
  "pluginType": "GEMINI"
}
```

### Enveloppe de requête de génération

```json
{
  "project": "<projectId>",
  "model": "<modelId>",
  "request": {
    "contents": [],
    "systemInstruction": {},
    "generationConfig": {},
    "tools": []
  },
  "requestType": "agent",
  "userAgent": "antigravity",
  "requestId": "agent-<timestamp>-<random>"
}
```

### Réponse SSE

Chaque événement SSE est en général enveloppé dans un champ `response`. Le convertisseur doit :

1. lire les événements `data: {...}` ;
2. extraire `response.candidates[*].content.parts` ;
3. distinguer texte, réflexion, appel d'outil et usage ;
4. émettre des chunks OpenAI Chat Completions ;
5. terminer avec `data: [DONE]`.

## Authentification

### Flux automatique local

1. Générer un couple PKCE `code_verifier` / `code_challenge` S256 ;
2. Générer un `state` aléatoire ;
3. Lancer un serveur callback local sur un port libre ;
4. Ouvrir le navigateur sur l'URL Google ;
5. Valider le `state` retourné ;
6. Échanger le code contre `access_token` et `refresh_token` ;
7. Appeler `loadCodeAssist` pour obtenir projet/plan ;
8. Appeler `fetchAvailableModels` pour initialiser le catalogue ;
9. Stocker les jetons en dehors du workspace.

### Flux manuel

Nécessaire pour WSL2, SSH, conteneur ou serveur sans navigateur :

1. Afficher l'URL d'autorisation ;
2. Laisser l'utilisateur se connecter dans son navigateur ;
3. Lui demander de coller l'URL de redirection complète ;
4. Extraire `code` et `state`, puis poursuivre l'échange.

### Stockage des jetons

Emplacements candidats :

- `%APPDATA%/AIFlowBridge/secrets` sous Windows ;
- `~/.config/aiflowbridge/secrets` sous Linux ;
- `~/Library/Application Support/AIFlowBridge/secrets` sous macOS.

Exigences :

- permissions `0600` lorsque l'OS le permet ;
- chiffrement via coffre OS si possible ;
- aucune écriture dans `kilo.json`, `.env`, le dépôt ou la configuration de projet ;
- jamais de log contenant access token, refresh token ou authorization code ;
- purge possible avec `aiflowbridge auth logout antigravity`.

## API locale exposée

La passerelle doit exposer au minimum :

| Méthode | Route | Fonction |
|---|---|---|
| GET | `/healthz` | État du bridge |
| GET | `/v1/models` | Catalogue OpenAI-compatible généré depuis Antigravity |
| POST | `/v1/chat/completions` | Chat streamé et non streamé |
| GET | `/v1/usage` ou route interne | Plan, crédits et quotas si exposé prudemment |

Authentification locale optionnelle :

- générer une clé locale aléatoire au premier démarrage ;
- la stocker hors du workspace ;
- Kilo envoie `Authorization: Bearer <local-key>` ;
- refuser par défaut les connexions hors `127.0.0.1`/`::1`.

## Conversion OpenAI -> Antigravity

### Messages

| OpenAI | Antigravity / Gemini |
|---|---|
| `system` | `systemInstruction` |
| `user` | `contents` avec `role: "user"` |
| `assistant` | `contents` avec `role: "model"` |
| `tool` | `functionResponse` dans `contents` |
| texte | `parts: [{ text }]` |
| image URL / base64 | `inlineData` ou équivalent supporté |
| appel d'outil | `functionCall` |

### Paramètres

| OpenAI | Antigravity |
|---|---|
| `temperature` | `generationConfig.temperature` |
| `top_p` | `generationConfig.topP` |
| `max_tokens` | `generationConfig.maxOutputTokens` |
| `stop` | `generationConfig.stopSequences` |
| `response_format` | mapping limité si supporté |
| `tools` | `tools` après nettoyage de schéma |

### Nettoyage des schémas d'outils

Supprimer les mots-clés JSON Schema non acceptés par le schéma Gemini, notamment :

```text
$schema, $id, $ref, $defs, definitions, examples,
patternProperties, additionalProperties,
minLength, maxLength, minimum, maximum, multipleOf, pattern, format,
minItems, maxItems, uniqueItems, minProperties, maxProperties
```

Prévoir aussi :

- top-level `type: "object"` ;
- aplatissement ou rejet explicite de `anyOf` / `oneOf` ;
- journalisation non sensible des champs supprimés ;
- tests avec les outils réels envoyés par Kilo CLI.

## Conversion Antigravity -> OpenAI

Produire des chunks compatibles avec Kilo :

- `choices[0].delta.content` pour le texte ;
- `choices[0].delta.tool_calls` pour les appels ;
- index stables de tool calls ;
- `finish_reason` cohérent ;
- événement de fin et fermeture propre ;
- erreur OpenAI normalisée en cas d'erreur upstream.

Attention aux blocs de réflexion/thinking :

- ne pas les présenter comme du texte final sans convention claire ;
- préserver les signatures si nécessaires pour les modèles compatibles ;
- écarter ou marquer les blocs sans signature selon les exigences Antigravity.

## Configuration Kilo CLI cible

Exemple de configuration conceptuelle dans `kilo.json` / `kilo.jsonc` :

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "model": "aiflowbridge/gemini-3-flash",
  "provider": {
    "aiflowbridge": {
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "{env:AIFLOWBRIDGE_LOCAL_KEY}"
      },
      "models": {
        "gemini-3-flash": {
          "id": "antigravity/gemini-3-flash",
          "name": "Gemini via Antigravity",
          "tool_call": true,
          "attachment": true,
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          },
          "limit": {
            "context": 1000000,
            "output": 32768
          }
        }
      }
    }
  }
}
```

Important :

- `{env:...}` n'est résolu que dans une configuration Kilo de confiance ;
- ne pas mettre de clé ou de token dans un `kilo.json` de dépôt ;
- définir `limit.context` et `limit.output`, sinon la compaction et le suivi de contexte de Kilo seront dégradés ;
- vérifier l'identifiant exact du modèle retourné par `fetchAvailableModels` ;
- utiliser les noms réels du compte au moment de la configuration finale.

MiniMax-M3 reste configuré dans Kilo avec le provider MiniMax officiel et la Subscription Key du Token Plan. La bascule se fait ensuite entre par exemple :

```text
aiflowbridge/gemini-3-flash
minimax/MiniMax-M3
```

## Configuration AIFlowBridge proposée

Exemple conceptuel :

```json
{
  "standalone": {
    "host": "127.0.0.1",
    "port": 8787,
    "requireLocalKey": true
  },
  "providers": {
    "antigravity": {
      "enabled": true,
      "oauthMode": "auto",
      "callbackPort": 51121,
      "modelsRefreshMinutes": 30,
      "defaultModel": null,
      "logLevel": "info"
    }
  }
}
```

Ne pas stocker dans ce fichier :

- access token ;
- refresh token ;
- authorization code ;
- client secret ;
- cookies ou contenus de sessions.

## Commandes standalone proposées

```bash
aiflowbridge serve
aiflowbridge auth login antigravity
aiflowbridge auth status antigravity
aiflowbridge auth refresh antigravity
aiflowbridge auth logout antigravity
aiflowbridge models antigravity --refresh
aiflowbridge usage antigravity
```

Si AIFlowBridge est distribué autrement, ces commandes peuvent devenir des commandes VS Code ou des scripts npm, mais le mode CLI local reste préférable pour Kilo CLI.

## Plan de développement

### Phase 0 — Cadrage et preuve de concept

- [ ] Vérifier que le compte Google AI Pro est bien éligible à Antigravity ;
- [ ] Tester le flux OAuth dans un script Node.js isolé ;
- [ ] Obtenir `access_token`, `refresh_token`, email et `projectId` ;
- [ ] Appeler `loadCodeAssist` et journaliser uniquement plan/projet/quota, pas les secrets ;
- [ ] Appeler `fetchAvailableModels` ;
- [ ] Identifier les modèles réellement accessibles ;
- [ ] Envoyer une requête texte minimale à `streamGenerateContent` ;
- [ ] Documenter les réponses d'erreur 401, 403, 404 et 429.

Livrable : script PoC reproductible et tableau des modèles autorisés.

### Phase 1 — Intégration provider

- [ ] Créer `src/provider/antigravity/` ;
- [ ] Implémenter `pkce.ts`, `oauth.ts`, `callback-server.ts` ;
- [ ] Implémenter `auth-store.ts` ;
- [ ] Implémenter `project.ts` et `models.ts` ;
- [ ] Ajouter le provider à `src/provider/index.ts` ;
- [ ] Ajouter les commandes d'authentification standalone ;
- [ ] Ajouter tests unitaires PKCE, callback, refresh et parsing de modèles.

Livrable : connexion Google fonctionnelle et catalogue de modèles local.

### Phase 2 — Passerelle OpenAI-compatible

- [ ] Exposer `/v1/models` ;
- [ ] Exposer `/v1/chat/completions` non streamé ;
- [ ] Ajouter SSE `/v1/chat/completions` avec `stream: true` ;
- [ ] Convertir texte et system prompt ;
- [ ] Normaliser erreurs HTTP et quota ;
- [ ] Ajouter `/healthz` ;
- [ ] Ajouter clé locale optionnelle ;
- [ ] Tester avec `curl`, puis avec un client OpenAI minimal.

Livrable : endpoint local utilisable par n'importe quel client OpenAI-compatible.

### Phase 3 — Intégration Kilo CLI

- [ ] Ajouter le provider `aiflowbridge` dans la configuration Kilo globale ;
- [ ] Vérifier la détection automatique via `/v1/models` ;
- [ ] Définir `limit.context`, `limit.output`, `tool_call`, `modalities` ;
- [ ] Tester une question simple ;
- [ ] Tester une tâche de lecture de fichier ;
- [ ] Tester une tâche d'édition simple ;
- [ ] Tester un flux avec plusieurs messages et plusieurs appels d'outils ;
- [ ] Mesurer latence, stabilité du stream et erreurs.

Livrable : Kilo CLI utilise Gemini via Antigravity et MiniMax-M3 via son provider officiel.

### Phase 4 — Agentique complet

- [ ] Convertir les tools Kilo en schémas compatibles Gemini ;
- [ ] Convertir les function calls et function responses ;
- [ ] Préserver les IDs et l'ordre des appels ;
- [ ] Gérer les annulations et timeouts ;
- [ ] Ajouter images et pièces jointes si supportées ;
- [ ] Ajouter stratégie d'erreur pour modèle restreint / flux vide ;
- [ ] Tester avec un dépôt réel en lecture seule ;
- [ ] Tester avec des éditions contrôlées sur une branche de test.

Livrable : utilisation agentique supervisée dans Kilo CLI.

### Phase 5 — Qualité, observabilité et documentation

- [ ] Exposer les métriques dans les systèmes existants d'AIFlowBridge ;
- [ ] Distinguer tokens locaux/OpenAI et quotas Antigravity ;
- [ ] Ajouter tests contractuels avec fixtures SSE ;
- [ ] Ajouter tests d'intégration sans secret via mocks ;
- [ ] Documenter installation et dépannage ;
- [ ] Documenter que les endpoints sont non officiels et susceptibles de changer ;
- [ ] Ajouter procédure de révocation des jetons ;
- [ ] Ajouter checklist de sécurité avant release.

## Tests requis

### Tests unitaires

- génération PKCE S256 ;
- construction d'URL OAuth ;
- validation `state` ;
- parsing de callback ;
- expiration et refresh de token ;
- nettoyage des schémas d'outils ;
- conversion messages OpenAI -> Gemini ;
- conversion SSE Antigravity -> OpenAI ;
- normalisation des erreurs 401/403/404/429/500.

### Tests contractuels

Fixtures à conserver sans données sensibles :

- réponse `loadCodeAssist` ;
- réponse `fetchAvailableModels` ;
- événements SSE texte ;
- événements SSE function call ;
- événements SSE usage metadata ;
- erreur quota 429 avec `quotaResetDelay` ;
- flux 200 vide pour modèle restreint.

### Tests d'intégration Kilo

- `kilo models` voit les modèles ;
- sélection du modèle `aiflowbridge/...` ;
- chat simple ;
- lecture d'un fichier ;
- édition d'un fichier sur branche jetable ;
- appel d'outil shell en mode supervisé ;
- bascule vers `MiniMax-M3` sans redémarrage ;
- reprise après refresh token ;
- comportement lorsque le bridge est arrêté.

## Sécurité et conformité

- Ne jamais committer `access_token`, `refresh_token`, cookies ou code OAuth ;
- Ne jamais journaliser les corps complets contenant code utilisateur ou secrets ;
- Utiliser un coffre système ou fichiers locaux protégés ;
- Refuser l'écoute publique par défaut ;
- Prévoir une clé locale et un allowlist d'origine ;
- Isoler le bridge par utilisateur OS ;
- Prévoir `logout` + révocation Google ;
- Garder la mention « intégration non officielle » dans la documentation ;
- Respecter les conditions Google, Antigravity, Kilo et MiniMax ;
- Ne pas tenter de contourner les quotas ; afficher l'erreur et laisser l'utilisateur choisir un autre modèle.

## Risques

| Risque | Impact | Mitigation |
|---|---:|---|
| Endpoint interne Google modifié | Élevé | centraliser endpoints/headers, tests contractuels, message d'erreur clair |
| OAuth refusé ou scope modifié | Élevé | mode manuel, diagnostics, documentation de reconnexion |
| Catalogue dépendant du compte | Moyen | découverte dynamique, ne pas figer la liste des modèles |
| Flux 200 vide pour modèle restreint | Moyen | considérer comme erreur et proposer un autre modèle |
| Tool calling partiellement compatible | Élevé | MVP texte d'abord, puis fixtures et mapping incrémental |
| Fuite de jetons | Critique | stockage hors workspace, permissions, redaction des logs, revue sécurité |
| Kilo envoie des paramètres incompatibles | Moyen | normaliser dans le bridge et configurer les capacités du modèle |
| Confusion entre AI Pro et Gemini API | Moyen | documentation explicite : OAuth Antigravity uniquement, pas `GEMINI_API_KEY` |

## Critères d'acceptation du MVP

Le MVP est accepté si :

1. `aiflowbridge auth login antigravity` fonctionne en local ;
2. les jetons sont stockés hors du dépôt et rafraîchis automatiquement ;
3. `GET /v1/models` retourne les modèles Antigravity autorisés au compte ;
4. `POST /v1/chat/completions` fonctionne en texte, streaming et non streaming ;
5. Kilo CLI peut ajouter `http://127.0.0.1:<port>/v1` comme provider OpenAI-compatible ;
6. Kilo CLI peut utiliser le modèle exposé pour une question/réponse ;
7. MiniMax-M3 reste utilisable dans Kilo via le provider MiniMax officiel ;
8. aucune clé Gemini API payante n'est requise pour le chemin Antigravity ;
9. aucune information d'authentification n'apparaît dans les logs ;
10. la documentation décrit clairement le caractère expérimental/non officiel.

## Décision d'implémentation proposée

Commencer par la passerelle OpenAI-compatible plutôt que par un plugin Kilo natif.

Cette approche :

- réutilise mieux l'architecture standalone existante d'AIFlowBridge ;
- fonctionne pour Kilo CLI et l'extension VS Code ;
- reste utile avec d'autres clients ;
- isole le risque lié aux endpoints Antigravity ;
- permet de garder MiniMax-M3 sur son intégration officielle ;
- offre un MVP plus rapide et plus testable.

Une fois la passerelle validée, un plugin Kilo natif peut être envisagé seulement si l'expérience exige une intégration plus profonde : découverte automatique avancée, interface de connexion dans Kilo, ou affichage natif des quotas Antigravity.
