# Audit - Rapport de Modifications à Apporter

**Version analysée :** commit `5ea0408`
**Date :** 2026-06-05
**Destinataire :** Agent de développement
**Priorité :** Les items sont classés par niveau de risque (🔴 Critique → 🟡 Mineur)

---

## Résumé Exécutif

L'analyse statique du codebase `AIFlowBridge` a identifié **2 failles de sécurité mineures**, **3 bugs potentiels** et **3 opportunités de refactoring** (redondances/code mort). Aucun bug bloquant n'a été détecté. L'ensemble des modifications listées ci-dessous vise à renforcer la robustesse défensive du code sans en modifier le comportement observable pour l'utilisateur.

---

## 1. Sécurité

### 1.1 🔴 Endpoint `/shutdown` sans authentification

**Fichier :** `src/aiflowbridge/gateway/server.ts`
**Méthode :** `handleRequest()` - branche `POST /shutdown`

**Problème :**
L'endpoint `POST /shutdown` stoppe le gateway sans vérifier que le caller est bien un peer AIFlowBridge légitime. Bien que le serveur écoute sur `127.0.0.1` uniquement, n'importe quel processus local (malveillant ou non) peut déclencher un arrêt via une simple requête HTTP.

**Modification à apporter :**
Générer un token aléatoire unique au démarrage du `GatewayService` et l'inclure dans la réponse `/version`. Le peer doit le fournir dans un header `X-AIFlowBridge-Shutdown-Token` lors de l'appel `/shutdown`. Rejeter toute requête sans token valide avec un 403.

**Implémentation suggérée :**

```typescript
// Dans GatewayService - champ privé
private readonly shutdownToken: string = randomUUID();

// Dans handleRequest() - branche POST /shutdown
if (request.method === "POST" && path === "/shutdown") {
  const providedToken = request.headers["x-aiflowbridge-shutdown-token"];
  if (providedToken !== this.shutdownToken) {
    this.writeJson(response, 403, { error: "Unauthorized shutdown attempt" });
    return;
  }
  // ... reste du code inchangé
}

// Dans handleRequest() - branche GET /version
// Ajouter shutdownToken dans la réponse pour que le peer puisse l'utiliser
this.writeJson(response, 200, {
  name: GATEWAY_SERVICE_NAME,
  version: this.bundledVersion,
  pid: process.pid,
  startedAt: this.startedAt,
  shutdownToken: this.shutdownToken,  // ← nouveau champ
});
```

**Dans `probe.ts` - `PeerVersion` interface et `requestPeerShutdown()` :**

```typescript
export interface PeerVersion {
  name: string;
  version: string;
  pid: number;
  startedAt: string;
  shutdownToken?: string; // ← nouveau champ optionnel
}

export async function requestPeerShutdown(
  port: number,
  shutdownToken: string, // ← nouveau paramètre
  options: ShutdownOptions = {}
): Promise<boolean> {
  // ...
  const response = await fetch(`${peerControlUrl(port)}/shutdown`, {
    method: "POST",
    headers: {
      "X-AIFlowBridge-Shutdown-Token": shutdownToken, // ← ajout
    },
    signal: controller.signal,
  });
  // ...
}
```

**Dans `server.ts` - `handleOccupiedPort()` :**
Mettre à jour l'appel à `requestPeerShutdown(port)` pour passer `peer.shutdownToken ?? ""`.

---

### 1.2 🟠 `baseUrl` provider non validée - risque SSRF

**Fichier :** `src/aiflowbridge/providers.ts`
**Fonction :** `normalizeProviderProfiles()`

**Problème :**
Le champ `baseUrl` d'un provider n'est validé que par `typeof === "string"`. Un utilisateur peut entrer `file:///etc/passwd`, `http://169.254.169.254/` (metadata cloud) ou `http://localhost:22/` sans que le code le rejette.

**Modification à apporter :**
Ajouter une fonction de validation `isValidProviderBaseUrl()` qui vérifie :

- Le schéma est `http:` ou `https:` uniquement
- L'hôte n'appartient pas à une plage réservée (loopback `127.x.x.x` / `::1`, link-local `169.254.x.x`, métadonnées cloud AWS/GCP/Azure)

**Exception intentionnelle :** `127.0.0.1` doit rester autorisé pour les providers Ollama locaux. Filtrer uniquement les ports sensibles sur loopback si nécessaire, ou documenter explicitement que loopback est autorisé pour les use cases locaux.

