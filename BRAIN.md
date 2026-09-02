# BRAIN.md — Mémoire du projet AIFlowBridge

> Journal partagé et fil rouge du projet. Ce fichier est la **mémoire commune**
> entre les agents IA (Perplexity via connecteur GitHub, Kilo Code, Kilo CLI)
> et le mainteneur humain.
>
> ⚠️ **Ce dépôt est public** : ce fichier ne doit contenir QUE des informations
> techniques publiables. Voir « Règles de contenu » ci-dessous.

---

## Règles d'usage (obligatoires pour tout agent)

1. **Lire ce fichier et `ACTION_PLAN.md` au début de toute session de travail.**
2. **Mettre à jour le journal à la fin de toute tâche** (le hook `pre-commit`
   bloque par défaut tout commit qui ne touche ni `BRAIN.md` ni `ACTION_PLAN.md`).
3. Une entrée de journal = date, agent, action, résultat, liens éventuels.
   Rester concis et factuel.
4. Ne jamais réécrire l'historique du journal : on ajoute, on ne supprime pas
   (sauf erreur sensible, voir règles de contenu).
5. Les décisions nouvelles sont d'abord proposées dans le journal, puis
   consolidées dans « Décisions d'architecture » une fois validées par Laurent.

## Règles de contenu (dépôt public)

- ❌ Jamais de : tokens, clés API, codes OAuth, cookies, emails privés,
  données personnelles, URLs internes/privées, montants de facturation détaillés.
- ✅ Autorisé : architecture, décisions techniques, état des tâches, erreurs
  assainies (sans secret), liens publics, noms de modèles et de providers.
- Toute note sensible va dans un fichier local ignoré par git
  (ex. `.ai/private-notes.md`) ou dans le dépôt privé `AIFlowBridge-Private`.
- En cas de doute : ne pas écrire, demander à Laurent.

---

## État du projet (résumé courant)

- **Projet** : AIFlowBridge — assistant de code IA multi-providers pour VS Code,
  avec proxy vision transparent, métriques d'usage et passerelle locale
  OpenAI-compatible (mode standalone).
- **Providers actuels** : MiniMax, Xiaomi MiMo (et intégrations associées).
- **Chantier actif** : provider Antigravity / Google Cloud Code Assist afin
  d'utiliser Gemini via le compte Google AI Pro dans Kilo CLI, en parallèle
  de MiniMax-M3 via le plan MiniMax.
- **Plan de référence** : `docs/plans/antigravity-provider-kilo-cli.md`.

## Décisions d'architecture (validées)

| Date | Décision | Motif |
|---|---|---|
| 2026-09-02 | Passerelle locale OpenAI-compatible plutôt que plugin Kilo natif | Réutilisable (Kilo CLI, extension, autres clients), isole le risque des endpoints Antigravity, préserve le provider MiniMax officiel |
| 2026-09-02 | Mémoire projet publique (`BRAIN.md`) + notes sensibles hors git | Seul canal commun accessible à Perplexity (connecteur GitHub) et à Kilo ; dépôt public donc contenu assaini |
| 2026-09-02 | Hooks git versionnés dans `.githooks/` + `core.hooksPath` | Partage des hooks via le dépôt ; installation par `scripts/install-hooks.js` |
| 2026-09-02 | Hook pre-commit : pull obligatoire + mise à jour du journal | Éviter toute perte de modifications et rendre le journal incontournable |

## Contraintes et préférences

- Préférence pour les coûts déjà inclus dans des plans existants (Google AI Pro,
  MiniMax Token Plan) plutôt que la facturation API au token.
- Préférence pour les setups BYOK et la facturation directe chez le provider.
- Stack : TypeScript, extension VS Code, mode standalone Node.js.
- Langue de travail : français pour la documentation projet, anglais pour le code.

## Contexte technique clé

- Antigravity / Cloud Code Assist : OAuth Google (Authorization Code + PKCE),
  endpoints `cloudcode-pa.googleapis.com/v1internal:*` (internes, non officiels,
  susceptibles de changer — centralisés dans `constants.ts` du provider).
- Kilo Code accepte des providers OpenAI-compatibles personnalisés
  (baseURL + apiKey + catalogue de modèles).
- La passerelle cible : `http://127.0.0.1:<port>/v1` avec `/v1/models` et
  `/v1/chat/completions` (stream SSE), écoute locale uniquement.

## Liens utiles

- Plan Antigravity : `docs/plans/antigravity-provider-kilo-cli.md`
- Zone d'échange opérationnelle : `ACTION_PLAN.md`
- Règles agents Kilo : `.kilocode/rules/00-brain-protocol.md`

---

## Journal (plus récent en haut)

### 2026-09-02 — Perplexity
- Création de l'infrastructure de collaboration : `BRAIN.md`, `ACTION_PLAN.md`,
  hook `pre-commit` (pull requis + journal obligatoire), `scripts/install-hooks.js`,
  règles Kilo `.kilocode/rules/00-brain-protocol.md`.
- Prochaine étape : installation locale des hooks puis audit des fichiers
  existants (délégué à Kilo, voir AP-001 à AP-005).

### 2026-09-02 — Perplexity
- Création du plan d'implémentation Antigravity :
  `docs/plans/antigravity-provider-kilo-cli.md` (commit `2ba3a4c`).
- Décision : passerelle OpenAI-compatible plutôt que plugin Kilo natif.
