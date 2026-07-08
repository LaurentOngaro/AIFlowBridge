# ACTION PLAN

This document details the steps to implement some of the features and fixes listed in `TODO.md`. It completes the `TODO.md` file by adding the necessary technical details.

---

## Follow-up agreement

Each completed edit:

- Check the box in this document (go from `[ ]` to `[x]`)
- Update the status in `TODO.md` if a section references it
- Keep the history of this document (do not delete completed sections)

---

## FEAT7: Standalone Gateway - serveur indépendant de VS Code

> **Status:** shipped in 1.7.0 (591 tests / 29 files; was 551 / 27).

### Objectif

Permettre au gateway AIFlowBridge de fonctionner sans que VS Code soit ouvert, afin qu'il puisse être consommé par n'importe quel client OpenAI-compatible (Continue/JetBrains, Kilo Code, JetBrains AI Assistant, curl, etc.).

### Contexte / motivation

Actuellement, le `GatewayService` est lancé dans l'extension host VS Code et s'arrête dès que VS Code est fermé. Pour utiliser le gateway depuis JetBrains (via le plugin Continue ou le custom endpoint de JetBrains AI Assistant), il faut que VS Code tourne en parallèle - ce qui est contraignant.

L'objectif est de permettre de lancer le gateway comme un **process Node.js autonome** (service OS, script shell, démarrage automatique au login), tout en conservant le comportement singleton existant : si VS Code est ouvert **et** que le standalone tourne déjà, VS Code « rejoint » le gateway existant au lieu d'en créer un second (la logique `lock.ts` + `probe.ts` est déjà prête pour ça).

### Architecture cible

```
Avant :  [VS Code Extension] → owns → [GatewayService]

Après :  [standalone node process] → owns  → [GatewayService]
         [VS Code Extension]        → joins → [GatewayService] (probe/lock)
         [JetBrains / Kilo / curl]  → calls → [GatewayService] (HTTP OpenAI-compatible)
```

### Analyse du code existant (points de couplage vscode)