```typescript
// Ajouter dans providers.ts

const BLOCKED_HOSTS = [
  /^169\.254\./, // AWS/GCP/Azure metadata
  /^100\.100\.100\.200/, // Alibaba Cloud metadata
];

function isValidProviderBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const host = url.hostname;
  return !BLOCKED_HOSTS.some((pattern) => pattern.test(host));
}

// Dans normalizeProviderProfiles() - remplacer la ligne baseUrl :
const baseUrl = toString(candidate.baseUrl);
if (!id || !label || !baseUrl || !model || !isValidProviderBaseUrl(baseUrl)) {
  return undefined;
}
```

---

## 2. Bugs Potentiels

### 2.1 🟠 Fallback telemetrie trompeur dans `gatewaySnapshot()`

**Fichier :** `src/aiflowbridge/index.ts`
**Méthode :** `gatewaySnapshot()` dans `AIFlowBridgeRuntime`

**Problème :**

```typescript
private gatewaySnapshot(): TelemetrySnapshot {
  const snapshot = this.gateway.snapshot();
  if (snapshot.requests > 0) {
    return snapshot;
  }
  return this.telemetryFallback.snapshot();  // ← retourne les données de la session précédente
}
```

Quand le gateway vient de démarrer et a traité 0 requêtes, la méthode retourne `this.telemetryFallback.snapshot()` - les données persistées de la session précédente. Ces données s'affichent comme si elles étaient "en cours", ce qui peut induire l'utilisateur en erreur (le dashboard affiche des métriques "vieilles" comme live).

**Modification à apporter :**
La logique de fallback doit s'appliquer uniquement si le gateway **n'a pas encore été initialisé ou est stoppé**, pas systématiquement quand `requests === 0`. Utiliser un flag `persistedTelemetryLoaded` ou déléguer la logique de merge au `TelemetryStore`.

```typescript
private gatewaySnapshot(): TelemetrySnapshot {
  const liveSnapshot = this.gateway.snapshot();
  // Retourner le snapshot live, qu'il soit à 0 ou non.
  // Le fallback ne s'applique que si le gateway n'est pas running.
  if (this.gateway.running || liveSnapshot.requests > 0) {
    return liveSnapshot;
  }
  // Gateway stoppé ET aucune requête live : afficher les données persistées
  return this.telemetryFallback.snapshot();
}
```

---

### 2.2 🟡 Race condition dans `readBody()` - event `close` après `end`

**Fichier :** `src/aiflowbridge/gateway/server.ts`
**Fonction :** `readBody(request: IncomingMessage)`

**Problème :**

```typescript
request.on("end", () => {
  resolve(Buffer.concat(chunks).toString("utf8"));
});
request.on("close", () => reject(new Error("Client disconnected")));
```

En cas de déconnexion normale, `end` peut se déclencher avant `close`. La Promise est déjà résolue mais l'event `close` tente quand même un `reject` - ignoré par la spec Promise, mais l'event listener reste en mémoire jusqu'au garbage collect. Plus grave : si `close` se déclenche avant `end` (déconnexion brutale), la Promise est correctement rejetée mais les chunks déjà accumulés ne sont pas libérés immédiatement.

**Modification à apporter :**
Utiliser un flag `settled` et appeler `request.destroy()` à la fermeture anticipée. Nettoyer les listeners après résolution.

```typescript
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    request.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        settle(() => reject(new Error("Request body too large")));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      settle(() => resolve(Buffer.concat(chunks).toString("utf8")));
    });

    request.on("error", (error) => {
      settle(() => reject(error));
    });

    request.on("close", () => {
      if (!settled) {
        settle(() => reject(new Error("Client disconnected")));
      }
    });
  });
}
```

---

### 2.3 🟡 État `joined` non réinitialisé lors d'un rechargement de config

**Fichier :** `src/aiflowbridge/index.ts`
**Méthode :** `reloadConfiguration()`

**Problème :**

```typescript
private async reloadConfiguration(): Promise<void> {
  const wasRunning = this.gateway.running;
  if (wasRunning) {
    await this.gateway.stop();  // ← met joined = false, OK
  }
  this.config = await loadConfig(this.context);
  this.gateway.updateConfig(this.config);
  if (this.config.gateway.enabled) {
    await this.gateway.start();
  }
  // ...
}
```

