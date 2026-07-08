# ACTION PLAN

This document details the steps to implement some of the features and fixes listed in `TODO.md`. It completes the `TODO.md` file by adding the necessary technical details.

---

## Follow-up agreement

Each completed edit:

- Check the box in this document (go from `[ ]` to `[x]`)
- Update the status in `TODO.md` if a section references it
- Keep the history of this document (do not delete completed sections)

---

## FEAT-STANDALONE: Standalone Gateway — serveur indépendant de VS Code

### Objectif

Permettre au gateway AIFlowBridge de fonctionner sans que VS Code soit ouvert, afin qu'il puisse être consommé par n'importe quel client OpenAI-compatible (Continue/JetBrains, Kilo Code, JetBrains AI Assistant, curl, etc.).

### Contexte / motivation

Actuellement, le `GatewayService` est lancé dans l'extension host VS Code et s'arrête dès que VS Code est fermé. Pour utiliser le gateway depuis JetBrains (via le plugin Continue ou le custom endpoint de JetBrains AI Assistant), il faut que VS Code tourne en parallèle — ce qui est contraignant.

L'objectif est de permettre de lancer le gateway comme un **process Node.js autonome** (service OS, script shell, démarrage automatique au login), tout en conservant le comportement singleton existant : si VS Code est ouvert **et** que le standalone tourne déjà, VS Code « rejoint » le gateway existant au lieu d'en créer un second (la logique `lock.ts` + `probe.ts` est déjà prête pour ça).

### Architecture cible

```
Avant :  [VS Code Extension] → owns → [GatewayService]

Après :  [standalone node process] → owns  → [GatewayService]
         [VS Code Extension]        → joins → [GatewayService] (probe/lock)
         [JetBrains / Kilo / curl]  → calls → [GatewayService] (HTTP OpenAI-compatible)
```

### Analyse du code existant (points de couplage vscode)

| Fichier | Couplage vscode à abstraire |
|---|---|
| `src/aiflowbridge/index.ts` | `vscode.ExtensionContext` : secrets, globalState, globalStorageUri, onDidChangeConfiguration |
| `src/aiflowbridge/config.ts` | `vscode.workspace.getConfiguration` |
| `src/aiflowbridge/api-key-resolver.ts` | `vscode.SecretStorage` |
| `src/runtime/lifecycle.ts` | Point d'entrée extension — à conserver tel quel, injecte l'adapter VS Code |
| `src/aiflowbridge/gateway/lock.ts` | Aucun — 100 % Node.js natif ✓ |
| `src/aiflowbridge/gateway/probe.ts` | Aucun — 100 % Node.js natif ✓ |
| `src/aiflowbridge/gateway/server.ts` | Aucun — 100 % Node.js natif ✓ |
| `src/aiflowbridge/telemetry/` | Aucun — 100 % Node.js natif ✓ |

La bonne nouvelle : `server.ts`, `lock.ts`, `probe.ts` et la couche telemetry sont **déjà purs Node.js**. Le refactoring se concentre sur l'injection de dépendances dans `index.ts` et `config.ts`.

---

### Étapes

#### Étape 1 — Introduire `IGatewayContext` pour abstraire `vscode.ExtensionContext`