| Fichier                                | Couplage vscode à abstraire                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/aiflowbridge/index.ts`            | `vscode.ExtensionContext` : secrets, globalState, globalStorageUri, onDidChangeConfiguration |
| `src/aiflowbridge/config.ts`           | `vscode.workspace.getConfiguration`                                                          |
| `src/aiflowbridge/api-key-resolver.ts` | `vscode.SecretStorage`                                                                       |
| `src/runtime/lifecycle.ts`             | Point d'entrée extension - à conserver tel quel, injecte l'adapter VS Code                   |
| `src/aiflowbridge/gateway/lock.ts`     | Aucun - 100 % Node.js natif ✓                                                                |
| `src/aiflowbridge/gateway/probe.ts`    | Aucun - 100 % Node.js natif ✓                                                                |
| `src/aiflowbridge/gateway/server.ts`   | Aucun - 100 % Node.js natif ✓                                                                |
| `src/aiflowbridge/telemetry/`          | Aucun - 100 % Node.js natif ✓                                                                |

La bonne nouvelle : `server.ts`, `lock.ts`, `probe.ts` et la couche telemetry sont **déjà purs Node.js**. Le refactoring se concentre sur l'injection de dépendances dans `index.ts` et `config.ts`.

---

### Étapes

Toutes les cases ci-dessous sont cochées dans la version 1.7.0 (591 tests, 29 fichiers).

#### Étape 1 - Introduire `IGatewayContext` pour abstraire `vscode.ExtensionContext`

- [x] Créer l'interface `IGatewayContext` dans `src/aiflowbridge/types.ts` :

  ```typescript
  export interface IGatewayContext {
    /** Résolution des clés API par vendor id */
    secrets: {
      get(key: string): Promise<string | undefined>;
      store(key: string, value: string): Promise<void>;
      delete(key: string): Promise<void>;
    };
    /** Dossier de stockage persistant (équivalent globalStorageUri.fsPath) */
    globalStorageDir: string;
    /** Version de l'extension/binaire */
    extensionVersion: string;
    /** Abonnement aux changements de configuration (optionnel en mode standalone) */
    onConfigChange?: (cb: () => void) => Disposable;
    /** Lecture de la configuration brute (section "aiflowbridge") */
    getConfiguration(): RawAiFlowBridgeConfig;
  }

  export interface Disposable {
    dispose(): void;
  }
  ```

- [x] Modifier `AIFlowBridgeRuntime` (`src/aiflowbridge/index.ts`) :
  - Remplacer le paramètre `context: vscode.ExtensionContext` par `context: IGatewayContext`.
  - Remplacer tous les accès `context.secrets`, `context.globalState`, `context.globalStorageUri.fsPath`, `context.extension.packageJSON.version` par les méthodes de `IGatewayContext`.
  - Retirer tous les `import * as vscode from 'vscode'` de ce fichier.

- [x] Créer `src/aiflowbridge/config.ts` adapter :
  - Extraire la lecture de config depuis `vscode.workspace.getConfiguration` dans une fonction `loadConfigFromContext(ctx: IGatewayContext)`.
  - Le reste de `config.ts` (synthesis, validation) reste inchangé.

- [x] Valider : `npm run compile` sans erreurs, `npm test` tous les tests passent.

#### Étape 2 - Créer l'adapter VS Code `src/aiflowbridge/vscode-context-adapter.ts`

- [x] Implémenter `IGatewayContext` en wrappant `vscode.ExtensionContext` :

  ```typescript
  import * as vscode from "vscode";
  import type { IGatewayContext } from "./types";

  export function createVSCodeContext(ctx: vscode.ExtensionContext): IGatewayContext {
    return {
      secrets: {
        get: (key) => ctx.secrets.get(key),
        store: (key, value) => ctx.secrets.store(key, value),
        delete: (key) => ctx.secrets.delete(key),
      },
      globalStorageDir: ctx.globalStorageUri.fsPath,
      extensionVersion: ctx.extension.packageJSON.version ?? "0.0.0",
      onConfigChange: (cb) => {
        const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration("aiflowbridge")) cb();
        });
        return { dispose: () => disposable.dispose() };
      },
      getConfiguration: () => vscode.workspace.getConfiguration("aiflowbridge") as unknown as RawAiFlowBridgeConfig,
    };
  }
  ```

- [x] Mettre à jour `src/runtime/lifecycle.ts` pour utiliser `createVSCodeContext(context)` avant d'appeler `activateAIFlowBridge`.

#### Étape 3 - Créer l'adapter standalone `src/standalone/context.ts`

- [x] Implémenter `IGatewayContext` sans aucune dépendance `vscode` :

  **Résolution des secrets (clés API) :**
  - Source 1 (prioritaire) : variables d'environnement `AIFLOWBRIDGE_<VENDOR>_API_KEY`
    (ex. `AIFLOWBRIDGE_DEEPSEEK_API_KEY`, `AIFLOWBRIDGE_MINIMAX_API_KEY`, `AIFLOWBRIDGE_XIAOMI_API_KEY`).
  - Source 2 (fallback) : fichier `~/.aiflowbridge/secrets.json` - format :
  -

    ```json
    {
      "deepseek.apiKey": "sk-...",
      "minimax.apiKey": "...",
      "xiaomi.apiKey": "..."
    }
    ```

    Permissions recommandées : `chmod 600` (documenter dans README/docs).
  - `store()` et `delete()` écrivent dans le fichier JSON (pas de support env vars en écriture).

  **globalStorageDir :** `~/.aiflowbridge/` (créé récursivement si absent via `fs.mkdirSync(..., { recursive: true })`).
  **extensionVersion :** lue depuis `package.json` à la racine du projet au démarrage.
  **onConfigChange :** watcher `fs.watch` sur `~/.aiflowbridge/config.json`.
  **getConfiguration :** lit et parse `~/.aiflowbridge/config.json` (format JSON identique aux settings VS Code, section `aiflowbridge`). Si le fichier est absent, retourne la config par défaut.

#### Étape 4 - Créer `src/standalone/config-loader.ts`

- [x] Lire la configuration standalone depuis `~/.aiflowbridge/config.json` :
  - Même structure que le `package.json` `contributes.configuration` (section `aiflowbridge`).
  - Fournir des valeurs par défaut identiques à l'extension VS Code.
  - Logger un avertissement si le fichier est absent (utiliser les defaults silencieusement).

- [x] Créer `docs/standalone-config.example.json` : fichier d'exemple commenté avec toutes les clés disponibles (port, providers, gateway.enabled, etc.).

#### Étape 5 - Créer l'entrypoint CLI `src/standalone/main.ts`

- [x] Instancier et démarrer le runtime :

  ```typescript
  import { AIFlowBridgeRuntime } from "../aiflowbridge";
  import { createStandaloneContext } from "./context";

  async function main() {
    const ctx = await createStandaloneContext();
    const runtime = new AIFlowBridgeRuntime(ctx);
    await runtime.activate();

    process.on("SIGINT", () => runtime.deactivate().then(() => process.exit(0)));
    process.on("SIGTERM", () => runtime.deactivate().then(() => process.exit(0)));
  }

  main().catch((err) => {
    console.error("[AIFlowBridge standalone] Fatal:", err);
    process.exit(1);
  });
  ```

- [x] Logger dans `stdout`/`stderr` uniquement (pas de `vscode.window.showXxx`).
- [x] Utiliser le **même lock path** que l'extension VS Code :
  - Lock path = `~/.aiflowbridge/gateway.lock`
  - → Un seul gateway tourne à la fois, quel que soit le lanceur.
  - Si le lock est tenu par une autre instance (VS Code ou standalone), le process s'arrête proprement avec un message indiquant l'URL du gateway actif.

#### Étape 6 - Configurer le build standalone dans `package.json` / `tsconfig`

- [x] Ajouter `tsconfig.standalone.json` :

  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "types": ["node"],
      "outDir": "dist/standalone"
    },
    "include": ["src/standalone/**/*", "src/aiflowbridge/**/*", "src/logger.ts", "src/config.ts", "src/consts.ts", "src/types.ts", "src/json.ts"],
    "exclude": ["src/runtime/**/*", "src/client/**/*", "src/provider/**/*", "src/extension.ts", "src/auth.ts"]
  }
  ```

