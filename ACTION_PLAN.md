# ACTION_PLAN.md — Zone d'échange Perplexity ↔ VS Code (Kilo)

> File d'attente opérationnelle du projet. `BRAIN.md` garde la mémoire long
> terme ; ce fichier porte les **actions courtes et leur suivi**.

## Protocole d'échange

1. **Tout agent lit `BRAIN.md` puis ce fichier en début de session.**
2. Chaque action a : un ID (`AP-NNN`), un responsable, un statut, des notes.
3. Responsables : `Perplexity` (tech lead via GitHub), `Kilo` (exécution
   locale, piloté par Utilisateur), `Utilisateur` (décideur).
4. Statuts : `à faire` → `en cours` → `fait` | `bloqué`.
5. En terminant une action : cocher, dater, noter le résultat (commit, erreur
   assainie, constat) et ajouter une entrée au journal de `BRAIN.md`.
6. **Blocage ou question pour l'autre agent** → section « Questions / Blocages ».
7. Répartition des capacités : Perplexity conçoit, code, audite (lecture par
   fragments via la recherche GitHub), gère branches/PR ; Kilo exécute
   localement (build, tests, scripts, OAuth réel) et remonte les résultats
   assainis ; Utilisateur arbitre.

---

## À faire

| ID     | Action                                                                                                                                                                        | Responsable       | Statut  | Notes                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- | -------------------------------------------------------------------------------------- |
| AP-013 | Intégration Copilot Chat ultérieure : intégrer tous les modèles AIFlowBridge (si pas déjà le cas) + Gemini via Google AI Studio dans le sélecteur `LanguageModelChatProvider` | Perplexity + Kilo | à faire | inchangé : le picker Copilot reste DeepSeek / MiniMax / Xiaomi. La 2.19.0 ajoute GLM 5.3 et Kimi K3 en passerelle seule, ce qui ne clôt pas AP-013. La promotion Path B vers Path A (picker + classe provider) est le suivi naturel |
| AP-014 | Rafraîchissement du catalogue de modèles (DeepSeek V4.1 Flash, MiniMax M3.1 Flash Preview, MiMo V2.6, GLM 5.3, Kimi K3, Gemini latest, OpenRouter free) | Kilo | fait | 2026-10-01, 2.19.0, branche `feat/model-catalog-refresh`, worktree `../AIFlowBridge-model-catalog-refresh`. Plan : `.kilo/plans/1790836404534-model-catalog-refresh.md`. 38 entrées bundleées (7 vendors avec modèles + `antigravity` sans modèle). Documentation finalisée : sections Z.ai et MoonshotAI dans `docs/providers.md`, tableau 15 modèles OpenRouter free, exemples standalone `secrets.json`, tests `api-key-resolver` complétés. Gate T0 **partiel** : OpenRouter vérifié sur l'API publique, Z.ai / MoonshotAI / DeepSeek / MiniMax sur la doc officielle, MiMo V2.6 et les alias `gemini-*-latest` non confirmés (pas de clé sur la machine). Détail et écarts dans le journal `BRAIN.md` du 2026-10-01 |
| AP-015 | Ajout des vendors passerelle seule `zai` + `moonshot` (Path B) | Kilo | fait | 2026-10-01, 2.19.0. 6 fichiers TS : `src/aiflowbridge/modelRegistry.schema.ts` (`KNOWN_FAMILIES`), `src/consts.ts` (`API_KEY_SECRETS`), `src/aiflowbridge/api-key-resolver.ts` (`VENDOR_ALIASES` `zai: ['zai','glm']` / `moonshot: ['moonshot','kimi']`), `src/aiflowbridge/api-key-sources.ts` (`SECRET_KEY_TO_ENV_NAME` + `SECRET_SHORT_TO_FULL`), `src/aiflowbridge/host-config.ts` (ancres `DEFAULT_GATEWAY_PROFILES`), `src/runtime/addCustomModel.ts` + `src/runtime/provider.ts` (helper `registerApiKeyCommands`) + `src/i18n.ts`. Plus `resources/models.json`, `resources/models.schema.json`, `package.json`, `package.nls.json`. Tests : `tests/integration/zai.smoke.test.ts`, `tests/integration/moonshot.smoke.test.ts` |

