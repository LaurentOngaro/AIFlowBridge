# BRAIN.md - Mémoire long terme du projet AIFlowBridge

> Journal partagé entre l'agent IA (Kilo Code, Kilo CLI) et le mainteneur humain.
> Ce fichier porte ce qui **survit** aux releases : décisions, architecture, leçons.
> Le détail d'exécution est ailleurs : `CHANGELOG.md` (versions), `ACTION_PLAN.md` (actions AP-xxx), `docs/` (produit).
>
> ⚠️ **Ce dépôt est public** : ce fichier ne doit contenir QUE des informations techniques publiables. Voir « Règles de contenu ».

---

## Répartition des rôles (validée par l'utilisateur le 2026-10-01)

| Acteur                | Rôle      | Périmètre                                                                                                                                                                                                            |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **l'agent IA** (Kilo) | Exécution | Conception, spécifications, code, docs, tests, audit, `npm install/build/test`, scripts, gateway, backlog (`ACTION_PLAN.md`), branches et PR ; remonte des résultats **assainis** dans `BRAIN.md` / `ACTION_PLAN.md` |
| **l'utilisateur**     | Décideur  | Arbitrage, validation des décisions d'architecture, gestion des secrets locaux, revue finale                                                                                                                         |

L'exécution est **mono-agent** : un seul agent couvre tout le cycle, de la conception à la PR.
Il n'y a donc **aucun échange inter-agents** : tout passe par `ACTION_PLAN.md` et `BRAIN.md`, et les arbitrages passent par la section « Questions / Blocages » adressée à l'utilisateur.
Le modèle « tech lead / exécutant » qui existait avant le 2026-10-01 est **caduque** : il reste dans la table des décisions, marqué comme tel, pour que l'historique reste lisible.

## Règles d'usage (obligatoires pour tout agent)

1. **Lire ce fichier et `ACTION_PLAN.md` au début de toute session de travail.**
2. **Mettre à jour le journal à la fin de toute tâche** (le hook `pre-commit` bloque par défaut tout commit qui ne touche ni `BRAIN.md` ni `ACTION_PLAN.md`).
3. Une entrée de journal = date, agent, action, résultat, liens éventuels. Rester concis et factuel.
4. **Le journal se condense, il ne se réécrit pas.** On ajoute une entrée par tâche ; les entrées anciennes peuvent être regroupées ou réduites à leur enseignement durable, jamais réécrites sur le fond ni supprimées sans décision de l'utilisateur. Toute condensation conserve le texte intégral dans `_Private/archives/`.
5. Une décision nouvelle est d'abord consignée dans le journal, puis consolidée dans « Décisions d'architecture » une fois validée par l'utilisateur.
6. **Aucun commit automatique :** ne JAMAIS exécuter `git commit` sans demande explicite de l'utilisateur (ex: « fais le commit »). Tests verts, tâche terminée ou documentation à jour ne valent jamais autorisation de commiter.

## Règles de contenu (dépôt public)

- ❌ Jamais de : tokens, clés API privées, codes OAuth, cookies, emails privés, données personnelles, URLs internes, montants de facturation détaillés.
- ✅ Autorisé : architecture, décisions techniques, état des tâches, erreurs assainies (sans secret), liens publics, noms de modèles et de providers.
- Toute note sensible va dans le canal privé `AIFlowBridge-Private` ; les vrais secrets restent locaux hors git (`.ai/`).
- **Exception historiquement accordée puis caduque** : les credentials OAuth publics de l'AGY CLI ont été versionnés du 2026-09-05 au 2026-10-09, avec bypass `paths-ignore` dans `.github/secret_scanning.yml`. Ils ont été retirés du produit distribué avec le transport lui-même ; les patterns de détection restent, sans exception, pour alerter s'ils reviennent.
- En cas de doute : ne pas écrire, demander à l'utilisateur.
- **Langue** : `BRAIN.md`, `ACTION_PLAN.md` et les documents privés `_Private/**` sont en français. `docs/`, `AGENTS.md`, le code et les commentaires sont en anglais.

---

## État du projet (à jour 2026-10-10, version 2.24.0)

- **Projet** : AIFlowBridge - assistant de code IA multi-providers pour VS Code, avec proxy vision, métriques d'usage et gateway locale OpenAI-compatible, également distribuable en CLI pure Node.js (`aiflowbridge-server`).
- **Picker Copilot Chat** : DeepSeek, MiniMax, Xiaomi MiMo, servis par **un seul** vendor `aiflowbridge`.
- **Gateway seule** : OpenRouter, Z.ai GLM, MoonshotAI Kimi, Google AI Studio (BYOK), plus tout provider `openai-compat` / `ollama` déclaré par l'utilisateur.
- **Google** : **une seule voie supportée**, la Gemini API en BYOK (`generativelanguage.googleapis.com`, clé `AIzaSy...`). Le transport OAuth produit (Antigravity / Cloud Code Assist) a été retiré le 2026-10-09 pour conformité (voir journal).
- **Catalogue** : 38 entrées bundleées dans `resources/models.json`, surchargeable par registre global ou workspace, sans recompilation.
- **En attente d'arbitrage utilisateur** : AP-01 (promotion de vendors Path B vers le picker Copilot Chat).

## Décisions d'architecture (validées)

### Structure et mémoire du projet

| Date       | Décision                                                                                       | Motif                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Passerelle locale OpenAI-compatible plutôt que plugin Kilo natif                               | Réutilisable, isole le risque des endpoints spécifiques, préserve le provider MiniMax officiel                                                                  |
| 2026-09-02 | Mémoire publique `BRAIN.md` + canal privé `AIFlowBridge-Private` + secrets locaux hors git     | Seul canal commun entre l'agent et le mainteneur ; dépôt public donc contenu assaini                                                                            |
| 2026-09-02 | Hooks git versionnés dans `.githooks/` + `core.hooksPath`, hook pre-commit exigeant le journal | Partage des hooks via le dépôt, journal incontournable                                                                                                          |
| 2026-10-01 | Exécution mono-agent, fin du modèle « tech lead / exécutant »                                  | Un seul acteur de chaque côté : l'agent décideur de méthode, l'utilisateur arbitre. Une répartition de rôles caduque invite à chercher un partenaire inexistant |
| 2026-10-01 | **Aucun commit automatique par un agent** (AP-020)                                             | L'utilisateur garde toujours la main sur l'historique git                                                                                                       |

### Modèle et fournisseurs

