# Code Review – Architecture & Quality Audit

> **Date :** 2026-07-11  
> **Scope :** Analyse statique complète du dépôt `AIFlowBridge` (branche `main`)  
> **Auteur :** Perplexity AI (audit automatique, demande de LaurentOngaro)

---

## 1. Vue d'ensemble

AIFlowBridge est une **extension VS Code + CLI standalone** écrite en **TypeScript** (Node.js). Elle expose un gateway HTTP local compatible OpenAI (`/v1/chat/completions`) qui route les requêtes vers des providers IA tiers (MiniMax, DeepSeek, Xiaomi MiMo). Elle intègre également un mécanisme de télémétrie locale, un registre de modèles 3-tier, et des providers VS Code Copilot Chat.

---

## 2. Structure du projet

### 2.1 Arborescence globale

```
.github/                  CI/CD workflows
_helpers/                 Scripts utilitaires de build
docs/                     Documentation publique
resources/                Registre de modèles (JSON + schema)
scripts/                  Scripts de release et packaging
src/
├── aiflowbridge/         Cœur host-agnostic (gateway, télémétrie, UI)
│   ├── gateway/          Serveur HTTP, probe, lock
│   ├── telemetry/        Persistence fichier avec lock
│   ├── context/          Détection workspace
│   └── ui/               Dashboard webview + status bar
├── provider/             Providers Copilot Chat (DeepSeek, MiniMax, Xiaomi)
├── client/               Client HTTP interne
├── runtime/              Lifecycle VS Code spécifique
├── standalone/           Binaire CLI Node.js
└── *.ts                  Utilitaires racine
tests/                    Tests unitaires (Vitest)
```

### 2.2 Verdict – Structure

| Critère | Note | Commentaire |
|---|---|---|
| Séparation host-agnostic / VS Code | ✅ Excellent | Le cœur (`aiflowbridge/`) n'a aucune dépendance `vscode` |
| Découpage par responsabilité | ✅ Bon | Chaque module a un rôle clair et unique |
| Cohérence des noms de fichiers | ✅ Bon | Convention kebab-case respectée uniformément |
| Point d'entrée unique | ✅ Bon | `index.ts` par sous-module, `extension.ts` racine |

---

## 3. Qualité du code

### 3.1 Cohérence et bonnes pratiques

**Points positifs :**

- TypeScript strict activé (`tsconfig.json`), typage explicite sur presque tous les paramètres et retours.
- Architecture `IGatewayContext` + adaptateurs (`createVSCodeContext`, `createStandaloneContext`) : pattern Adapter propre, 100 % testable sans VS Code.
- Toutes les ressources ont leur mécanisme `dispose()` / cleanup enregistré dans `ctx.subscriptions`.
- Gestion des promesses cohérente : `void` explicite pour les fire-and-forget, `async/await` partout ailleurs.
- Commentaires JSDoc abondants et précis sur les classes et méthodes publiques.
- Linting + formatting configuré (`.vscode/settings.json`, `vitest.config.ts`).

**Points à améliorer :**

- `server.ts` fait **~2 000 lignes**. La méthode `forwardChatCompletion()` seule dépasse ~400 lignes. Elle gère simultanément : validation de la requête, résolution du provider, timeout management, streaming, télémétrie. Cette concentration viole le principe de **responsabilité unique (SRP)**.
  - *Recommandation :* Extraire au minimum un `StreamingHandler`, un `RequestValidator`, et un `TelemetryRecorder`.
- `savePersistedTelemetry()` dans `index.ts` est explicitement un **no-op** conservé pour compatibilité de contrat. Ce code mort crée de la confusion.
  - *Recommandation :* Documenter clairement dans l'interface que la méthode peut être un no-op, ou la supprimer de l'interface si ce n'est plus nécessaire.
- La commande `aiflowbridge.setVisionModel` est re-enregistrée comme alias vers `aiflowbridge.providers.deepseek.setVisionModel` avec un commentaire signalant que le handler original a été supprimé lors d'un refactor. Ce pattern de "zombie command" doit être traité définitivement.

