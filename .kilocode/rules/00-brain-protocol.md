# Protocole BRAIN — règles obligatoires pour les agents IA

Ces règles s'appliquent à tout agent travaillant sur ce dépôt (Kilo Code,
Kilo CLI, ou autre). Elles rendent la mémoire de projet incontournable.

## Répartition des rôles (décision l'utilisateur, 2026-10-01)

L'exécution est désormais **mono-agent**. La répartition tech lead / exécutant
qui existait jusqu'au 2026-10-01 est caduque : il n'y a plus de second agent
sur ce projet.

- **L'agent IA** (Kilo Code ou Kilo CLI, dans le worktree qui lui est assigné)
  couvre désormais **tout** le cycle : conception, spécifications, écriture de
  code, docs et tests, audit, `npm install/build/test`, scripts, lancement de la
  gateway, flux OAuth réel, tests CLI, branches et PR. Il remonte les résultats
  **assainis** (jamais de secrets) dans `BRAIN.md` et `ACTION_PLAN.md`.
- **l'utilisateur** arbitre, valide les décisions d'architecture et gère les
  secrets locaux.

Conséquence pratique : il n'y a plus de répartition de capacités à negotiated
entre agents. Un agent ne délègue rien et ne doit pas chercher un partenaire
de revue. Les points qui demandaient une validation croisée sont désormais des
décisions utilisateur, listées en « Questions / Blocages » de `ACTION_PLAN.md`.

## Avant toute tâche

1. Lire `BRAIN.md` (mémoire long terme : décisions, contraintes, contexte).
2. Lire `ACTION_PLAN.md` (actions en cours, blocages, questions).
3. Vérifier que la copie locale est à jour : `git pull --rebase`
   (le hook pre-commit bloque de toute façon un commit en retard).

## Pendant la tâche

- Respecter les « Décisions d'architecture » de `BRAIN.md` ; ne pas les
  contredire silencieusement — proposer le changement dans le journal.
- Ne jamais écrire de secret (token, clé API, code OAuth, cookie, donnée
  personnelle) dans un fichier versionné. Ce dépôt est public.
- Toute information non publique va dans le canal privé
  (`AIFlowBridge-Private/BRAIN-PRIVATE.md`) ; les credentials restent
  locaux, hors git.

## Avant tout commit

1. Ajouter une entrée datée au journal de `BRAIN.md` (agent, action, résultat).
2. Mettre à jour `ACTION_PLAN.md` (statuts, nouvelles actions, blocages).
3. Le hook `pre-commit` bloque par défaut tout commit ne touchant ni
   `BRAIN.md` ni `ACTION_PLAN.md` — c'est voulu.
4. Contournements (rare, à justifier dans le message de commit) :
   `git commit --no-verify`, ou `git config hooks.brainMode warn`.

## Communication

Il n'y a plus d'échange entre agents. Tout passe par `ACTION_PLAN.md` et
`BRAIN.md`, qui sont la seule mémoire partagée du projet.

- Question, arbitrage ou blocage → section « Questions / Blocages » de
  `ACTION_PLAN.md`, avec le contexte nécessaire pour que l'utilisateur puisse
  trancher sans rouvrir le dépôt.
- L'agent colle les extraits de logs pertinents (assainis) dans le journal
  plutôt que de décrire vaguement une erreur.
- l'utilisateur arbitre et valide les décisions d'architecture.