- [ ] Créer l'interface `IGatewayContext` dans `src/aiflowbridge/types.ts` :

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

  export interface Disposable { dispose(): void; }
  ```

- [ ] Modifier `AIFlowBridgeRuntime` (`src/aiflowbridge/index.ts`) :
  - Remplacer le paramètre `context: vscode.ExtensionContext` par `context: IGatewayContext`.
  - Remplacer tous les accès `context.secrets`, `context.globalState`, `context.globalStorageUri.fsPath`, `context.extension.packageJSON.version` par les méthodes de `IGatewayContext`.
  - Retirer tous les `import * as vscode from 'vscode'` de ce fichier.

- [ ] Créer `src/aiflowbridge/config.ts` adapter :
  - Extraire la lecture de config depuis `vscode.workspace.getConfiguration` dans une fonction `loadConfigFromContext(ctx: IGatewayContext)`.
  - Le reste de `config.ts` (synthesis, validation) reste inchangé.

- [ ] Valider : `npm run compile` sans erreurs, `npm test` tous les tests passent.

#### Étape 2 — Créer l'adapter VS Code `src/aiflowbridge/vscode-context-adapter.ts`

- [ ] Implémenter `IGatewayContext` en wrappant `vscode.ExtensionContext` :

  ```typescript
  import * as vscode from 'vscode';
  import type { IGatewayContext } from './types';

  export function createVSCodeContext(ctx: vscode.ExtensionContext): IGatewayContext {
    return {
      secrets: {
        get: (key) => ctx.secrets.get(key),
        store: (key, value) => ctx.secrets.store(key, value),
        delete: (key) => ctx.secrets.delete(key),
      },
      globalStorageDir: ctx.globalStorageUri.fsPath,
      extensionVersion: ctx.extension.packageJSON.version ?? '0.0.0',
      onConfigChange: (cb) => {
        const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration('aiflowbridge')) cb();
        });
        return { dispose: () => disposable.dispose() };
      },
      getConfiguration: () =>
        vscode.workspace.getConfiguration('aiflowbridge') as unknown as RawAiFlowBridgeConfig,
    };
  }
  ```

- [ ] Mettre à jour `src/runtime/lifecycle.ts` pour utiliser `createVSCodeContext(context)` avant d'appeler `activateAIFlowBridge`.

#### Étape 3 — Créer l'adapter standalone `src/standalone/context.ts`

- [ ] Implémenter `IGatewayContext` sans aucune dépendance `vscode` :

  **Résolution des secrets (clés API) :**
  - Source 1 (prioritaire) : variables d'environnement `AIFLOWBRIDGE_<VENDOR>_API_KEY`
    (ex. `AIFLOWBRIDGE_DEEPSEEK_API_KEY`, `AIFLOWBRIDGE_MINIMAX_API_KEY`, `AIFLOWBRIDGE_XIAOMI_API_KEY`).
  - Source 2 (fallback) : fichier `~/.aiflowbridge/secrets.json` — format :
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

#### Étape 4 — Créer `src/standalone/config-loader.ts`

- [ ] Lire la configuration standalone depuis `~/.aiflowbridge/config.json` :
  - Même structure que le `package.json` `contributes.configuration` (section `aiflowbridge`).
  - Fournir des valeurs par défaut identiques à l'extension VS Code.
  - Logger un avertissement si le fichier est absent (utiliser les defaults silencieusement).

- [ ] Créer `docs/standalone-config.example.json` : fichier d'exemple commenté avec toutes les clés disponibles (port, providers, gateway.enabled, etc.).

#### Étape 5 — Créer l'entrypoint CLI `src/standalone/main.ts`

- [ ] Instancier et démarrer le runtime :

  ```typescript
  import { AIFlowBridgeRuntime } from '../aiflowbridge';
  import { createStandaloneContext } from './context';

  async function main() {
    const ctx = await createStandaloneContext();
    const runtime = new AIFlowBridgeRuntime(ctx);
    await runtime.activate();

    process.on('SIGINT',  () => runtime.deactivate().then(() => process.exit(0)));
    process.on('SIGTERM', () => runtime.deactivate().then(() => process.exit(0)));
  }

  main().catch((err) => { console.error('[AIFlowBridge standalone] Fatal:', err); process.exit(1); });
  ```

- [ ] Logger dans `stdout`/`stderr` uniquement (pas de `vscode.window.showXxx`).
- [ ] Utiliser le **même lock path** que l'extension VS Code :
  - Lock path = `~/.aiflowbridge/gateway.lock`
  - → Un seul gateway tourne à la fois, quel que soit le lanceur.
  - Si le lock est tenu par une autre instance (VS Code ou standalone), le process s'arrête proprement avec un message indiquant l'URL du gateway actif.

#### Étape 6 — Configurer le build standalone dans `package.json` / `tsconfig`

- [ ] Ajouter `tsconfig.standalone.json` :

  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "types": ["node"],
      "outDir": "dist/standalone"
    },
    "include": [
      "src/standalone/**/*",
      "src/aiflowbridge/**/*",
      "src/logger.ts",
      "src/config.ts",
      "src/consts.ts",
      "src/types.ts",
      "src/json.ts"
    ],
    "exclude": [
      "src/runtime/**/*",
      "src/client/**/*",
      "src/provider/**/*",
      "src/extension.ts",
      "src/auth.ts"
    ]
  }
  ```

- [ ] Ajouter dans `package.json` :

  ```json
  "bin": {
    "aiflowbridge-server": "./dist/standalone/main.js"
  },
  "scripts": {
    "build:standalone": "tsc -p tsconfig.standalone.json",
    "start:standalone": "node dist/standalone/main.js"
  }
  ```

- [ ] Mettre à jour `.vscodeignore` pour exclure `dist/standalone/` et `src/standalone/` du packaging VSIX.

#### Étape 7 — Modifier l'extension VS Code pour afficher le mode "joined"

- [ ] Dans `src/runtime/lifecycle.ts` : si le lock est déjà tenu **et** que le port répond (probe réussi), l'extension passe en mode "joined" :
  - Elle **ne démarre pas** son propre gateway.
  - Elle affiche dans la status bar : `AIFlowBridge ↗ external` (ou similaire) avec l'URL du gateway actif.

