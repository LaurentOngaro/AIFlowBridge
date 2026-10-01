# ACTION_PLAN.md - File d'attente opérationnelle du projet

> File d'attente opérationnelle du projet. `BRAIN.md` garde la mémoire long
> terme ; ce fichier porte les **actions courtes et leur suivi**.

## Protocole d'échange

1. **Tout agent lit `BRAIN.md` puis ce fichier en début de session.**
2. Chaque action a : un ID (`AP-NNN`), un responsable, un statut, des notes.
3. Responsables : `Agent IA` (conception, code, tests, build, docs, branches) et
   `Utilisateur` (décideur). L'exécution est mono-agent depuis le 2026-10-01.
4. Statuts : `à faire` -> `en cours` -> `fait` | `bloqué`.
5. En terminant une action : cocher, dater, noter le résultat (commit, erreur
   assainie, constat) et ajouter une entrée au journal de `BRAIN.md`.
6. **Question ou arbitrage** -> section « Questions / Blocages », rédigée avec
   assez de contexte pour être tranchable sans rouvrir le dépôt.

---

## À faire

| ID     | Action                                                                                                                                                                        | Responsable            | Statut  | Notes                                                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-013 | Intégration Copilot Chat ultérieure : intégrer tous les modèles AIFlowBridge (si pas déjà le cas) + Gemini via Google AI Studio dans le sélecteur `LanguageModelChatProvider` | Agent IA + Utilisateur | à faire | inchangé : le picker Copilot reste DeepSeek / MiniMax / Xiaomi. La 2.19.0 ajoute GLM 5.3 et Kimi K3 en passerelle seule, ce qui ne clôt pas AP-013. La promotion Path B vers Path A (picker + classe provider) est le suivi naturel |

## Questions / Blocages

*Aucun blocage actif.*

## En cours

## Fait

| ID     | Action                                                                                                                 | Date       | Résultat                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AP-013 | Intégration Copilot Chat ultérieure (Gemini, GLM, Kimi dans le picker `LanguageModelChatProvider`)                     | 2026-10-01 | Reporté : la 2.19.0 livre GLM 5.3 et Kimi K3 en Path B (passerelle seule), pas en Path A. Le picker reste DeepSeek / MiniMax / Xiaomi.                                               |
| AP-014 | Rafraîchissement du catalogue de modèles                                                                               | 2026-10-01 | 2.19.0 livrée : 21 -> 38 entrées, 6 legacy MiniMax purgés, 4 ids OpenRouter free sortis du tier purgés, 15 free reconstruits sur l'API publique                                      |
| AP-015 | Ajout des vendors passerelle seule `zai` + `moonshot`                                                                  | 2026-10-01 | 2.19.0 livrée : GLM 5.3 / 5.3 Flash / 5.3 FlashX et Kimi K3 / K2.7 Code / K2.7 Code Highspeed / K2.6, avec clés, settings et commandes                                               |
| AP-016 | Worktree V2, bump mineur 2.19.0, changelog Keep-a-Changelog et actualisation complète README / documentation           | 2026-10-01 | Fait : worktree `.kilo/worktree/model-catalog-refresh-V2`, bump 2.19.0 consolidé, CHANGELOG restructuré, README et 11 docs actualisés, 73 suites de tests vertes, VSIX prêt          |
| AP-017 | Documentation mono-agent : suppression de toute référence à Perplexity                                                 | 2026-10-01 | Fait : `.kilocode/rules/00-brain-protocol.md`, `ACTION_PLAN.md`, `BRAIN.md`, `docs/plans/antigravity-gateway-integration-spec.md` réécrits en mono-agent                             |
| AP-018 | Fix Xiaomi MiMo : auto-routage des clés Pay-as-you-go sk-* vs Token Plan tp-* sur la passerelle et le provider Copilot | 2026-10-01 | Auto-routage intelligent par préfixe de clé (`sk-*` vers `api.xiaomimimo.com`, `tp-*` vers `token-plan-ams.xiaomimimo.com`). Résout l'erreur 401 sur les clés pay-as-you-go standard |
| AP-019 | Bump version patch 2.19.1 et actualisation du CHANGELOG.md                                                             | 2026-10-01 | Version portée à 2.19.1 (`package.json`, `package-lock.json`), CHANGELOG.md complété avec section 2.19.1 Keep-a-Changelog                                                            |
| AP-020 | Règle formelle interdisant tout commit automatique par les agents IA                                                   | 2026-10-01 | Instructions mises à jour dans `AGENTS.md`, `docs/agent-instructions/tasks.md`, `.kilocode/rules/00-brain-protocol.md`, `BRAIN.md` : commit interdit sans demande explicite          |
| AP-022 | Audit de `main` post-fusion : fix test instable, clés i18n manquantes, ancre morte, ménage Git, bump 2.19.2 | Kilo | fait | 2026-10-01. Test `gateway-antigravity` déliéflé (`port: 0` + relecture de `config.gateway.port`), 3 clés `vision.configured*` ajoutées à `src/i18n.ts`, garde-fou `tests/i18n.test.ts` (7 tests) créé, 2 ancres `#workspace-context` corrigées, 6 worktrees périmés + 3 branches + 1 stash supprimés. Deux éléments apprenant uniquement sur `feat/model-catalog-refresh-2` (distinction Path A / Path B dans `AGENTS.md`, section README « Gateway-only vendors ») rapatriés avant suppression. **Non commité** : règle « aucun commit automatique » |
| AP-021 | Clôture et nettoyage des questions/blocages de l'ACTION_PLAN                                                           | 2026-10-01 | Z.ai validé en prod, release 2.19.0/2.19.1 actée, MiMo validé avec sk-*, MiniMax M3.1 documenté sans pricing                                                                         |
