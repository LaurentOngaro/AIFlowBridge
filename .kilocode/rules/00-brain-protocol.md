# Protocole BRAIN — règles obligatoires pour les agents IA

Ces règles s'appliquent à tout agent travaillant sur ce dépôt (Kilo Code,
Kilo CLI, ou autre). Elles rendent la mémoire de projet incontournable.

## Répartition des rôles (décision Laurent, 2026-09-02)

- **Perplexity** (via connecteur GitHub) est le tech lead : conception,
  spécifications, écriture de code/docs/tests, audit et revue de code
  (lecture par fragments via la recherche GitHub), gestion du backlog,
  branches et PR.
- **Kilo** (VS Code / CLI local) est l'exécutant : `npm install/build/test`,
  scripts, lancement de la gateway, flux OAuth réel, tests CLI. Kilo remonte
  les résultats **assainis** (jamais de secrets) dans `BRAIN.md` et
  `ACTION_PLAN.md`.
- **Laurent** arbitre, valide les décisions d'architecture et gère les
  secrets locaux.

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

## Communication entre agents

- Question ou blocage destiné à Perplexity → section « Questions / Blocages »
  de `ACTION_PLAN.md`, préfixée `Kilo → Perplexity :`.
- Réponse ou nouvelle consigne de Perplexity → préfixe `Perplexity → Kilo :`.
- Kilo colle les extraits de logs pertinents (assainis) dans le journal
  plutôt que de décrire vaguement une erreur.
- Laurent arbitre et valide les décisions d'architecture.