- [x] Ajouter dans `package.json` :

  ```json
  "bin": {
    "aiflowbridge-server": "./dist/standalone/main.js"
  },
  "scripts": {
    "build:standalone": "tsc -p tsconfig.standalone.json",
    "start:standalone": "node dist/standalone/main.js"
  }
  ```

- [x] Mettre à jour `.vscodeignore` pour exclure `dist/standalone/` et `src/standalone/` du packaging VSIX.

#### Étape 7 - Modifier l'extension VS Code pour afficher le mode "joined"

- [x] Dans `src/runtime/lifecycle.ts` : si le lock est déjà tenu **et** que le port répond (probe réussi), l'extension passe en mode "joined" :
  - Elle **ne démarre pas** son propre gateway.
  - Elle affiche dans la status bar : `AIFlowBridge ↗ external` (ou similaire) avec l'URL du gateway actif.
- [x] Dans `StatusBarController` (`src/aiflowbridge/ui/statusbar.ts`) : ajouter un état `joined` avec tooltip `Gateway running externally (standalone mode) - http://127.0.0.1:<port>/v1`.
- [x] Ajouter la commande `aiflowbridge.joinExternalGateway` : force manuellement le mode "joined" si l'utilisateur veut déléguer à un gateway standalone déjà lancé.

> **Note :** la logique `ownsGatewayLock` est déjà en place dans `lifecycle.ts` - cette étape est essentiellement du wiring UI + une commande supplémentaire.

#### Étape 8 - Documentation autostart OS