### 3.2 Redondances détectées

| Localisation | Description | Priorité |
|---|---|---|
| `src/config.ts` et `src/aiflowbridge/config.ts` | Deux fichiers `config.ts` à des niveaux différents. La séparation est justifiée (VS Code vs host-agnostic) mais le naming identique peut prêter à confusion lors d'imports. | Moyenne |
| Résolution du `providerSemaphores` (module state) dans `server.ts` | Le Map de sémaphores est au niveau module – il survit à plusieurs instances `GatewayService`. Si deux instances coexistent (cas test), elles partagent les sémaphores, ce qui peut fausser les tests. | Moyenne |
| `telemetry.ts` (racine `aiflowbridge/`) et `telemetry/persistence.ts` | La télémétrie est bien découpée mais la logique de restoration est dupliquée entre `GatewayService.init()` et `AIFlowBridgeRuntime.loadPersistedTelemetry()`. | Faible |

---

## 4. Sécurité

### 4.1 Points positifs

- **Shutdown token** : l'endpoint `POST /shutdown` exige un token UUID aléatoire par instance, retourné par `GET /version`. Un process local ne peut pas stopper le gateway sans connaître ce token. ✅
- **Binding loopback uniquement** : `server.listen(port, '127.0.0.1')`. Le gateway n'est jamais exposé sur une interface réseau externe. ✅
- **Sanitisation des erreurs upstream** : `sanitizeUpstreamErrorMessage()` redacte les query params d'API key (`api_key=`, `token=`, etc.) avant de les envoyer au client. ✅
- **Body size cap** : `MAX_BODY_SIZE = 10 MB` avec destruction immédiate du socket en cas de dépassement. ✅
- **Header length cap** : `MAX_LANGUAGE_HINT_HEADER_LENGTH = 64` pour éviter les allocations sur des headers hostiles. ✅
- **SSRF mitigation** : les requêtes de probe et shutdown vers le peer sont toujours envoyées à `http://127.0.0.1:<port>`, jamais à la `baseUrl` configurable. ✅
- **Clés API** : gérées via VS Code `SecretStorage` + résolution lazy, jamais sérialisées dans des logs. ✅

### 4.2 Points de vigilance

| ID | Localisation | Description | Sévérité |
|---|---|---|---|
| SEC-01 | `server.ts` `GET /version` | Expose `process.pid` et le `shutdownToken` à tout processus local. Le binding 127.0.0.1 limite le risque mais tout processus sur la même machine peut lire le token et déclencher un shutdown. | Faible |
| SEC-02 | `server.ts` `GET /health`, `/metrics` | Ces endpoints ne requièrent aucune authentification et exposent la liste des providers actifs et les métriques de télémétrie. En loopback c'est acceptable, mais à documenter clairement. | Information |
| SEC-03 | `resolveLanguageHint()` | Le header `X-AIFlowBridge-Language` est tronqué à 64 chars AVANT `trim()` (correction bien faite), mais la valeur est ensuite utilisée directement comme clé de routage. Si un provider interprète cette valeur, une injection via ce header reste théoriquement possible. | Très faible |
| SEC-04 | `translatePayloadForUpstream()` | Les champs `reasoning` et `reasoning_effort` sont supprimés du payload avant envoi upstream. Aucun autre champ arbitraire n'est filtré – le payload complet du client est transmis. Pour un gateway local c'est le comportement attendu, mais à documenter dans la politique de sécurité. | Information |

---

## 5. Code mort et dette technique

| Localisation | Description | Priorité |
|---|---|---|
| `AIFlowBridgeRuntime.savePersistedTelemetry()` | Méthode explicitement no-op, conservée pour la compatibilité d'interface. | Haute |
| `aiflowbridge.setVisionModel` (command) | Alias zombie vers une commande `deepseek`-spécifique. | Haute |
| `void ttfbMs;` dans `forwardChatCompletion` | Variable capturée uniquement pour satisfaire eslint, valeur jamais exploitée. Indique un refactoring incomplet. | Moyenne |
| Commentaires `// B-01`, `// BUG17 fix A/B/C/D/E`, etc. | Les tags de bugs inline sont utiles pendant le développement actif mais pollueront la lisibilité à long terme. Prévoir un passage de nettoyage après stabilisation. | Basse |

