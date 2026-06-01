# TODOs

Suivi des bugs, améliorations et tickets en cours. Pour le plan détaillé de publication Marketplace, voir `_helpers/PLAN_ACTIONS.md`.

## Bugs (last:BUG02)

_Section en placeholder — aucun bug ouvert._

## Corrections immédiates (last:)

_Section en placeholder — aucune correction urgente._

## Améliorations du projet

Pour plus de détails sur l'implémentation de ces modifications, consulter le fichier `_helpers\PLAN_ACTIONS.md` qui détaille les étapes à suivre pour chaque tâche (si besoin).

### Priorités d'implémentation

classement des demandes par priorité de la plus urgente à la moins urgente:

- None

### Documentation (last:)

### Affichage (last:AFF02)

- [ ] AFF01: amélioration du dashboard
  - ajouter la date et l'heure dans chaque ligne de "Recent requests"
- [ ] AFF02: amélioration du dashboard
  - proposer des regroupements de statistiques dans le dashboard (ex: par modèle, par fournisseur, par période, date, etc.)
  - afficher des totaux globaux en fonction de ces filtres
  - proposer des filtres usuels pour les statistiques (ex: 7 derniers jours, 30 derniers jours, etc.)

### Features (last:)

### Refactoring (last:)

### API (last:)

### Performance (last:)

### Sécurité (last:)

### Intégration future (last:)

### Idées à creuser (last:) - utilité à questionner

## Terminés

- [x] BUG01: l'analyse d'image ne fonctionne pas dans le chat dans Kilo Code (réponse de minimax: Je ne peux pas lire les images — ce modèle ne supporte pas l'analyse d'images.)
  - Cause: `oswe-vscode-prime` model (GitHub Copilot internal) not available in Kilo Code
  - Fix: Added `aiflowbridge.vision.kiloVisionModel` setting for Kilo Code-specific vision model
  - MiniMax and Xiaomi providers now use `createVisionModelGetter('kilo')` which reads `vision.kiloVisionModel`
- [x] BUG02: affichage d'un message d'erreur si le port est occupé par les lancement d'une seconde instance de VS Code (l'extension affiche "AIFlowBridge gateway failed to start on port 8787: listen EADDRINUSE: address already in use 127.0.0.1:8787")
