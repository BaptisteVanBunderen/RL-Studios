# RL Studio

Application de bureau Windows qui affiche des overlays par-dessus Rocket League (et dans OBS), alimentés en temps réel par la Stats API officielle du jeu.
L'utilisateur dépose des packs d'overlays (HTML/CSS/JS) dans un dossier, les active et les place depuis le client.

Projet Hub Epitech, v1 à 60 h. Refonte complète : l'ancienne version (bridge.js en TCP, overlays en `ws://localhost:8765`) ne sert que de référence.

## Documents de référence — à lire avant de coder une partie

- `docs/architecture.md` : couches, protocole overlay ↔ app, format du manifeste, fenêtres. Source de vérité des décisions.
- `docs/stats-api.md` : comportement RÉEL de l'API observé sur captures. Il contredit la doc officielle sur plusieurs points ; en cas de doute, il fait foi.
- `captures/*.jsonl.gz` : trames réelles pour le rejeu et les tests (liste et contenu décrits dans `docs/stats-api.md`).

## Stack

- Electron + electron-vite, client React + Tailwind.
- TypeScript strict pour `src/main`, `src/preload`, `src/renderer`, `src/core`, `src/game`, `src/server`.
- Overlays (`overlays/`) : HTML/CSS/JS simples, SANS étape de build. Ils doivent rester éditables après installation (electron-builder, `extraResources`).
- `ws` pour les WebSockets, `zod` pour valider manifestes et config, `vitest` pour les tests de `src/core`.

## Commandes

- `npm run dev` — lance l'application en développement (rechargement à chaud)
- `npm run build` — vérifie les types puis compile dans `out/`
- `npm test` — tests vitest de `src/core`, `src/game`, `src/server` (`npm run test:watch` en continu)
- `npm run typecheck` — TypeScript strict, côté main/preload (`tsconfig.node.json`) puis renderer (`tsconfig.web.json`)
- `npm run lint` / `npm run format` — ESLint (interdit `electron` et les autres couches dans `src/core`) et Prettier
- `npm run build:win` / `npm run build:linux` — installeur via electron-builder

Alias d'import : `@core`, `@game`, `@server` (main, preload, vitest) ; `@renderer` et `@core` (client). Déclarés dans `electron.vite.config.ts`, `vitest.config.ts` et les tsconfig : à garder synchronisés.

## Règles non négociables

- Uniquement la Stats API officielle. Aucune injection, aucun hook du processus du jeu (anti-cheat EAC).
- `Data` des messages du jeu = string JSON → double `JSON.parse`. Les commandes envoyées au jeu ont `Data` en OBJET, sur le WebSocket 49124 (le TCP ne marche pas pour les commandes).
- Joueur local = `Game.Target` hors replay, mémorisé par `PrimaryId`. Jamais `bHasCar`.
- Résultat d'un match : `MatchEnded` → sinon `StatfeedEvent Win` → sinon défaite. JAMAIS le score seul.
- Ignorer les `GoalScored` dont `Scorer.Name` est vide (but fantôme de fin de replay) et ne pas utiliser `ImpactLocation`.
- Score de référence = `Game.Teams[].Score` (l'admin peut le modifier sans event).
- Replay d'historique (`Game.Frame` présent) : aucun effet sur la session ; résultats dédoublonnés par `MatchGuid`.
- Session : on exclut seulement le freeplay (PlaylistId 9) et les replays. Les parties privées comptent (scores de BO).
- `Game.Winner` est un nom d'équipe (parfois censuré) : utiliser `WinnerTeamNum` / `TeamNum`.
- Serveur d'overlays et tout socket local : écoute sur `127.0.0.1` uniquement.
- Fenêtres d'overlay : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, pas de preload. Un overlay n'a accès qu'au SDK.
- `src/core` ne dépend pas d'Electron : tout y est testable en Node avec les captures.

## Conventions

- Interface, messages utilisateur et commentaires en français ; identifiants de code en anglais.
- Types des events du jeu et des messages overlay définis une seule fois dans `src/core`, partagés partout.
- Pas de nouvelle dépendance sans le signaler et expliquer pourquoi.

## Tests

- Les captures servent d'oracle. Résultats attendus :
  - `2026-10-01_match-complet` → victoire (équipe 1 gagne, joueur local THEVBAT en équipe 1)
  - `2026-10-01_abandon` → défaite (quitté en menant 1-0, aucun `MatchEnded`)
  - `2026-10-01_prive-admin` → victoire (score modifié par l'admin, `MatchEnded` vainqueur 1)
  - `2026-10-01_replay-historique` → aucun résultat compté
  - `2026-10-02_session-7-matchs-ff` → les 7 résultats de `…matches.jsonl` (champ `ruleResult`)
- Rejeu : `ReplaySource` lit `.jsonl` et `.jsonl.gz` en respectant `t`, avec un facteur de vitesse.

## Mode de travail

- Je veux écrire une bonne partie du code moi-même. Par défaut : explique l'approche et les concepts (pas les bases du langage), propose une structure, laisse-moi coder, puis relis et corrige.
- Si je dis explicitement « fais-le » ou « implémente », tu peux écrire le code complet.
- Réponds en français.
- Git : c'est toujours moi qui fais les commits et les push. Ne jamais lancer `git commit` ni `git push` ; propose seulement un message de commit si utile.
- Avant de toucher à un point couvert par `docs/`, relis la section concernée. Si une décision doit changer, dis-le et mets à jour le doc dans le même changement.

## Planning

- Tableau Trello « RL Studio — Roadmap HUB (60h) » : https://trello.com/b/GlsRzOVp/rl-studio-roadmap-hub-60h — une liste par partie (P0 à P7), une carte par tâche.
- Suivis Hub : 7 octobre (P0-P1), 21 octobre (P2-P4), 4 novembre 2026 = rendu final (P5-P7). Échéance interne : P5 et P6 finies le 30 octobre.
- Hors périmètre v1 : historique des parties, stats par joueur, héritage des réglages pack/modules, gestion de la caméra.

## État actuel

> À mettre à jour à la fin de chaque session de travail (ce qui est fait, ce qui est en cours, les blocages).

- P0 terminée (2026-10-02) : API étudiée, captures de référence, architecture et manifeste décidés.
- P1, carte « Initialisation du projet » terminée (2026-10-06) : electron-vite (React + TS), Tailwind v4, vitest, zod, ws, ESLint/Prettier, alias, `electron-builder.yml` (`extraResources` pour `overlays/`). `npm run dev`, `test`, `typecheck` et `lint` passent.
- Prochaine étape : carte suivante de la liste P1 sur Trello.