- [ ] Dans `StatusBarController` (`src/aiflowbridge/ui/statusbar.ts`) : ajouter un état `joined` avec tooltip `Gateway running externally (standalone mode) — http://127.0.0.1:<port>/v1`.

- [ ] Ajouter la commande `aiflowbridge.joinExternalGateway` : force manuellement le mode "joined" si l'utilisateur veut déléguer à un gateway standalone déjà lancé.

  > **Note :** la logique `ownsGatewayLock` est déjà en place dans `lifecycle.ts` — cette étape est essentiellement du wiring UI + une commande supplémentaire.

#### Étape 8 — Documentation autostart OS

- [ ] Créer `docs/autostart/` avec des templates prêts à l'emploi :

  **Linux (`systemd --user`) — `~/.config/systemd/user/aiflowbridge.service` :**
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

  **macOS (launchd) — `~/Library/LaunchAgents/com.aiflowbridge.server.plist` :**
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

#### Étape 9 — Documentation Continue/JetBrains

- [ ] Ajouter `docs/jetbrains-continue.md` : guide complet pour connecter Continue (plugin JetBrains) au gateway standalone :

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

#### Étape 10 — Tests et intégration continue

- [ ] Ajouter `tests/standalone/context.test.ts` : tests unitaires de `createStandaloneContext` (résolution secrets via env vars, via fichier JSON, fallback defaults).
- [ ] Ajouter `tests/standalone/config-loader.test.ts` : lecture config JSON, valeurs par défaut, fichier absent.
- [ ] Ajouter un test d'intégration `tests/standalone/e2e.test.ts` : lance le process standalone, vérifie `GET /health` et `GET /v1/models`, puis coupe via SIGTERM.
- [ ] S'assurer que `npm test` (qui couvre les tests existants) continue à passer sans modification.

---

### Fichiers impactés

| Fichier | Modification |
|---|---|
| `src/aiflowbridge/types.ts` | + interface `IGatewayContext`, `Disposable` |
| `src/aiflowbridge/index.ts` | Injection `IGatewayContext` au lieu de `vscode.ExtensionContext`; suppression import vscode |
| `src/aiflowbridge/config.ts` | Source de config abstraite via `IGatewayContext.getConfiguration()` |
| `src/aiflowbridge/api-key-resolver.ts` | Utiliser `IGatewayContext.secrets` au lieu de `vscode.SecretStorage` |
| `src/aiflowbridge/vscode-context-adapter.ts` | **nouveau** — wrapper VS Code → IGatewayContext |
| `src/runtime/lifecycle.ts` | Injecter `createVSCodeContext(context)` |
| `src/aiflowbridge/ui/statusbar.ts` | + état `joined` (external gateway) |
| `src/standalone/context.ts` | **nouveau** — adapter standalone |
| `src/standalone/config-loader.ts` | **nouveau** — lecture config JSON |
| `src/standalone/main.ts` | **nouveau** — entrypoint CLI |
| `tsconfig.standalone.json` | **nouveau** |
| `package.json` | + `bin`, + `build:standalone`, + `start:standalone` |
| `.vscodeignore` | + exclure `dist/standalone/`, `src/standalone/` |
| `docs/standalone-config.example.json` | **nouveau** |
| `docs/autostart/` | **nouveau** — templates systemd / launchd / Task Scheduler |
| `docs/jetbrains-continue.md` | **nouveau** |
| `_helpers/ACTION PLAN.md` | ce document |
| `TODO.md` | + FEAT6 standalone gateway |

### Risques / points d'attention

- **Secrets hors VS Code Secret Store** : le fichier `~/.aiflowbridge/secrets.json` doit être documenté comme sensible. Recommander `chmod 600` sur Linux/macOS. Alternative plus sûre : utiliser uniquement les variables d'environnement et documenter un `.env` local chargé au démarrage du service.
- **Telemetry partagée** : avec `globalStorageDir = ~/.aiflowbridge/`, les métriques sont partagées entre VS Code et le mode standalone. C'est le comportement souhaitable (métriques consolidées), mais il faut s'assurer que le `TelemetryPersister` (qui utilise déjà un lock fichier) gère correctement la concurrence standalone + VS Code.
- **Mise à jour de config à chaud** : en mode standalone, le watcher `fs.watch` sur `config.json` doit déclencher `reloadConfiguration()` sans redémarrer le process. La méthode existe déjà dans `AIFlowBridgeRuntime` — il suffit de la brancher sur le watcher.
- **Windows** : `fs.watch` est moins fiable que sur Linux/macOS pour détecter les modifications de fichier. Prévoir un polling de fallback (interval 5s) si le watcher ne déclenche pas.
- **VSIX packaging** : s'assurer que `dist/standalone/` et les dépendances standalone ne gonflent pas le bundle VSIX. Le `.vscodeignore` doit explicitement les exclure.