## Questions / Blocages

- **Kilo → Perplexity :** 5 ids du registry 2.19.0 sont déclarés mais **non confirmés** par le gate T0, faute de clé API sur cette machine : `mimo-v2.6-flash`, `mimo-v2.6-pro`, `mimo-v2.6-pro-ultraspeed`, `gemini-flash-latest`, `gemini-flash-lite-latest`. Un `curl` authentifié (`https://token-plan-ams.xiaomimimo.com/v1/models`, `https://generativelanguage.googleapis.com/v1beta/models`) permettrait de les trancher. En attendant, `modelIdOverrides` / `userModels` permettent de corriger un id sans réédition.
- **Kilo → Perplexity :** la base URL Z.ai est **ambiguë dans la doc officielle** (`api/paas/v4` dans les 3 exemples de code, `api/coding/paas/v4` dans le tableau "How to Use"). Le registry prend `paas`. À confirmer avec une clé pay-as-you-go ET une clé GLM Coding Plan.
- **Kilo → Perplexity :** version de release. Le plan laissait le choix patch / minor ouvert ; **2.19.0 minor** a été retenue parce que `deepseek-v4-flash` et `deepseek-pro` sortent du catalogue de la passerelle (503 pour les configs clientes qui les épinglent). À arbitrer par l'utilisateur.
- **Kilo → Perplexity :** `MiniMax-M3.1-Flash-Preview` est servi uniquement par M Plan / MiniMax Code et n'a aucun tarif pay-as-you-go publié. L'entrée est bundleée **sans pricing** ; une clé Token Plan legacy recevra un 403. Confirmer le type de clé MiniMax réellement utilisé avant de garder l'entrée.

## En cours

## Fait

| ID    | Action                                                                                                                                   | Date      | Résultat                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AP-013 | Intégration Copilot Chat ultérieure (Gemini, GLM, Kimi dans le picker `LanguageModelChatProvider`)                                              | 2026-10-01 | Reporté : la 2.19.0 livre GLM 5.3 et Kimi K3 en Path B (passerelle seule), pas en Path A. Le picker reste DeepSeek / MiniMax / Xiaomi. |
| AP-014 | Rafraîchissement du catalogue de modèles                                                                                                   | 2026-10-01 | 2.19.0 livrée : 21 -> 38 entrées, 6 legacy MiniMax purgés, 4 ids OpenRouter free sortis du tier purgés, 15 free reconstruits sur l'API publique |
| AP-016 | Fix Xiaomi MiMo : auto-routage des clés Pay-as-you-go sk-* vs Token Plan tp-* sur la passerelle et le provider Copilot | 2026-10-01 | Auto-routage intelligent par préfixe de clé (`sk-*` vers `api.xiaomimimo.com`, `tp-*` vers `token-plan-ams.xiaomimimo.com`). Résout l'erreur 401 sur les clés pay-as-you-go standard |

| AP-015 | Ajout des vendors passerelle seule `zai` + `moonshot`                                                                                        | 2026-10-01 | 2.19.0 livrée : GLM 5.3 / 5.3 Flash / 5.3 FlashX et Kimi K3 / K2.7 Code / K2.7 Code Highspeed / K2.6, avec clés, settings et commandes |
| AP-016 | Worktree V2, bump mineur 2.19.0, changelog Keep-a-Changelog et actualisation complète README / documentation                                | 2026-10-01 | Fait : worktree `.kilo/worktree/model-catalog-refresh-V2`, bump 2.19.0 consolidé, CHANGELOG restructuré, README et 11 docs actualisés, 73 suites de tests vertes, VSIX prêt |