| Date       | Décision                                                                                                                             | Motif                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Un vendor `aiflowbridge` unique en façade, qui délègue par model id vers le sous-provider correspondant                              | Le registre expose une liste multi-vendor ; en façade, un seul vendor évite N entrées redondantes dans le picker                             |
| 2026-10-01 | Deux chemins d'exposition assumés : Path A (picker + gateway) et Path B (gateway seule)                                              | Un meta-provider qui expose 100+ modèles n'a rien à gagner d'une classe `LanguageModelChatProvider` : la gateway relaie déjà verbatim        |
| 2026-10-01 | Le registre (`resources/models.json`) est la source de vérité des modèles, en 3 tiers, surchargeable sans recompilation              | Ajouter un modèle ne doit pas demander une mise en production                                                                                |
| 2026-10-01 | **Une contrainte de plateforme est déclarée par le modèle, jamais par le vendor** (`requiresThinkingParam`, `reasoningEffortLevels`) | Un modèle qui expose un vrai `reasoning_effort` en hérite sans code ; le vendor n'a pas à connaître la liste des modèles                     |
| 2026-10-01 | Les listes de référence viennent d'une source officielle, pas de la mémoire (`$discovery` Google pour les schémas)                   | Un mot-clé inventé fait tomber la requête entière ; une vérification sans appel réel possible doit s'appuyer sur la documentation de l'amont |
| 2026-10-01 | Une seule table de vérité par sujet : `API_KEY_SECRETS` pour la découverte des vendors, un module unique par traducteur              | Une liste dupliquée diverge et produit un bug silencieux ; la seconde liste est celle qu'on oublie de mettre à jour                          |
| 2026-10-01 | Auto-routage Xiaomi par préfixe de clé (`sk-*` vs `tp-*`) dans les deux sens                                                         | Les clusters upstream sont disjoints ; la valeur par défaut n'est qu'un point de départ, la décision est prise par requête                   |
| 2026-10-03 | Traducteurs Gemini : listes et analyse de contenu partagées (`content-parts.ts`, `json-schema-clean.ts`)                             | Le même 400 sur deux surfaces venait de deux copies du même code                                                                             |
| 2026-10-24 | La promotion d'un modèle amont (preview -> GA) est une **édition du registre** et une release mineure, sans alias de compatibilité | Le registre est la source de vérité : un id de catalogue qui change est un changement assumé, avec un 404 explicite de la gateway, pas deux identités pour un même modèle |
| 2026-10-24 | Une génération amont retirée **sort du registre**, et l'ancre tarifaire de sa famille change de modèle | Une ancre posée sur un modèle que personne ne peut plus appeler continue d'alimenter un tarif familial pour des modèles sans prix : le catalogue promet un prix pour un modèle qui n'existe plus |

### Google / Gemini

| Date       | Décision                                                                                               | Motif                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04 | Billing par profil (`token` vs `plan`), visible dans le dashboard (badge, tooltip, colonne `billedTo`) | Distinguer le coût réel au token (BYOK) d'un équivalent plan ; une route qui change la facturation ne peut pas être silencieuse                                                                                      |
| 2026-09-05 | Voie BYOK Gemini via la surface native `:streamGenerateContent?alt=sse` plutôt que la compat OpenAI    | La surface OpenAI-compat est feature-gated par projet GCP et retourne 429 quota=0 ; la native est toujours disponible, streaming temps réel par défaut                                                               |
| 2026-09-05 | Les credentials OAuth publics de l'AGY CLI ont été versionnés avec bypass de secret scanning           | **Caduque le 2026-10-09**, conservé ici pour l'historique : ces credentials étaient identiques à ceux du binaire officiel, sans eux la voie OAuth ne fonctionnait pas                                                |
| 2026-10-09 | **Retrait du transport OAuth Google produit** (Antigravity / Cloud Code Assist)                        | Sources Google du 2026-10-09 : backend IDE interne, arrêt de l'accès consumer depuis le 2026-06-18, interdiction des outils tiers dans les ToS. Refus HTTP 503 local avant réseau, aucun repli automatique vers BYOK |

### Gateway, sécurité, exploitation

| Date       | Décision                                                                                                                                                                    | Motif                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Chaque nouveau fournisseur est un `ProviderKind` de la gateway existante, pas une nouvelle passerelle                                                                       | La gateway OpenAI-compatible existe déjà et vise Kilo Code. Instancié d'abord pour Antigravity (2026-09-02), qui n'est plus qu'une valeur de `ProviderKind` héritée  |
| 2026-09-04 | Un seul verrou `gateway.lock` partagé par l'extension et la CLI, avec arrêt coopératif tokenisé                                                                             | Une seule instance possède le port ; `POST /shutdown` exige un token par instance, donc un tiers ne peut pas arrêter la gateway                                      |
| 2026-09-05 | Le streaming temps réel Gemini est le défaut, le drainage reste en repli (flag `bufferGeminiStream` défaut `false`)                                                         | Restaure le TTFT sans réintroduire la perte d'octets ; un opérateur sur lien instable peut forcer le buffer                                                          |
| 2026-10-01 | Le bump de version est un mécanisme fonctionnel, pas une formalité de release                                                                                               | Le redémarrage coopératif ne se déclenche que sur une version strictement plus récente : sans bump, un F5 rejoint l'instance vivante au lieu de la remplacer         |
| 2026-10-07 | Sécurité du gateway : garde loopback `Host` / `Origin`, SSRF par nom et par IP, redirections `manual` limitées à 307/308, scope `application` pour `aiflowbridge.providers` | Le bind sur `127.0.0.1` ne ferme ni le CSRF navigateur (`text/plain`, requête simple sans préflight) ni le DNS rebinding                                             |
| 2026-10-07 | Exiger `Content-Type: application/json` a été **proposé puis volontairement non appliqué**                                                                                  | 15 des 17 POST des tests existants envoyaient `text/plain` via `fetch` : la contrainte aurait cassé des clients réels sans rien fermer de plus que `Host` / `Origin` |
| 2026-10-07 | Un garde de sécurité proposé mais écarté reste écrit dans le code et dans le journal                                                                                        | Un écart assumé et documenté vaut mieux qu'un garde absent et redécouvert ; la règle est écrite pour empêcher un agent futur de le réintroduire                      |
| 2026-10-09 | Refuser plutôt que basculer en silence (503 déterministe, aucun repli automatique)                                                                                          | Changer de voie change la facturation, donc c'est une action explicite de l'utilisateur                                                                              |

## Contexte technique durable

### Gateway

- `src/aiflowbridge/gateway/server.ts` : `GatewayService`, serveur `node:http` sur `127.0.0.1`.
  Routes : `/version`, `/health`, `/metrics`, `/v1/metrics`, `/v1/models`, `/v1/discovery`, `/v1/events` (SSE), `/v1/replay/{id}`, `/v1/context`, `/v1/sessions`, `POST /v1/chat/completions`, `POST /shutdown`.
- Pipeline d'un chat : `readAndValidateBody` (garde loopback) -> `resolveChatProvider` (routage par alias de modèle et par langue) -> `buildUpstreamRequest` (URL, clé, headers, traduction du payload, contexte workspace) -> appel amont -> télémétrie.
- Redirections amont : `redirect: 'manual'`, `resolveProviderRedirect()` rejoue uniquement un 307 / 308, sur le même hostname, avec budget de 2 hops. Tout autre statut devient un 502 sans rejeu du corps POST.
- Clients documentés : Kilo Code, Continue, curl, Open WebUI. Clé locale `sk-aiflowbridge-local`.
- Standalone : binaire `aiflowbridge-server`, config `~/.aiflowbridge/config.json` (racine réelle : `<storageDir>`, cf `storage-dir.ts` et `AIFLOWBRIDGE_DATA_DIR`), build `npm run build:standalone`.

### Clés API

- Chaîne, par ordre de priorité : variable d'environnement `AIFLOWBRIDGE_<VENDOR>_API_KEY` **ou** `<VENDOR>_API_KEY` -> `secrets.json` (chmod 600) -> `SecretStorage` (VS Code).
- Le scan des noms nus est dérivé de `API_KEY_SECRETS` (`src/consts.ts`), donc un vendor ajouté là est découvert sans code ni seconde table.
- Clés jamais dans `settings.json` ni dans le versionné. Redaction dans les logs (`redactProviderForLog`) et sanitisation des messages d'erreur amont.

### Raisonnement

