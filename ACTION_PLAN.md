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
| AP-013 | Intégration Copilot Chat ultérieure : intégrer tous les modèles AIFlowBridge (si pas déjà le cas) + Gemini via Google AI Studio dans le sélecteur `LanguageModelChatProvider` | Perplexity + Kilo | à faire | Prévu après la validation du MVP passerelle seule (décision utilisateur du 2026-09-03) |

## En cours

## Questions / Blocages

## Fait

| ID  | Action | Date | Résultat |
| --- | ------ | ---- | -------- |