- [x] Créer `docs/autostart/` avec des templates prêts à l'emploi :

  **Linux (`systemd --user`) - `~/.config/systemd/user/aiflowbridge.service` :**

  ```ini
  [Unit]
  Description=AIFlowBridge Standalone Gateway
  After=network.target

  [Service]
  Type=simple
  ExecStart=/usr/bin/node /path/to/dist/standalone/main.js
  Restart=on-failure
  Environment=AIFLOWBRIDGE_DEEPSEEK_API_KEY=sk-...
  Environment=AIFLOWBRIDGE_MINIMAX_API_KEY=...

  [Install]
  WantedBy=default.target
  ```

  Commandes : `systemctl --user enable aiflowbridge && systemctl --user start aiflowbridge`

  **Windows (Task Scheduler) :** script PowerShell dans `docs/autostart/windows-task.ps1`.
  **macOS (launchd) - `~/Library/LaunchAgents/com.aiflowbridge.server.plist` :**

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>com.aiflowbridge.server</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/node</string>
      <string>/path/to/dist/standalone/main.js</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>EnvironmentVariables</key>
    <dict>
      <key>AIFLOWBRIDGE_DEEPSEEK_API_KEY</key><string>sk-...</string>
      <key>AIFLOWBRIDGE_MINIMAX_API_KEY</key><string>...</string>
    </dict>
  </dict>
  </plist>
  ```

#### Étape 9 - Documentation Continue/JetBrains

- [x] Ajouter `docs/jetbrains-continue.md` : guide complet pour connecter Continue (plugin JetBrains) au gateway standalone :

  ```yaml
  # ~/.continue/config.yaml
  name: AIFlowBridge Standalone
  version: 1.0.0
  models:
    - name: DeepSeek V4 Pro (AIFlowBridge)
      provider: openai
      model: deepseek-v4-pro
      apiBase: http://127.0.0.1:8787/v1
      apiKey: standalone
      roles: [chat, edit, apply]
    - name: MiniMax M3 (AIFlowBridge)
      provider: openai
      model: minimax-m3
      apiBase: http://127.0.0.1:8787/v1
      apiKey: standalone
      roles: [chat, edit, apply]
    - name: MiMo V2 (AIFlowBridge)
      provider: openai
      model: mimo-v2.5-pro
      apiBase: http://127.0.0.1:8787/v1
      apiKey: standalone
      roles: [chat, edit, apply]
  ```

> `apiKey` peut être n'importe quelle chaîne non-vide : le gateway valide les vraies clés côté upstream, pas dans le header Authorization entrant.

- [ ] Ajouter une section "JetBrains AI Assistant custom endpoint" :
      `Settings → Tools → AI Assistant → Use third-party/local models → OpenAI API Compatible`
      URL : `http://127.0.0.1:8787/v1`, API Key : `standalone`, Model : `deepseek-v4-pro` (ou tout autre modèle listé dans `GET /v1/models`).

#### Étape 10 - Tests et intégration continue

- [x] Ajouter `tests/standalone/context.test.ts` : tests unitaires de `createStandaloneContext` (résolution secrets via env vars, via fichier JSON, fallback defaults).
- [x] Ajouter `tests/standalone/config-loader.test.ts` : lecture config JSON, valeurs par défaut, fichier absent.
- [ ] Ajouter un test d'intégration `tests/standalone/e2e.test.ts` : lance le process standalone, vérifie `GET /health` et `GET /v1/models`, puis coupe via SIGTERM. _(Suivi séparé - le smoke test existant couvre les chemins critiques sans lancer un second process Node.)_
- [x] S'assurer que `npm test` (qui couvre les tests existants) continue à passer sans modification.

---

### Fichiers impactés