Quand `wasRunning === true` mais que le gateway était en mode `joined` (socket owned par un peer), `gateway.stop()` met `joined = false` correctement. Cependant, `this.gateway.running` retourne `true` si `joined === true`, donc `wasRunning` est `true`. Le code tente alors `gateway.stop()` (ok) puis `gateway.start()`. Si le peer est toujours sur le port, `start()` détectera un port occupé et re-joindra - comportement fonctionnellement correct, mais non documenté.

**Modification à apporter :**
Documenter explicitement ce chemin dans un commentaire inline, et vérifier que l'appel à `gateway.start()` dans `reloadConfiguration` traite bien les erreurs de type `EPEERSTALLED` comme dans `activate()`.

```typescript
private async reloadConfiguration(): Promise<void> {
  const wasRunning = this.gateway.running; // true si owned ou joined
  if (wasRunning) {
    await this.gateway.stop();
    // Note: si le gateway était en mode "joined" (peer socket), stop()
    // libère uniquement le flag joined. Le peer reste actif sur le port.
    // Le start() ci-dessous re-détectera le peer et re-joindra si pertinent.
  }

  this.config = await loadConfig(this.context);
  this.gateway.updateConfig(this.config);

  if (this.config.gateway.enabled) {
    try {
      await this.gateway.start();
    } catch (error) {
      // Traitement d'erreur analogue à activate()
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as NodeJS.ErrnoException).code;
      const peerPid = (error as { peerPid?: number }).peerPid;
      logger.error(`[AIFlowBridge] Gateway failed to restart after config reload: ${message}`);
      if (code === "EPEERSTALLED" && typeof peerPid === "number") {
        void vscode.window.showWarningMessage(
          `AIFlowBridge: le gateway ne peut pas redémarrer, l'ancienne instance (pid ${peerPid}) n'a pas libéré le port.`
        );
      } else {
        void vscode.window.showWarningMessage(`AIFlowBridge gateway failed to restart: ${message}`);
      }
    }
  }

  this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
}
```

---

## 3. Refactoring - Redondances & Code Mort

### 3.1 🟡 Factoriser `synthesizeProvidersFromUserModels` et `synthesizeProvidersFromBuiltInModels`

**Fichier :** `src/aiflowbridge/config.ts`

**Problème :**
Les deux fonctions exportées ont un corps quasi-identique (construction du `Set<taken>`, appel à `synthesizeProviderForModel`, fusion des résultats). Seule la source des modèles diffère (`getUserModels()` vs `registry.models`).

**Modification à apporter :**
Extraire la logique commune dans une fonction privée et faire en sorte que les deux fonctions publiques ne soient plus que des wrappers.

```typescript
// Fonction privée commune (non exportée)
function synthesizeProviders(
  models: Array<{ id: string; name: string; family: string; pricing?: { inputPerMillion: number; outputPerMillion: number; currency: string } }>,
  existing: ProviderProfile[],
  configuration: vscode.WorkspaceConfiguration,
  registry: ModelRegistry
): ProviderProfile[] {
  const taken = new Set<string>();
  for (const profile of existing) {
    taken.add(profile.id);
    taken.add(profile.model);
  }
  const familyPricing = getFamilyPricing();
  const synthesized: ProviderProfile[] = [];
  for (const model of models) {
    const synthesizedProfile = synthesizeProviderForModel(model, taken, familyPricing, configuration, registry);
    if (synthesizedProfile) {
      synthesized.push(synthesizedProfile);
    }
  }
  return [...existing, ...synthesized];
}

// Les deux fonctions publiques deviennent de simples wrappers
export function synthesizeProvidersFromUserModels(
  existing: ProviderProfile[],
  configuration: vscode.WorkspaceConfiguration,
  registry: ModelRegistry
): ProviderProfile[] {
  const userModels = getUserModels();
  if (userModels.length === 0) return existing;
  return synthesizeProviders(userModels, existing, configuration, registry);
}

export function synthesizeProvidersFromBuiltInModels(
  existing: ProviderProfile[],
  configuration: vscode.WorkspaceConfiguration,
  registry: ModelRegistry
): ProviderProfile[] {
  return synthesizeProviders(registry.models, existing, configuration, registry);
}
```

---

### 3.2 🟡 Supprimer le wrapper inutile `isPortLikelyOccupied()`