---

## 6. Bugs potentiels

| ID | Localisation | Description | Sévérité |
|---|---|---|---|
| BUG-01 | `server.ts` `stop()` | `setTimeout(() => { void this.server?.close(); }, 100)` dans le handler `/shutdown` : si `stop()` est appelé dans les 100 ms qui suivent, `this.server` est mis à `undefined` par `stop()` avant que le timeout expire. Le `?.` protège contre le crash mais le socket ne sera pas fermé proprement. | Faible |
| BUG-02 | `providerSemaphores` (module state) | Si `GatewayService` est instancié plusieurs fois dans le même process (tests ou reload), le semaphore par provider est partagé entre instances. Une instance qui ne se termine pas proprement peut bloquer la suivante. | Faible (tests) |
| BUG-03 | `AIFlowBridgeRuntime.gatewayInfo` | Accédé avant `activate()` → `this.config` et `this.gateway` sont `undefined` (opérateur `!` TypeScript) → crash runtime `Cannot read properties of undefined`. Le getter n'est protégé par aucune garde. | Moyenne |
| BUG-04 | `reloadConfiguration()` | Si `gateway.start()` lève une erreur ET que `wasRunning` était `false`, le gateway se retrouve dans un état `!running` sans message d'erreur clair pour l'utilisateur (le catch affiche un warning générique mais ne distingue pas le cas "n'était pas démarré"). | Faible |

---

## 7. Couverture de tests

- Le dossier `tests/` existe et Vitest est configuré (`vitest.config.ts`).
- Les fonctions exportées de `server.ts` (`formatRequestLogLine`, `formatLocalTimestamp`, `sanitizeUpstreamErrorMessage`, `translatePayloadForUpstream`, `normalizeClientId`, `resolveClientId`, `prependSystemMessage`) sont bien conçues pour être testables (pures, sans effets de bord).
- La couverture des cas d'erreur du streaming (`forwardChatCompletion` – chemins d'erreur watchdog) et du cycle start/stop du gateway mériterait d'être vérifiée.

---

## 8. Résumé et priorités

### 🔴 Haute priorité

1. **Refactoriser `forwardChatCompletion()`** : extraire la gestion des timeouts, le streaming, et l'enregistrement télémétrique dans des fonctions/classes dédiées.
2. **Supprimer ou formaliser les stubs no-op** : `savePersistedTelemetry()` et la commande alias `setVisionModel`.

### 🟡 Priorité moyenne

3. **Protéger `gatewayInfo`** avec une garde avant `activate()` (éviter le crash runtime).
4. **Déplacer `providerSemaphores`** en propriété d'instance plutôt qu'état de module, pour l'isolation en tests.
5. **Renommer** l'un des deux `config.ts` (ex. `aiflowbridge-config.ts`) pour éviter l'ambiguïté à l'import.

### 🟢 Basse priorité

6. Nettoyer les tags `BUG17`, `B-01`, etc. après la phase de stabilisation.
7. Documenter explicitement dans `SECURITY.md` le comportement des endpoints `/health` et `/metrics` (no auth by design).
8. Ajouter un test pour le cas `gatewayInfo` appelé avant `activate()`.

---

## 9. Conclusion

Le code est **globalement de très bonne qualité** pour un projet à ce stade de maturité. L'architecture host-agnostic est un choix de conception remarquable qui facilite les tests et la portabilité. La sécurité du gateway (shutdown token, loopback, sanitisation) est bien pensée et correctement implémentée. Les principaux axes d'amélioration concernent la **taille de `server.ts`** (dette de complexité accumulée lors de corrections de bugs successives) et quelques résidus de refactorings précédents (no-ops, alias zombie, variable inutilisée). Aucun bug critique ou faille de sécurité majeure n'a été identifié.