| Fichier                                      | Modification                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/aiflowbridge/types.ts`                  | + interface `IGatewayContext`, `Disposable`                                                 |
| `src/aiflowbridge/index.ts`                  | Injection `IGatewayContext` au lieu de `vscode.ExtensionContext`; suppression import vscode |
| `src/aiflowbridge/config.ts`                 | Source de config abstraite via `IGatewayContext.getConfiguration()`                         |
| `src/aiflowbridge/api-key-resolver.ts`       | Utiliser `IGatewayContext.secrets` au lieu de `vscode.SecretStorage`                        |
| `src/aiflowbridge/vscode-context-adapter.ts` | **nouveau** - wrapper VS Code → IGatewayContext                                             |
| `src/runtime/lifecycle.ts`                   | Injecter `createVSCodeContext(context)`                                                     |
| `src/aiflowbridge/ui/statusbar.ts`           | + état `joined` (external gateway)                                                          |
| `src/standalone/context.ts`                  | **nouveau** - adapter standalone                                                            |
| `src/standalone/config-loader.ts`            | **nouveau** - lecture config JSON                                                           |
| `src/standalone/main.ts`                     | **nouveau** - entrypoint CLI                                                                |
| `tsconfig.standalone.json`                   | **nouveau**                                                                                 |
| `package.json`                               | + `bin`, + `build:standalone`, + `start:standalone`                                         |
| `.vscodeignore`                              | + exclure `dist/standalone/`, `src/standalone/`                                             |
| `docs/standalone-config.example.json`        | **nouveau**                                                                                 |
| `docs/autostart/`                            | **nouveau** - templates systemd / launchd / Task Scheduler                                  |
| `docs/jetbrains-continue.md`                 | **nouveau**                                                                                 |
| `_helpers/ACTION PLAN.md`                    | ce document                                                                                 |
| `TODO.md`                                    | + FEAT7 standalone gateway                                                                  |

### Risques / points d'attention

- **Secrets hors VS Code Secret Store** : le fichier `~/.aiflowbridge/secrets.json` doit être documenté comme sensible. Recommander `chmod 600` sur Linux/macOS. Alternative plus sûre : utiliser uniquement les variables d'environnement et documenter un `.env` local chargé au démarrage du service.
- **Telemetry partagée** : avec `globalStorageDir = ~/.aiflowbridge/`, les métriques sont partagées entre VS Code et le mode standalone. C'est le comportement souhaitable (métriques consolidées), mais il faut s'assurer que le `TelemetryPersister` (qui utilise déjà un lock fichier) gère correctement la concurrence standalone + VS Code.
- **Mise à jour de config à chaud** : en mode standalone, le watcher `fs.watch` sur `config.json` doit déclencher `reloadConfiguration()` sans redémarrer le process. La méthode existe déjà dans `AIFlowBridgeRuntime` - il suffit de la brancher sur le watcher.
- **Windows** : `fs.watch` est moins fiable que sur Linux/macOS pour détecter les modifications de fichier. Prévoir un polling de fallback (interval 5s) si le watcher ne déclenche pas.
- **VSIX packaging** : s'assurer que `dist/standalone/` et les dépendances standalone ne gonflent pas le bundle VSIX. Le `.vscodeignore` doit explicitement les exclure.

---

## FEAT7 follow-up: corrections post-audit (branche `fix/feat7-audit-followup`)

> **Date** : 2026-07-08
> **Pré-requis** : ce qui est coché ci-dessous a été implémenté dans 3 commits au-dessus de `adb793b` (cf. `_helpers/docs/audits/action Plan_synthese_by M3.md`).
> **Quality gates actuels** : `npm test` 594/594, `npm run compile` 0 erreur, `npm run compile:standalone` 0 erreur.

### Régressions UX corrigées (consensus 4/4 LLM)

- [x] **R-01** `resetMetrics` exige une confirmation modale via `ctx.confirm` (`src/aiflowbridge/index.ts:211-232`).
- [x] **R-02** `copyGatewayUrl` écrit dans le presse-papier via `ctx.clipboardWrite` (`src/aiflowbridge/index.ts:271-285`).
- [x] **R-03** `openSettings` ouvre la page settings VS Code via `ctx.openSettings` (`src/aiflowbridge/index.ts:287-296`).
- [x] **R-04** `aiflowbridge.setVisionModel` réenregistré comme alias vers `aiflowbridge.providers.deepseek.setVisionModel` (`src/aiflowbridge/index.ts:298-304`).
- [x] Hooks `confirm` / `clipboardWrite` / `openSettings` / `executeCommand` ajoutés à `IGatewayContext` (`src/aiflowbridge/types.ts:127-144`) et implémentés dans `createVSCodeContext` (`src/aiflowbridge/vscode-context-adapter.ts:149-172`).

### Bugs de comportement corrigés (consensus 2-3/4 LLM)

- [x] **B-01** Migration legacy `globalState` → fichier de persistance réintroduite (`src/aiflowbridge/index.ts:29-92` + `GlobalStateLike` interface).
- [x] **B-02** Tier workspace fonctionne à nouveau : `createVSCodeContext(context)` est appelé AVANT `loadModelRegistry(ctx)` dans `src/runtime/lifecycle.ts:54-60`.
- [x] **B-03** `StandaloneConfigFile` (exportée, testée) alignée avec le runtime : `StandaloneConfigReader` interne supprimé, fallback `DEFAULT_STANDALONE_CONFIG` actif en standalone (`src/standalone/context.ts:223`).
- [x] **B-04** `subscriptionsBag` est un vrai `Array` via `Proxy` qui forward `push` vers `context.subscriptions` ; `length`/`forEach`/`filter`/`map` fonctionnels (`src/aiflowbridge/vscode-context-adapter.ts:101-114`).

### Sécurité pré-Action-Plan (audit `AUDIT_2026_07_08.md`)

- [x] **BUG-A05** (HIGH) `stop()` draine les keep-alive : `closeAllConnections?.()` + fallback `Set<Socket>` + `socket.destroy()` (`src/aiflowbridge/gateway/server.ts:319-353`).
- [x] **BUG-A01** (HIGH) `removeEntry` ne désynchronise plus `durations`/`recent` : p95 recalculé depuis `recent` + `p95Cache` invalidé à chaque mutation (`src/aiflowbridge/telemetry.ts:194-205, 222-225, 260-264, 288-340`).
- [x] **BUG-A02** (MEDIUM) `durationMs` streaming capturé sur `response.once('finish', ...)` (`src/aiflowbridge/gateway/server.ts:669-684`).
- [x] **BUG-A04** (LOW) `isPortInUse` : handler `settled` partagé + `setTimeout(0)` défensif (`src/aiflowbridge/gateway/probe.ts:184-206`).
- [x] **WARN-B01** (MEDIUM) `recent` borné en mémoire via `memoryCap` configurable (défaut 10 000) (`src/aiflowbridge/telemetry.ts:170-220, 261`).
- [x] **WARN-B02** (LOW) Clé API strippée du corps 502 via `sanitizeUpstreamErrorMessage()` (`src/aiflowbridge/gateway/server.ts:729-737, 820-845`).
- [x] **WARN-B03** (LOW) `selectProvider` utilise `localeCompare(..., { sensitivity: 'base' })` (`src/aiflowbridge/providers.ts:163-176`).
- [x] **WARN-B04** (LOW) `probeServerVersion` valide `content-length` ≤ 4 KiB avant parse (`src/aiflowbridge/gateway/probe.ts:50-77, 91`).
- [x] **WARN-B07** (LOW) `dispose()` idempotente documentée (`src/aiflowbridge/gateway/server.ts:355-361`).

### Améliorations

- [x] **IMPROV-C01** `percentile()` : cache `p95Cache` invalidé à chaque mutation.
- [x] **IMPROV-C02** `clearTimeout` appelé dans abort handler + finally (`src/aiflowbridge/token-counter.ts:50-75`).
- [x] **IMPROV-C03** `created = 0` constant dans `buildModelCatalog` (`src/aiflowbridge/providers.ts:195-200`).
- [x] **IMPROV-C05** `probeServerVersionWithRetry()` 500 ms + 1 retry 100 ms (`src/aiflowbridge/gateway/server.ts:407, 810-818`).
- [x] **IMPROV-C06** `reloadConfiguration` ne redémarre le gateway que si `event.affectsGateway` (`src/aiflowbridge/index.ts:325-342`).
- [x] **IMPROV-C07** Warning si `baseUrl` finit par `/v1` (`src/aiflowbridge/config.ts:290-307`).

### Convention, sécurité mineure, documentation

- [x] **C-01** em-dash `statusbar.ts:29` remplacé par ASCII `-` (vérifié 0 em/en-dash dans `src/`).
- [x] **C-02** cast `as unknown as vscode.ExtensionContext` supprimé dans `config.ts:269`.
- [x] **C-03** `void context;` supprimé dans `config.ts`.
- [x] **C-04** branche `legacy` redondante supprimée dans `modelRegistry.ts:93-98`.
- [x] **C-06** `getNestedValue` extrait dans `src/standalone/util.ts` (nouveau).
- [x] **C-07** commentaire `config.ts:290-297` corrigé (le shim standalone lit `userModels` depuis `config.json`).
- [x] **C-08** wrapper mort `loadConfig(context)` supprimé.
- [x] **S-01** `require(package.json)` remplacé par `readFileSync` + `JSON.parse` dans `src/standalone/main.ts:71-83`.
- [x] **S-02** Section "Security" dans `docs/standalone.md` documentant la limitation Windows ACL.
- [x] **S-03** `resolveVendorApiKey` accepte `ResolveSecretSource = SecretStorageLike | SecretsLike` (`src/aiflowbridge/api-key-resolver.ts:23-50`).
- [x] **D-02** Section "Known issues / breaking changes in 2.0.0" dans `TODO.md:81-90` listant les 6 items.

### Tests

- [x] 3 nouveaux tests dans `tests/telemetry-store.test.ts` (BUG-A01 : `computes p95 from the recent list` + `rebuilds the p95 cache after restore()` ; WARN-B01 : `drops the oldest entries from recent once memoryCap is reached`).
- [x] Total : 594/594 passants (vs 591 baseline).

### Reste à faire (cf. `_helpers/docs/audits/action Plan_synthese_by M3.md` section 7)

#### Mineurs (sécurité + audit) - ~5h30

- [ ] **BUG-A03** `gateway/server.ts` `readBody()` : retirer le handler `'error'` post-settle pour éviter un `UnhandledPromiseRejection` tardif.
- [ ] **WARN-B05** `gateway/server.ts` `translatePayloadForUpstream()` : logger la traduction `reasoning_effort` → `reasoning_split` au niveau debug.
- [ ] **WARN-B06** `config.ts` : introduire un type `SensitiveString` ou un `toJSON()` redacted sur `ProviderProfile.apiKey`.
- [ ] **IMPROV-C04** `gateway/server.ts` : ajouter un `inFlightRequests` concurrency limit configurable via `aiflowbridge.gateway.maxConcurrentRequests` ; retourner `429` au-delà.

#### Convention (1 item partiel) - 30min

- [ ] **C-05** `modelRegistry.ts` : `RegistrySources.{bundled,globalStorage,workspace}.path` doit utiliser `uri.toString()` (et non `fsPath`) pour le dashboard et les logs ; vérifier la compatibilité avec `tests/modelRegistry.test.ts`.

#### Tests dédiés (Phase 8 du plan initial) - ~2h

- [ ] `tests/commands-ux.test.ts` : couvre R-01..R-04 avec un `IGatewayContext` mock.
- [ ] `tests/telemetry-drain.test.ts` : couvre BUG-A05 avec un client HTTP en streaming.
- [ ] `tests/migration-legacy.test.ts` : couvre B-01 (migration `globalState` → fichier) avec un `IGatewayContext` mock pré-rempli.
- [ ] `tests/subscriptions-bag.test.ts` : couvre B-04 (Proxy `subscriptionsBag`).
- [ ] Compléter `tests/telemetry-store.test.ts` pour `removeEntry` direct (au-delà de `restore()`).

#### Hardening optionnel - ~1h

- [ ] Ajouter `aiflowbridge.gateway.probeTimeoutMs` à `package.json#contributes.configuration` (actuellement hardcodé à 500 ms dans `probeServerVersionWithRetry`).
- [ ] Ajouter `aiflowbridge.gateway.maxConcurrentRequests` à `package.json#contributes.configuration` (cf. IMPROV-C04 ci-dessus).

#### Squash optionnel - 5min

- [ ] Squash les 3 commits `a1492ef` + `dd59629` + `846f468` en un seul commit `fix(feat7): audit follow-up - UX commands, security, behavior bugs` avant merge.

---

## Légende statuts

- `[x]` = implémenté, testé, documenté.
- `[ ]` = reste à faire (voir section "Reste à faire" ci-dessus pour le détail).