- `forceThinkingOnIfRequired()` réécrit les signaux « raisonnement off » en « on » pour un modèle qui déclare `requiresThinkingParam`. La traduction vendor passe **avant** la politique, sinon la valeur que la traduction doit lire disparaît.
- `reasoningEffortLevels` (liste ordonnée dans le registre) pilote le contenu du dropdown et la valeur relayée verbatim en `reasoning_effort`. Sans ce champ, le comportement historique `reasoning_split` booléen s'applique. Un niveau non déclaré est abandonné, pas relayé : une faute de frappe du client retombe sur le défaut amont au lieu de produire un 400.
- Un corps qui ne dit rien du raisonnement n'est jamais touché : la gateway n'invente pas de paramètre.

### Intégration Kilo Code

- Kilo Code construit son dropdown de niveaux **au démarrage d'une session** et ne lit que `item.id` et `item.name` de `GET /v1/models`. Aucune métadonnée ajoutée au catalogue ne peut donc alimenter ce sélecteur.
- Seule voie restante : écrire la configuration du client. `src/aiflowbridge/kilo-code-config.ts` (pur) + `src/runtime/configureKiloCode.ts` (commande), puis une offre non modale au (re)chargement de fenêtre.
- Écriture dans un fichier tiers : échec explicite si le fichier est illisible (ne jamais repartir d'une base propre), confirmation avant écriture, `chmod 600` après écriture atomique.

### Échecs amont observables

- Un refus amont n'est jamais interprété par son statut HTTP seul. `quota-diagnostics.ts` ne classe (`rate-limited`, `quota-exhausted`, `zero-allocation`, `billing-exhausted`) que sur preuve, et laisse non classifié un 429 dont le corps est illisible.
- Aucune inférence de facturation ou de mode d'auth à partir d'un vendor ou d'une méthode d'authentification : seul un `billing: 'plan'` explicite compte.

## Leçons récurrentes

Ces leçons sont le capital méthodologique du projet. Elles justifient des décisions prises dans des contextes différents et méritent d'être relues avant toute nouvelle correction.

1. **Remonter au propriétaire de la donnée** avant de chercher un cache périmé ou une liste dupliquée chez soi. La question utile n'est pas « qu'est-ce qui n'a pas été régénéré ? » mais « qui produit cette valeur, et est-ce nous ? ».
2. **Logique dupliquée = bug structurel.** Trois corrections successives ont eu la même cause (deux copies d'un même analyseur qui divergeaient). Chaque fois, la correction est une source unique plus un test d'invariant, pas une retouche de la copie fautive.
3. **Une affirmation que rien ne vérifie est un bug**, dans un CHANGELOG comme dans le code. Exemples : un champ de registre propagé vers une structure que personne ne lit, un refus amont attribué à un vendor sans appel réel possible.
4. **Un test qui fige le bug, ou qui exempte manuellement ce qu'il est censé détecter, est pire que l'absence de test** : il empêche la correction et donne une fausse confiance. Retirer la liste blanche d'un test est souvent le vrai correctif.
5. **Les zones non vérifiées à la compilation sont des angles morts** : `KNOWN_FAMILIES`, les enums de schéma, les tables de correspondance d'env. Chaque zone non couverte doit avoir son test d'inventaire, sinon l'oubli ne produit qu'un warning dans les logs.
6. **Une clé i18n manquante est un bug silencieux** : `t()` retourne la clé brute et ignore les substitutions. Le scanner de `tests/i18n.test.ts` existe pour cette raison, et les sites à clé calculée sont déclarés explicitement.
7. **Contrôler les liens : la destination et le libellé.** L'ancre se calcule comme GitHub le fait (minuscules, tout sauf lettres / chiffres / espaces / tirets supprimé, espaces -> tirets, **sans** collapse des espaces). Un contrôle d'ancre seul laisse passer un libellé menteur.
8. **Un changement sans effet visible immédiat doit proposer l'étape suivante**, et une bascule dont l'état n'est pas nommé est une source de flip : chaque vérification détruit le résultat.
9. **Écrire dans un fichier tiers n'est pas réinitialiser un fichier tiers.** Un fichier illisible doit faire échouer l'opération, et une réécriture qui perd des commentaires se demande avant, pas après.
10. **Un snippet proposé par un tiers se vérifie chez l'amont avant d'être recopié.** Un champ peut documenter autre chose que ce qu'il fait, et une doc de client peut recommander une configuration fautive sans le savoir.
11. **N'élargir pas au-delà du bug sans capacité de vérification.** Séparer explicitement ce que l'amont refuse de ce qu'on retire par prudence rend les deux ensembles auditables et évite qu'un correctif bien intentionné déferait le défaut.
12. **Un dossier public ne contient pas de mesure d'audience** : un effectif devient faux et se lit comme un état durable. Les mesures restent dans le journal, qui est daté.
13. **Une revue de conformité qui trouve une anomalie doit la corriger et la verrouiller par un test**, sinon la même dérive revient au suivant audit de documentation.
14. **Le critère de suppression d'un artefact est la référence, pas la taille.** Une image non référencée est du superflu, une image référencée est de la documentation, quel que soit son poids.
15. **Deux silences de même apparence n'appellent pas le même comportement.** L'absence de prix dans le registre est une déclaration, l'absence de prix dans une déclaration utilisateur est une absence d'information : traiter les deux par le même repli invente un coût dans le premier cas et rend service dans le second.
16. **Un label de runner retiré ne fait pas échouer le job, il le parke.** GitHub a retiré l'image `macos-13` sans invalider le label : le job reste « queued » indéfiniment, le run ne conclut jamais, et tout le reste de la release est publié sans que l'échec soit visible. Un workflow de release se juge sur le fait qu'il **termine**, pas sur le succès de ses étapes : un label de runner doit exister au moment où le tag est poussé, et un timeout borné évite qu'un build pendu parke la release pour une journée.

## Liens utiles

- Backlog et arbitrages en cours : `ACTION_PLAN.md`.
- Versions livrées : `CHANGELOG.md` (Keep a Changelog).
- Documentation utilisateur : `docs/` (providers, gateway, reasoning, dashboard, standalone, vision, cost, autostart, kilo-code).
- Instructions pour agents et contributeurs : `AGENTS.md` et `docs/agent-instructions/`.
- Specs et rapports archivés : `_Private/archives/` (locaux, jamais publiés), ex. `2026-10-10_BRAIN-integral-avant-purge.md` = journal intégral avant la condensation du 2026-10-10.
- Canal privé : dépôt `AIFlowBridge-Private` -> `BRAIN-PRIVATE.md`.

---

## Journal (plus récent en haut)

> Les entrées décrivent les **décisions** et les **jalons** qui restent utiles en mémoire long terme.
> Les étapes d'exécution (bumps de version, listes de fichiers touchés, comptes de tests, mises à jour de docs déjà décrites au CHANGELOG) sont volontairement omises : le CHANGELOG les conserve, et `ACTION_PLAN.md` porte le détail par action.
> Les identifiants `AP-xxx` cités dans les entrées sont ceux de l'historique ; le ménage du fichier d'attente du 2026-10-10 a renuméroté les deux actions encore ouvertes (AP-013 -> AP-01, AP-025 -> AP-02).

### 2026-10-24 - Kilo (CI : un label de runner retiré parke la release au lieu de la faire échouer)

**Les runs de release v2.25.0 et v2.26.0 ne se terminaient pas**, alors que tout le travail avait réussi : le job `publish` (VSIX, Marketplace, Open VSX, GitHub Release) et les trois builds standalone (linux-x64, darwin-arm64, win-x64) étaient verts, et seul `standalone (macos-13)` restait « queued » indéfiniment.

**La cause n'est pas un échec mais une absence de runner.** GitHub a retiré l'image macOS 13 de son catalogue de runners sans invalider le label : aucun runner ne correspond plus à `macos-13`, le job attend donc un runner qui n'existe pas, et le run ne conclut jamais.
Un échec de job se verrait ; une attente infinie se remarque à peine.

**Le correctif est double** : `macos-15-intel` (le label standard qui a remplacé `macos-13`, gratuit sur les dépôts publics) garde l'archive Intel macOS, et un `timeout-minutes: 30` borne le job pour qu'un build pendu ne parke plus une release pour une journée.
Le défaut par défaut de GitHub est de 6 heures.

**Conséquence sur les versions déjà publiées** : la 2.25.0 et la 2.26.0 sont bien publiées sur les deux stores (le job `publish` a réussi), mais leur archive `darwin-x64` manque dans la GitHub Release.
Le tag de la 2.26.0 a été déplacé sur le commit qui corrige le workflow pour rejouer la release avec le bon label ; le tag de la 2.25.0 a été laissé en place, son contenu étant déjà publié.

### 2026-10-24 - Kilo (MiniMax M2.7 : le catalogue ne garde pas une génération que l'amont retire)

**MiniMax retire M2.5 et M2.7** : plus de nouveaux comptes depuis le 2026-10-19, suppression de l'API le 2026-11-18, et les requêtes M2.5 / M2.7 sous M Plan ou Token Plan sont déjà reroutées vers M3.1 Flash.
Le registre bundleait encore `MiniMax-M2.7` et `MiniMax-M2.7-highspeed` : ils sortent, la 2.26.0 passe le catalogue de 38 à 36 modèles.
M2.5 et ses variantes avaient déjà été purgés en 2.19.0, cette release achève le balayage.

**L'ancre tarifaire de la famille a suivi le modèle, pas le tarif.** `DEFAULT_GATEWAY_PROFILES` portait l'ancre `minimax` sur `MiniMax-M2.7` : c'est elle qui donnait un tarif indicatif à tout modèle MiniMax déclaré par l'utilisateur sans prix.
Une ancre posée sur une génération retirée continue de diffuser un tarif pour des modèles dont personne ne connaît le prix réel, et le catalogue annonce un modèle que l'amont ne sert plus.
L'ancre est donc déplacée sur `MiniMax-M3`, qui porte exactement le même tarif (0.3 / 1.20 USD par M) : **le défaut familial ne change pas de valeur**, il change de modèle.

**La rupture de catalogue reste assumée.** Une configuration qui épingle `MiniMax-M2.7` reçoit un 404 de la gateway qui liste les ids disponibles, pas une alias silencieux.

**Ce que la purge a révélé dans le code** : les clés de traduction `model.MiniMax-M2.7.detail` et `model.MiniMax-M2.7-highspeed.detail` devenaient orphelines, et le test de garde sur les clés orphelines les aurait fait échouer.
C'est le comportement voulu du garde : purger un modèle du registre oblige à supprimer sa clé, sans liste d'exemption.

### 2026-10-24 - Kilo (MiniMax M3.1 Flash : de la preview au modèle généralement disponible)

**L'amont a publié `MiniMax-M3.1-Flash` le 2026-10-19.** L'id `MiniMax-M3.1-Flash-Preview` devient caduc ; le registre porte maintenant l'id GA, le nom `MiniMax M3.1 Flash`, et le tarif publié ($0.15/M en entrée, $0.60/M en sortie).

**Le point qui change vraiment n'est pas l'id, c'est le silence du registre.** La preview était le seul modèle bundleé sans prix, précisément parce qu'aucun tarif pay-as-you-go n'était publié pour un tier preview.
La règle de l'AP-02 (« l'absence de prix dans le registre est une déclaration ») reste vraie et reste écrite dans le code, mais **plus aucun modèle bundleé ne l'exerce** : les 38 ont un tarif.
La conséquence n'est pas cosmétique : le modèle affiche enfin un coût estimé dans le dashboard et ses requêtes comptent dans les totaux.

**Le reste du comportement est identique**, et c'est vérifiable sans appel amont : 1M de contexte, entrée multimodale (texte, image, vidéo), raisonnement toujours actif (400 `requires adaptive thinking` sur `reasoning_split: false`, `thinking.type: disabled`, `reasoning_effort: none`), cinq profondeurs (de `low` à `max`).
Le sélecteur « Thinking Effort », les variantes Kilo Code et la réécriture de la gateway n'ont donc pas bougé.

**La rupture de catalogue est assumée, pas amortie.** Une configuration qui épingle l'ancien id reçoit un 404 de la gateway qui liste les ids disponibles, pas une alias silencieux : le précédent du 2026-10-01 (deux ids de catalogue changés, release mineure) tient toujours.

**Constat à traiter au cycle suivant, hors périmètre de cette demande** : MiniMax annonce le retrait de M2.5 et M2.7 - indisponibles pour les nouveaux utilisateurs depuis le 2026-10-19, retirés le 2026-11-18, et les requêtes M2.5 / M2.7 sous M Plan ou Token Plan sont déjà reroutées vers M3.1 Flash.
Le registre bundle encore `MiniMax-M2.7` et `MiniMax-M2.7-highspeed` : c'est le prochain arbitrage, pas celui-ci.

### 2026-10-10 - Kilo CLI (Prix catalogue : un modèle sans tarif publié ne hérite plus du tarif de son frère, AP-02)

**La note AP-02 désignait la mauvaise source.** La valeur 0.3 / 1.2 affichée pour `MiniMax-M3.1-Flash-Preview` ne venait pas d'une entrée de `DEFAULT_GATEWAY_PROFILES` (aucune n'a cet id), mais du **repli par famille** : `getFamilyPricing()` donnait à tout modèle sans prix le tarif indicatif du curated de sa famille, donc l'entrée MiniMax M2.7.