**Fichier :** `src/aiflowbridge/index.ts`

**Problème :**

```typescript
// En bas du fichier
async function isPortLikelyOccupied(port: number): Promise<boolean> {
  return isPortInUse(port);
}
```

Cette fonction est un wrapper trivial sans valeur ajoutée. Elle délègue directement à `isPortInUse` sans transformation ni logique supplémentaire.

**Modification à apporter :**
Supprimer la fonction `isPortLikelyOccupied` et remplacer son unique appel (dans `activate()`) par un appel direct à `isPortInUse`.

```typescript
// Dans activate() - remplacer :
const isOccupied = await isPortLikelyOccupied(port);
// Par :
const isOccupied = await isPortInUse(port);

// Et supprimer la déclaration de isPortLikelyOccupied en bas du fichier.
```

---

### 3.3 🟡 Vérifier et potentiellement supprimer `getApiModelId()` alias

**Fichier :** `src/config.ts`

**Problème :**

```typescript
export function getApiModelId(vscodeModelId: string): string {
  return getProviderApiModelId("deepseek", vscodeModelId);
}
```

Cette fonction est un alias hardcodé sur le vendor `deepseek`. Si elle n'est plus utilisée directement (les appels passent tous par `getProviderApiModelId` avec un vendor explicite), c'est du code mort.

**Modification à apporter :**

1. Effectuer un grep dans tout le codebase (y compris `src/provider/` et `src/runtime/` non analysés ici) pour identifier tous les call sites de `getApiModelId`.
2. Si aucun call site n'est trouvé, supprimer la fonction.
3. Si des call sites existent mais pourraient utiliser `getProviderApiModelId('deepseek', ...)` directement, les migrer et supprimer l'alias.

```bash
# Commande de vérification avant suppression
grep -rn "getApiModelId\b" src/ tests/
```

---

## 4. Tableau Récapitulatif

| #   | Fichier                                  | Type        | Priorité   | Action                                         |
| --- | ---------------------------------------- | ----------- | ---------- | ---------------------------------------------- |
| 1.1 | `gateway/server.ts` + `gateway/probe.ts` | Sécurité    | 🔴 Haute   | Ajouter authentification token sur `/shutdown` |
| 1.2 | `providers.ts`                           | Sécurité    | 🟠 Moyenne | Valider `baseUrl` (schéma + blocklist IP)      |
| 2.1 | `index.ts` - `gatewaySnapshot()`         | Bug         | 🟠 Moyenne | Corriger logique de fallback telemetrie        |
| 2.2 | `gateway/server.ts` - `readBody()`       | Bug         | 🟡 Faible  | Corriger race condition event `close`/`end`    |
| 2.3 | `index.ts` - `reloadConfiguration()`     | Bug         | 🟡 Faible  | Gérer erreurs EPEERSTALLED au reload           |
| 3.1 | `aiflowbridge/config.ts`                 | Refactoring | 🟡 Faible  | Factoriser les deux fonctions `synthesize*`    |
| 3.2 | `index.ts`                               | Code mort   | 🟡 Faible  | Supprimer `isPortLikelyOccupied()`             |
| 3.3 | `config.ts`                              | Code mort   | 🟡 Faible  | Vérifier et supprimer `getApiModelId()` alias  |

---

## 5. Consignes pour l'Agent

- **Ne pas modifier le comportement observable** : toutes les corrections sont défensives ou internes. Les APIs publiques (commandes VS Code, endpoints HTTP, signature des fonctions exportées) ne doivent pas changer.
- **Tests à mettre à jour** : les items 1.1 et 2.2 nécessitent des mises à jour dans `tests/gateway.test.ts` et `tests/gateway-restart.test.ts`. Les nouveaux paramètres de `requestPeerShutdown()` (item 1.1) doivent être reflétés dans les mocks de `tests/helpers.ts`.
- **Ordre d'application recommandé** : 1.1 → 1.2 → 2.1 → 3.2 → 3.3 → 2.2 → 2.3 → 3.1
- **Tests à exécuter après chaque item** : `npm test` (Vitest). S'assurer que tous les tests passent avant de passer à l'item suivant.
- **Item 3.3** : ne pas supprimer `getApiModelId` sans avoir exécuté le grep de vérification sur l'intégralité du repo, y compris `src/provider/` et `src/runtime/` (non inclus dans cette analyse).