**La vraie question n'était pas « quelle valeur ? » mais « que signifie l'absence de prix ? ».** Pour un modèle **bundleé**, le registre est la source de vérité du catalogue : son silence est une déclaration (pas de tarif pay-as-you-go publié pour un tier preview).
Pour un modèle **déclaré par l'utilisateur**, le silence est une absence d'information, et le repli familial reste utile.
Les deux silences ne veulent pas dire la même chose, donc ils n'appellent pas le même comportement : le repli est désactivé pour la synthèse du registre, conservé pour `aiflowbridge.userModels`.
Effet : M3.1 Flash Preview reste au catalogue, s'affiche à `-`, et ses requêtes comptent pour 0 dans les totaux, au lieu d'un coût calculé sur un prix qui n'existe pas.

**Vérification demandée par la note, sur les autres modèles** : `gemini-3.6-flash` et `gemini-3.7-flash` sont bien tarifés par le registre (0.3 / 2.5).
La note était périmée sur ce point, elle datait d'avant la 2.19.0.
Un seul modèle bundleé sur 38 est sans prix, et c'est M3.1, ce qui rend l'exception visible plutôt que diffuse.

**Défaut de classe voisin, traité dans la foulée** : les taux en dur de `DEFAULT_GATEWAY_PROFILES` sont une deuxième source de vérité à côté du registre, et rien ne les obligeait à concorder.
Ils concordent aujourd'hui (les 6 vérifiés un à un), mais la constante est désormais exportée et un test de dérive verrouille l'égalité, plus un test qui interdit un taux curaté pour un modèle que le registre ne tarife pas.

**Un écart laissé visible plutôt que corrigé en douce** : dans `buildDefaultGatewayProfiles`, le taux curaté passe avant le registre tarifaire fusionné, donc une surcharge utilisateur de `pricing-override.json` est ignorée pour les 6 entrées curatées alors qu'elle s'applique aux modèles synthétisés.
Ce n'est pas le défaut signalé, le changer modifierait une précédence documentée et testée, cela reste donc à arbitrer.

**Tests** : 4 ajoutés, 1 réécrit dans `tests/host-config.test.ts`.
Rouge vérifié sur l'ancien comportement : repasser le repli à `true` fait échouer exactement les 2 tests de comportement, et rien d'autre.
`npm run validate` vert (1 428 tests, 78 fichiers), `compile:standalone` vert. `docs/cost.md` (dont la ligne qui documentait le repli de M3.1) et `docs/providers.md` corrigés, section `Unreleased` du CHANGELOG.

### 2026-10-10 - Kilo CLI (Nettoyage du payload VSIX, AP-044)

Suppression de `resources/screenshots_v1.1.1/` et `resources/screenshots_v1.4.0/` sur demande utilisateur : elles totalisaient 1,5 Mo, montraient une interface disparue depuis huit versions et n'étaient plus référencées que par une galerie.
`screenshots_v2.15.5/` est conservée en totalité (7 captures, référencées). VSIX de 4,8 Mo à 3,39 Mo (-29 %), 466 à 450 fichiers.
Critère retenu : la **référence**, pas la taille. Récupérabilité assumée : les fichiers restent dans l'historique git, et `docs/screenshots.md` le dit.
Corollaire retenu : `TODO.md`, `CHANGELOG.md` et ce journal continuent de mentionner les séries supprimées, parce qu'un journal note ce qui était vrai à la date du fait, pas l'état courant.

### 2026-10-10 - Kilo CLI (Audit de cohérence de la documentation publique, puis arbitrage AP-043)

Quatre audits parallèles en lecture seule (README vs `package.json`, gateway / autostart vs code, providers / registry, reste des docs + style), chaque constat BLOQUANT recoupé dans le code, puis contre-vérification du diff par un agent indépendant, qui a trouvé 2 erreurs introduites par ce travail (suffixe `/v1` sur une chaîne de log, `debugMode` documenté comme booléen) - corrigées et re-vérifiées.

Les 8 BLOQUANT, tous de la forme « la doc affirme plus que le code ne fait » :

- Tarifs Xiaomi V2.6 Flash faux dans 4 documents ($0.05/$0.15 au lieu de $0.10/$0.30 dans le registre), point mort recalculé honnêtement.
- `docs/vision-proxy.md` décrivait `excludedVendors` comme un garde-fou de chemin alors qu'il ne sert qu'au choix du modèle de proxy. La liste « modèles natifs » était fausse : DeepSeek et MiniMax sont toujours proxysés, seul `mimo-v2.5` est natif, et la gateway n'a aucun proxy vision.
- `docs/reasoning.md` décrivait un gateway qui relaie la charge utile telle quelle, alors que la politique de thinking force l'activation. DeepSeek ajouté aux modèles `requiresThinkingParam`.
- `docs/architecture.md` pointait vers un fichier inexistant et décrivait trois vendors de picker là où `package.json` n'en déclare qu'un.
- `docs/development.md` citait deux workflows inexistants et le mauvais nom de secret (`OPENVSX_TOKEN` au lieu de `OVSX_PAT`).
- `docs/autostart/standalone-config.example.json` était inopérant : clés plates alors que le lecteur parcourt un objet imbriqué.
- `docs/standalone.md` : lien symbolique vers un binaire sans shebang, et `~/.aiflowbridge/` présenté comme la racine alors qu'un `AIFLOWBRIDGE_DATA_DIR` ou le globalStorage de l'extension la remplace silencieusement.

**Constats laissés à l'arbitrage de l'utilisateur** puis appliqués le jour même (AP-043) :

- Titres de commandes : préfixe `AIFlowBridge:` retiré de 18 titres, la catégorie reste donc l'affichage visible est inchangé. 16 titres déjà dépouillés laissés tels quels : le dépôt est désormais cohérent dans un seul sens.
- `package.json` annonce Gemini 3.5 Flash contre 3.8 partout ailleurs : aligné.
- Deux `baseUrl` Xiaomi par défaut semblaient divergents. L'utilisateur a demandé vérification avant décision, et il avait raison : `resolveXiaomiBaseUrl()` choisit déjà l'hôte par préfixe de clé, **dans les deux sens**. Les deux valeurs ne divergeaient donc jamais à l'exécution, le code de routage était la source de vérité et non la valeur par défaut. Registre aligné sur l'URL la plus lisible.
- Clés i18n mortes MiniMax M2 / M2.1 / M2.5 supprimées, et surtout **liste blanche retirée du test anti-orphelins** : elle listait précisément ces ids, ce qui les avait laissés survivre au purge du catalogue.

### 2026-10-10 - Antigravity (Revue de conformité AP-042 et release 2.24.0)

Revue des lots A à F du retrait du transport OAuth Google produit.
Conformité validée sur la politique de refus pure, l'absence de repli implicite sur BYOK, le blocage précoce 503 sans flux SSE, le retrait des modules et secrets embarqués, le nettoyage local sélectif, et la non-régression BYOK.

Une anomalie critique a été trouvée par cette revue et corrigée : la valeur par défaut `providers.googleaistudio.baseUrl` du chargeur standalone pointait encore sur `https://cloudcode-pa.googleapis.com`, l'URL du transport retiré.
Corrigée et verrouillée par assertion de test.
`README.md` et `docs/providers.md` explicitent désormais noir sur blanc que la voie OAuth a été livrée en 2.17.0 puis retirée parce que l'accès à ce backend interne via un outil tiers est une violation des conditions d'utilisation Google, avec risque de suspension.
Google exige une clé API officielle (AI Studio ou Vertex AI).
Version 2.24.0 et section de CHANGELOG correspondantes écrites à la demande explicite de l'utilisateur.

### 2026-10-09 - Kilo (Retrait du transport OAuth Google produit)

**Décision** : le transport OAuth livré en 2.17.0 est retiré du produit distribué.
La voie Gemini API (BYOK) reste la seule voie Google, avec son streaming, sa vision native et ses tools inchangés.

**Sources officielles consultées le 2026-10-09** :

- La FAQ Antigravity indique que l'accès à ce backend via des outils tiers viole les conditions de service, et recommande une voie API pour un agent tiers.
- La page « Gemini Code Assist consumer accounts » annonce l'arrêt des requêtes des extensions Code Assist et du Gemini CLI pour les comptes individuels, Pro et Ultra depuis le **2026-06-18**.
- La page « Standard and Enterprise » décrit une souscription Cloud séparée et qualifie `cloudcode-pa.googleapis.com` d'API interne aux fonctions IDE.

Aucun mécanisme officiel ne convertit un droit Pro/Ultra en autorisation de consommer ce backend depuis AIFlowBridge.

**Ce que dit et ne dit pas cette décision** : c'est une décision produit de prudence, pas une consultation juridique, et pas l'affirmation qu'AIFlowBridge n'avait aucun défaut sur cette route (les deux défauts de routage de 2.23.0 étaient réels et ont été corrigés).
La cause d'une erreur distante n'est jamais déterminée par le statut HTTP seul.

**Implémentation** :

- Module pur `src/aiflowbridge/google-transport-policy.ts` : `classifyGoogleTransport()` sur le **hostname normalisé en correspondance exacte** (jamais `includes()`), donc `cloudcode-pa.googleapis.com.example.org` n'est pas refusé et la famille `googleaistudio` n'est jamais un signal de refus à elle seule, puisque le BYOK y vit.
- **Refus local déterministe** : HTTP 503, enveloppe d'erreur OpenAI, code stable `google_product_oauth_unsupported`, **avant** toute résolution de credential, avant tout appel amont et avant chaque saut de redirection. Aucun SSE partiel n'est ouvert, aucun en-tête de quota n'est publié (rien n'a été demandé à Google), et **aucun repli automatique vers BYOK** : changer de voie change la facturation, donc c'est une action explicite. Le profil bloqué disparaît aussi de `GET /v1/models`.
- **Credentials retirés** du produit distribué, modules `auth` / `catalog` / `project` / `pkce` / `token-store` supprimés, exceptions de secret scanning **strictement liées à ces valeurs** retirées (les patterns de détection restent, sans exception). Historique git non réécrit.
- **Nettoyage local proposé et séparé** : suppression du seul slot hérité `antigravity`, de manière sélective (les clés des autres vendors et la clé BYOK survivent), idempotente, mode `0600` préservé. Aucune révocation distante n'est tentée, et le message le dit explicitement.
- **Compatibilité** : les ids de commande de connexion subsistent (la déconnexion fait le nettoyage local) et la commande de bascule devient une aide à la migration qui nomme le tier fautif et exige une confirmation nommant la conséquence de facturation.
- **Lot quota** : un `RESOURCE_EXHAUSTED` générique **sans bloc de violation** n'est plus classé `zero-allocation`. Ce dernier exige désormais une métrique nommée ET une valeur explicitement nulle. Aucune nouvelle valeur ajoutée au contrat d'en-tête existant.
- **Lot télémétrie** : plus aucune attribution `plan` déduite d'un vendor ou d'une méthode d'authentification. Les lignes historiques restent lisibles, sans requalification rétroactive.
- Tests : 3 fichiers ajoutés, 3 supprimés (ils testaient un chemin qui n'existe plus), adaptations dans 6 fichiers existants, non-régression BYOK couverte de bout en bout.

**Limites assumées** : la voie BYOK n'a pas été exercée en réel (aucune clé `AIzaSy...` sur cette machine) et aucune commande n'a été jouée depuis VS Code (pas d'hôte ici) ; la logique est couverte, le dialogue utilisateur ne l'est pas.
Le numéro de version n'a pas été inventé hors demande explicite.

### 2026-10-09 - Kilo (Correctifs de routage Google AI Studio et diagnostic de quota amont)

Deux défauts de routage réels, trouvés sur un incident de facturation (402 « prepayment credits depleted » alors que l'utilisateur croyait être sur la route OAuth) :

- **GATE-1 (majeur)** : la commande de bascule résolvait la route effective avec les clés vendor `['googleaistudio', 'antigravity']` alors que la gateway la résout avec `googleaistudio` seul. Or `vendors.antigravity` était documenté comme « metadata-only », donc un override portant l'OAuth sous `antigravity` faisait conclure « déjà sur OAuth » à la commande, qui refusait d'agir, pendant que la gateway servait la surface BYOK. Corrigé en centralisant la liste, plus une relecture de la valeur écrite : si la fenêtre ne sert pas le réglage, la commande nomme l'override à éditer au lieu de procéder, et **ne supprime pas** les vendors périmés, qui seraient le seul choix de route actif.
- **GATE-2 (mineur)** : `validateRegistryContent` était appelé hors du `try/catch` de chargement de palier. La garantie fail-soft reposait sur une coïncidence d'implémentation ; les deux passes partagent maintenant une seule frontière.

**Correction d'une affirmation** : le palier de registre ignoré n'était pas « silencieusement » ignoré, le test existant le prouvait déjà, et le WARN journalisait le chemin fautif.

**Diagnostic de quota amont** (module pur `quota-diagnostics.ts`) : un 429 sans preuve reste non classifié, parce que rediriger vers la console pour un simple rate-limit serait pire que de ne rien dire.
Les headers `X-AIFlowBridge-Quota-State` et `X-AIFlowBridge-Quota-Reset` portent la conclusion, le corps amont reste intact pour le client.

**Une hypothèse testée et infirmée** : le quota serait dimensionné par `x-goog-api-client`.
Rejeu de la même requête avec trois valeurs d'en-tête, dont l'absence : 429 dans les trois cas.
L'hypothèse a été énoncée puis retirée.

### 2026-10-09 - Kilo (Hygiène de BRAIN.md, liens internes et formulation de la documentation)

- Six entrées marquées `fait` siégeaient encore dans le tableau « À faire » de `ACTION_PLAN.md`, et une ligne vide au milieu d'un tableau markdown le coupait en deux (le rendu ne propage pas les colonnes d'un bloc à l'autre). Reconstruit par section, pas par recolle de lignes brutes.
- 37 liens cassés corrigés sur trois familles : ancres `#model-registry` qui n'ont jamais existé (ancre réelle `#model-registry-3-tier`), `docs/agent-instructions/*` qui pointaient un cran trop bas vers `docs/AGENTS.md`, et 18 images de `docs/screenshots.md` qui visaient `docs/` au lieu de `resources/`. Un vérificateur d'ancres et de cibles a été écrit pour l'occasion et donne 0 casse sur 35 fichiers markdown. Premier passage : 17 faux positifs, parce qu'un PNG contient parfois par hasard une séquence d'octets de type texte.
- La note « field maturity » parlait d'effectifs d'utilisateurs. Reformulée sans aucun effectif : une mesure d'audience dans une doc publique devient fausse et se lit comme un état durable. La nuance conservée est que la route a des zones non testées, pas qu'elle est fausse.

### 2026-10-09 - Kilo (Clôture de l'audit AUD02 et release 2.23.1)

- **REDIR-1 (majeur)** : l'amont acceptait le rejeu sur 301 / 302 / 303 alors que la documentation et le CHANGELOG promettent 307 / 308. La RFC 9110 impose GET pour 303 et réécrit historiquement le POST pour 301 / 302, donc un rejeu de prompt non préservant était possible. Le résolveur de redirection reçoit désormais le statut et refuse explicitement tout autre valeur, en 502, sans rejeu du corps.
- **DOC-DATA1 (mineur)** : le rôle de `resources/pricing.json` (instantané OpenRouter régénéré à chaque release, repli tarifaire pour les modèles déclarés par l'utilisateur) était absent de la documentation d'agent. Documenté, en le distinguant des 38 modèles natifs tarifés par le registre.
- Packaging VSIX vérifié propre, configuration locale de l'utilisateur assainie (retrait d'une entrée vendor temporaire par restauration d'une sauvegarde), bump patch 2.23.1 et section de CHANGELOG écrits à la demande explicite de l'utilisateur, seul commit de la période.

### 2026-10-07 - Kilo (Implémentation de l'audit AUD02, bump mineur 2.23.0)

Treize constats traités, dont trois défauts de sécurité qui changent le comportement observable de la gateway :

- **Garde loopback** : un `Host` sur le port lié et, s'il est présent, un `Origin` sur le même port doivent être loopback, sinon 403 sans appel amont.
- **SSRF** : endpoints de métadonnées bloqués par nom autant que par IP, car la résolution DNS a lieu après le contrôle.
- **Scope** : `aiflowbridge.providers` passe en `application`, pour qu'un dépôt cloné ne puisse pas repointer un `baseUrl`.

Un point d'honnêteté sur la méthode : exiger `Content-Type: application/json`, comme le recommandait l'audit, aurait cassé des clients réels sans rien fermer de plus que la garde `Host` / `Origin`.
Le motif est écrit dans le code pour qu'un agent futur ne le réintroduise pas.

Également traité : neutralisation de l'injection de formule dans les exports de télémétrie (`responseSummary` provient de la sortie du modèle amont, et le quoting RFC 4180 n'empêche pas Excel d'évaluer un champ entre guillemets), exclusion de l'outillage de développement et des journaux d'IA du VSIX (artefact de 8,9 Mo à 4,7 Mo), déplacement de `scripts/` sous `_helpers/scripts/`, réduction de `package.nls.json` à ses clés réellement référencées par le manifeste, suppression d'un réglage jamais lu qui contredisait l'invariant « les clés vivent en `SecretStorage` ».

**Point de méthode** : la réécriture de `ACTION_PLAN.md` par recolle de plages de lignes a échoué deux fois (lignes dupliquées, puis lignes vides mal placées) parce qu'il fallait parser, filtrer, puis réassembler par section.

### 2026-10-07 - Kilo (La commande de bascule de route Google AI Studio : un défaut d'appelant, pas de couche pure)

Signalement : la commande est utilisée mais « dans les deux cas, je retombe sur la route BYOK ».
La couche pure était correcte et le test du cas « la route demandée est déjà active » existait : le défaut était dans l'appelant, qui déduisait la cible comme l'inverse de la route courante à chaque invocation.
Relancer la commande « pour vérifier » suffisait donc à rebasculer, ce qui se lit exactement comme « la bascule ne marche pas ».
Aggravant : la gateway construit ses profils une fois par activation, donc après une bascule réussie les requêtes partent encore sur l'ancienne surface jusqu'au rechargement.
Boucle fermée par le symptôme, pas par le code.

Deux leçons en ont tirées, qui valent au-delà : **une bascule dont l'état n'est pas nommé est une source de flip**, et **un changement qui n'a pas d'effet visible immédiat doit proposer l'étape suivante** plutôt que l'annoncer dans un toast que personne ne voit avant que le problème ne se manifeste.
Correctif : la commande présente les deux routes avec leur conséquence de facturation, applique la route choisie (donc un second passage est un no-op propre), et propose le rechargement de fenêtre.
Test non-régression : les deux routes demandées deux fois de suite restent stables.

### 2026-10-07 - Kilo (MiniMax M3.1 : niveaux de raisonnement et écriture de la configuration Kilo Code)

Chaîne de trois constats, du modèle au client :

1. **Le raisonnement ne pouvait pas être coupé** (2026-10-01). Sonde empirique contre l'API amont avant d'écrire la moindre ligne : `reasoning_split: false`, `thinking.type: "disabled"` et `reasoning_effort: "none"` sont refusés en 400, l'absence de paramètre est acceptée. Décision de conception : renvoyer une erreur priverait l'utilisateur de la seule chose qui marche, donc la gateway sert la requête qu'elle peut servir. Le champ `requiresThinkingParam` existait déjà dans le registre, validé, fusionné, documenté, et propagé vers une structure que **aucun code ne consommait** : la correction câble ce champ plutôt que d'inventer un drapeau.
2. **La profondeur est une propriété du modèle** (2026-10-01). Nouveau champ `reasoningEffortLevels` qui pilote à la fois le dropdown et la valeur relayée. Résolution extraite en fonction pure pour être testable sans hôte VS Code.
3. **Le dropdown de Kilo Code n'est pas alimentable par la gateway** (2026-10-07). Vérification dans la source du client : `fetchOpenAIModels` n'extrait que `item.id` et `item.name` de `GET /v1/models` et ignore tout le reste. Ajouter `variants` ou toute autre métadonnée au catalogue n'aurait donc aucun effet : ce n'est pas un oubli de notre format, c'est le client qui ne lit pas.

**Décision utilisateur explicite** : demander d'éditer `kilo.json` à la main est contre-productif, donc l'extension écrit la configuration du client.
Module pur (lecteur JSONC sensible aux littéraux de chaîne, détection de provider par `host:port`, génération et remplacement du bloc `variants`, idempotence) plus une commande (localisation dans l'ordre de découverte de Kilo, refus d'écrire un fichier non parsable, modale détaillant l'avant / après, écriture atomique puis `chmod 600`, le fichier contenant généralement une clé de provider).
**Choix du déclencheur : l'activation, pas le moment de la requête.** Kilo construit son dropdown au démarrage d'une session, donc une écriture déclenchée par une requête arriverait trop tard pour la session qui l'a produite, et exigerait une plomberie gateway -> hôte pour un résultat médiocre.
Le contrôle couvre la session suivante, coûte une petite lecture de fichier, et n'a besoin d'aucun callback. **Offre et non écriture silencieuse** : réécrire un `.jsonc` supprime ses commentaires, cela se demande.
Libellé de la doc aligné : « dans le cas courant, il n'y a rien à faire ».

**Leçon de méthode** : le premier réflexe avait été d'aller chercher un cache périmé ou une liste de niveaux dupliquée dans notre code.
La vérification utile était de remonter jusqu'au propriétaire de la donnée, qui est ici le client.

### 2026-10-03 et 2026-10-01 - Kilo (Deux 400 Gemini sur la voie BYOK, même cause structurelle)

**Mots-clés JSON Schema refusés** : un seul mot-clé inconnu fait tomber la requête entière, même si l'outil est valide.
La cause structurelle n'était pas la liste incomplète mais le fait qu'il existait **deux** listes, déjà divergentes.
Correction : un module unique porte le sanitiseur et ses ensembles, réexporté par le second traducteur pour préserver sa surface publique.
Liste de référence obtenue depuis la **discovery API officielle** de Google, pas de mémoire.
Choix assumé de ne pas élargir au-delà du bug : les mots-clés que Gemini accepte mais que l'historique retirait restent dans un ensemble distinct, donc toute dérive est visible par test.

**Résultat d'outil envoyé en tableau de parts** : `typeof [] === 'object'`, donc un `content: [{type:'text',...}]` valide côté OpenAI passait tel quel dans `functionResponse.response`, sérialisé en liste, alors que le champ est une `Struct` non repeated sur les deux surfaces.
Même 400 possible via une chaîne JSON qui décode en tableau.
Correction par la même source unique, plus un défaut latent trouvé au passage : le nom de la fonction venait d'un `msg.name` facultatif en OpenAI, alors que l'information utile est dans `tool_call_id` ; les traducteurs construisent maintenant une table `tool_call_id` -> nom en parcourant les tours assistant.

**Limite assumée** : aucun appel réel vers Gemini n'a été possible sur cette machine (pas de clé AI Studio), les corrections sont prouvées par test unitaire sur la forme exacte des rapports.
Pour le premier cas, l'utilisateur a ensuite confirmé que la requête qui échouait passe : le correctif est validé contre l'API réelle.

**Une affirmation retirée dans les deux sens** : le refus de `thinking.type: disabled` par GLM et Kimi venait de la documentation, sans appel possible.
Le CHANGELOG le dit maintenant explicitement, et la doc ne décrit plus un comportement amont qu'on n'a pas observé.

### 2026-10-01 - Kilo (Registre et fournisseurs : catalogue, alias d'env, routage Xiaomi, Path B)

- **Catalogue passé à 38 entrées** avec l'arrivée de Z.ai GLM et MoonshotAI Kimi en passerelle seule, sur la base des documentations officielles de chaque amont, et non d'une mémoire. Points non confirmés par un appel réel sont déclarés comme tels dans le registre et dans le journal. Une **rupture assumée** : deux ids de catalogue changent, donc une configuration qui les épingle reçoit un 503 ; c'est une raison de release mineure et non patch.
- **Les zones non vérifiées à la compilation** ont été identifiées nommément : une famille non déclarée fait tomber une entrée en fail-soft avec un simple warning, une variable d'environnement oubliée dans une table est ignorée sans erreur visible. Chacune a reçu son test d'inventaire.
- **Alias d'environnement nus** (`<VENDOR>_API_KEY`) acceptés au même rang que le nom préfixé, jamais en dessous : c'est la même source, donc un alias défini doit continuer à gagner sur le fichier, et quand les deux sont posés le nom préfixé gagne pour préserver strictement l'existant. Source de vérité du scan : `API_KEY_SECRETS`, donc un vendor ajouté là est découvert sans seconde table.
- **Auto-routage Xiaomi** : les clusters upstream sont disjoints, `sk-*` et `tp-*` ne sont valides que sur le leur, et le catalogue pointait sur le mauvais pour les clés standard, d'où des 401 sans message exploitable. Les relais privés hors domaine officiel sont préservés intacts.
- **Ordre du tableau `models`** = ordre de synthèse du catalogue de la gateway, épinglé par un test : les nouveaux modèles vont en fin de tableau.

### 2026-10-01 - Kilo (Audits de cohérence : i18n, liens, scripts de publication)

- **Trois clés i18n référencées depuis des mois n'ont jamais été ajoutées à la table.** Mode d'échec silencieux : `t()` retourne la clé brute et **avant** d'appliquer les substitutions `{0}`. Un toast affichait donc la clé avec l'id de modèle silencieusement perdu. Même mode d'échec qu'une clé vendor manquante trouvée plus tôt : ni erreur de compilation, ni test en échec.
- **Le test qui figeait le bug** est la partie la plus instructive : une assertion attendait explicitement le message contenant la clé brute, avec un commentaire justifiant l'attente par l'absence de la clé. Ajouter la clé a cassé l'assertion, résultat correct. Une assertion « le bug est le comportement attendu » empêche la correction et donne une fausse confiance.
- **Scanner i18n élargi** aux trois styles de guillemets et aux appels sur la ligne suivante. L'hypothèse « le test laisse passer une clé en guillemets doubles » a été **vérifiée par injection** avant d'affirmer la correction, pas supposée.
- **Contrôle de liens** : la destination seule ne suffit pas, un libellé qui promet un autre fichier passe tous les contrôles. Contrôle des liens dont le texte ressemble à un chemin ajouté, ce qui a sorti 11 liens relatifs cassés. Piège méthodologique rencontré : la première version du script collapsait les espaces multiples, alors que l'algorithme de l'implémentation de référence ne le fait pas, d'où 4 faux positifs avant correction.
- **Chemins de publication convergés** : vérification faite avant de trancher, la CI passait déjà par le même chemin que le packaging, donc l'écart ne touchait que la publication manuelle en local. Correction par convergence (un script `validate` commun) plutôt que par ajout.
- **Test instable** : un port de test dérivé d'un port éphémère choisi par l'OS peut être déjà pris par une autre suite parallèle. Le test lie désormais `port: 0` et relit le port réel après démarrage.
- **Ménage git** : `git branch -d` a refusé une branche portant un commit non fusionné, et cette protection a empêché la perte de contenu qui n'existait que sur elle.

### 2026-10-01 - Kilo (Mono-agent : suppression d'un acteur qui n'existe plus)

L'utilisateur a acté qu'un second acteur n'était plus utilisé dans la gestion du projet.
Le modèle « tech lead / exécutant » a été remplacé par une exécution mono-agent dans les règles d'agent, `ACTION_PLAN.md`, ce fichier et la spec.

**Sur l'écriture de l'historique** : les entrées du 2026-09-02 ont été **réécritées** (retrait du préfixe d'auteur obsolète) plutôt que supprimées, le contenu utile étant conservé.
Raison : un journal qui mentionne un acteur inexistant invite un agent à chercher un partenaire de revue qui n'a plus lieu d'être.
La ligne de décision caduque est conservée et marquée comme telle, pour que l'historique reste lisible.
`resources/pricing.json` n'a pas été touché : ses occurrences du mot sont des ids de modèles OpenRouter, pas des mentions de rôle, et les supprimer aurait cassé le calcul de coût de ces modèles.

### 2026-09-05 - Kilo (Gemini : signature de raisonnement, streaming, et voies BYOK / OAuth)

Période la plus dense du projet, aujourd'hui en grande partie caduque depuis le retrait du transport OAuth.
Conservé parce que plusieurs enseignements restent valides pour la voie BYOK.

- **`thought_signature`** : le client OpenAI-compat ne transporte pas le champ, donc la gateway ne peut le propager que si le client l'échoie. Trois défauts successifs, dans l'ordre :
  1. La gateway émettait la signature comme **enfant** de `functionCall`, alors que l'API Gemini l'attend en **sibling** sur la part, et l'ignorait silencieusement.
  2. Le cache serveur n'était alimenté que sur le chemin non-streaming, alors que le client streame toujours.
  3. Aucun log ne montrait si la signature partait réellement vers l'amont.
  Correction : shape sibling partout, snoop passif des chunks streaming, et une ligne de log dédiée.
- **Leçon** : l'analyse des alternatives a comparé Kilo Code, LiteLLM et OmniRoute, et c'est la comparaison avec des implémentations existantes qui a désigné le cache serveur comme seul remède viable côté gateway, sans toucher au client.
- **Bruit de log** : la couverture de signature était journalisée en `warn` alors que les tours partiels aboutissent tous en 200. Le seuil est passé à « 100 % manquant seulement », le reste en `debug`. Un warn systématique est du bruit qui masque les vrais problèmes.
- **Streaming** : le drainage de l'upstream était utilisé comme chemin principal, ce qui cassait le temps réel. Le `pipeThrough` est redevenu le défaut, le drainage reste en repli sur erreur de pipe, avec un flag pour les liaisons instables.
- **Alternance des rôles et `finish_reason`** : le texte et les `functionCall` d'un même tour assistant doivent tenir dans une seule entrée, et les résultats d'outil consécutifs être fusionnés. `finish_reason: tool_calls` a été propagé sur les quatre sites qui construisent une réponse.

### 2026-09-02 à 2026-09-04 - Kilo (Fondations)

Cartographie complète de la gateway, spec d'intégration du premier fournisseur Google, audit externe confirmant la réutilisation de la gateway existante plutôt qu'une seconde passerelle, et plan initial révisé par la spec.
Mise en place de l'infrastructure de collaboration : `BRAIN.md`, `ACTION_PLAN.md`, hook `pre-commit`, règles d'agent, canal privé.
C'est de cette période que date le modèle de rôles « tech lead / exécutant », remplacé le 2026-10-01 par l'exécution mono-agent.
Première voie BYOK Gemini avec le mode de facturation par profil (`token` vs `plan`) et sa traduction complète dans le dashboard, les exports et la commande de bascule de route.
