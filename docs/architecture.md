# RL Studio v1 — Architecture et format du manifeste

Décidé pendant la P0 (2026-10-01/02). Les faits sur l'API sont dans `stats-api.md`.

## Principe directeur : un seul chemin pour les overlays

Le processus principal embarque un **serveur local HTTP + WebSocket** (127.0.0.1 uniquement, port par défaut 49200, configurable).
Il sert à la fois les fichiers des packs, un petit SDK JavaScript et le flux de données.

Un overlay a donc une URL, par exemple `http://127.0.0.1:49200/overlay/session-tracker/bar`, et c'est la même URL partout :

- dans RL Studio, la fenêtre d'overlay transparente charge cette URL ;
- dans OBS, on colle cette URL dans une source navigateur (bouton « Copier l'URL OBS » dans le client) ;
- pendant le développement d'un overlay, on l'ouvre dans un navigateur, avec le rejeu de captures.

Conséquences :

- un overlay se comporte exactement pareil dans l'app et dans OBS, il n'y a qu'un protocole à documenter ;
- les fenêtres d'overlay n'ont pas besoin de preload ni d'accès Node : `contextIsolation`, `sandbox`, pas de `nodeIntegration`. Du code de pack tiers ne peut rien faire d'autre qu'afficher ;
- la « couche d'exposition dédiée aux overlays » de la roadmap = ce SDK, pas un preload.

## Couches du processus principal (TypeScript)

```
 Rocket League ──WS 49124──► GameConnection ─┐        ReplaySource (.jsonl / .jsonl.gz) ─┐
       ▲                      (statut, reconnexion)                                       │
       │ commandes (SetHUDVisibility)        └──────► FrameSource ◄───────────────────────┘
       │ même socket, Data en objet                       │ trames brutes
       │                                         Recorder (option : écrit .jsonl)
       │                                                  ▼
       │                                           normalize()  ── double parse de Data, events typés,
       │                                                  │        filtres (but fantôme, CrossbarHit, replay)
       │                                                  ▼
       │                                           MatchTracker ── état du match, joueur local (Target → PrimaryId),
       │                                                  │        règle de résultat
       │                                                  ▼
       │                                           SessionStore ── victoires/défaites/séries, filtre PlaylistId,
       │                                                  │        dédoublonnage par MatchGuid
       │                                                  ▼
       └──────────────────────────────────────────  OverlayServer ── HTTP (packs + SDK) + WS (topics), état courant à la connexion
                                                          ▲
 PackLoader ── scanne /overlays, valide les manifestes ───┤
 ConfigStore ── positions, tailles, modules actifs, valeurs de réglages, raccourci, joueur local, ports
 OverlayWindowManager ── fenêtres transparentes, ancres, multi-écrans, mode édition
 GameSetup ── détection Steam/Epic, lecture/écriture de l'ini (+ sauvegarde), relance du jeu
 ipc/ ── canaux typés main ↔ client React
```

- `FrameSource` est une interface : connexion au jeu ou rejeu d'une capture (en respectant `t`). Le reste de la chaîne ne voit pas la différence.
- `normalize()`, `MatchTracker` et `SessionStore` sont du TypeScript pur, sans Electron → testables directement avec les captures de `captures/`.
- `normalize(raw)` est une fonction PURE, sans état : elle renvoie `null` pour tout message ignoré (illisible, type non géré, schéma non respecté, but fantôme, `CrossbarHit` de force ≤ 0). Le dédoublonnage des rafales de `CrossbarHit` demande de mémoriser le précédent : il est dans `createCrossbarDedupe()` (`src/core/dedupe.ts`), un filtre à état à créer par flux de trames.
- Deux niveaux de types dans `src/core` : schémas zod du brut de l'API (`schemas.ts`, internes, champs utilisés seulement, champs inconnus tolérés) et contrat normalisé en camelCase (`events.ts`, partagé avec le serveur et les overlays).
- `FrameSource` (`src/game/FrameSource.ts`) : `onFrame`, `start`, `stop`. Le format des trames de capture (`RawFrame { t, raw }`) et son parsing pur (`parseCaptureText`) sont dans `src/core` ; la lecture de fichier et le gunzip sont dans `ReplaySource`, pour que `core` n'accède pas au disque. `ReplaySource` compare chaque trame à l'horloge réelle (pas de dérive cumulée) ; `speed: Infinity` émet tout d'un coup (tests).
- `GameConnection` (`src/game/GameConnection.ts`) implémente `FrameSource` sur `ws://127.0.0.1:49124` (IPv4 explicite : `localhost` peut se résoudre en `::1`). Les trames sont horodatées comme une capture (`t` = ms depuis `start()`). Reconnexion sans fin, attente doublée de 1 s jusqu'à 5 s, remise à 1 s après une connexion réussie. Son statut est binaire (`connected` / `disconnected`) : la distinction `game-closed` / `api-disabled` demande la détection du processus du jeu (P5).
- `StatsPipeline` (`src/core/pipeline.ts`) relie `normalize` → `createCrossbarDedupe` → `MatchTracker` → `SessionStore` et notifie par callbacks (`onMatch`, `onSession`, `onEvent`). Pure, indépendante de la source et du serveur : c'est le processus principal qui branche `source.onFrame → pipeline.feed` et `pipeline → server.publish`. Ordre de notification pour une même trame : match, puis session, puis event (un overlay qui réagit à `matchEnded` lit déjà le nouveau compteur).
- `MatchTracker` (`src/core/MatchTracker.ts`) : le match naît de la première trame d'état (elles précèdent parfois `MatchCreated`). Un replay d'historique est actif de `ReplayCreated` (ou d'une trame avec `Game.Frame`) jusqu'à la première trame d'état sans `Frame` : pendant ce temps AUCUN effet (ni état, ni résultat, ni event vers les overlays, ni apprentissage du joueur). Un nouveau GUID (ou un changement de mode quand un GUID est vide) sans `MatchDestroyed` clôt l'ancien match comme abandonné. Sans équipe connue pour le joueur local, un `MatchEnded` ne produit pas de résultat (on ne devine pas).

## Statut de connexion (P5)

- `game-closed` : processus du jeu absent.
- `api-disabled` : jeu lancé mais port 49124 injoignable (ini non configuré ou modifié sans relance).
- `connected` : connexion WS établie.

`GameConnection` ne connaît que `connected` / `disconnected` ; le passage à ces trois statuts (détection du processus du jeu) est à faire en P5. En attendant, un lien coupé est publié comme `game-closed`.

## Commandes vers le jeu (P5)

- Envoyées sur la même connexion WebSocket que la réception des events (49124).
- Format : `{ "Command": "SetHUDVisibility", "Data": { "bVisible": false } }` — `Data` en OBJET (en string ou en TCP : aucun effet).

## Règle de résultat et filtre de session

1. `MatchEnded` reçu → `WinnerTeamNum` comparé à l'équipe du joueur local au moment de la fin (couvre aussi les ff).
2. Sinon, si un `StatfeedEvent Win` a été reçu → vainqueur déduit de l'équipe du gagnant.
3. Sinon → défaite (le joueur a quitté avant la fin).
   Ne jamais déduire le résultat du seul score.

Filtre : liste d'exclusion, pour que les modes non encore vus (extra modes, tournois) comptent par défaut.

- Exclus : PlaylistId 9 (freeplay) et les replays d'historique (`Game.Frame` présent). Le replay est écarté en amont par `MatchTracker` ; le freeplay est écarté par `SessionStore` (`EXCLUDED_PLAYLIST_IDS`).
- `SessionStore` dédoublonne par `MatchGuid` (les GUID comptés survivent à `reset()`) ; un GUID vide ne sert pas de clé.
- `streak` est signée : > 0 victoires d'affilée, < 0 défaites d'affilée, 0 sans résultat ; `bestStreak` = meilleure série de victoires.
- Les parties privées (6) COMPTENT : elles servent au score des BO. Score d'un BO = compteur de session remis à zéro avant la série.
- Chaque résultat transmis aux overlays porte son `playlistId`, pour qu'un overlay puisse distinguer privé / en ligne.

## Arborescence du dépôt

```
src/
  main/          processus principal : index.ts (cycle de vie, seul fichier qui lance Electron),
                 services.ts (relie tout, sans Electron), ipc/, config/ConfigStore, packs/PackLoader, windows/ (P3)
  core/          normalize, MatchTracker, SessionStore, manifeste, config, types IPC (sans dépendance Electron)
  game/          GameConnection, ReplaySource, Recorder, GameSetup
  server/        OverlayServer (HTTP + WebSocket), routes, safePath, sdk/rlstudio.js (embarqué tel quel)
  preload/       preload du client uniquement
  renderer/      client React + Tailwind
overlays/        packs (extraResources → reste éditable après installation) ; `example/` = pack de démonstration du SDK
captures/        trames de référence (.jsonl.gz) pour le rejeu et les tests
tools/           scripts autonomes : capture, observation, test des commandes
docs/            architecture, constats API, guide de création d'overlay (P7)
```

## Format du manifeste (`overlays/<pack-id>/manifest.json`)

```json
{
  "manifestVersion": 1,
  "name": "Session Tracker",
  "description": "Victoires, défaites et séries en temps réel",
  "author": "THEVBAT",
  "version": "1.0.0",
  "preview": "preview.png",
  "modules": [
    {
      "id": "bar",
      "name": "Session Bar",
      "description": "Winrate, victoires, défaites, série, meilleure série",
      "entry": "modules/bar.html",
      "size": { "width": 425, "height": 48 },
      "defaultPosition": { "anchor": "top-right", "x": 20, "y": 0 },
      "data": ["session"],
      "settings": [
        {
          "key": "showBest",
          "type": "boolean",
          "label": "Afficher la meilleure série",
          "default": true
        },
        {
          "key": "winColor",
          "type": "color",
          "label": "Couleur des victoires",
          "default": "#4cdb8a"
        },
        {
          "key": "bgOpacity",
          "type": "range",
          "label": "Opacité du fond",
          "min": 0,
          "max": 1,
          "step": 0.05,
          "default": 0.93
        },
        {
          "key": "goodWinrate",
          "type": "number",
          "label": "Winrate « vert » à partir de (%)",
          "min": 0,
          "max": 100,
          "default": 60
        },
        { "key": "title", "type": "text", "label": "Titre", "default": "", "maxLength": 24 },
        {
          "key": "streakIcon",
          "type": "select",
          "label": "Icône de série",
          "default": "fire",
          "options": [
            { "value": "fire", "label": "Feu" },
            { "value": "bolt", "label": "Éclair" }
          ]
        }
      ]
    }
  ]
}
```

### Règles

- Identifiant du pack = nom du dossier (pas de champ `id`). Identifiants de pack et de module : `[a-z0-9-]`, module unique dans son pack.
- `entry` : chemin relatif au dossier du pack, interdit de sortir du dossier (`..`, chemin absolu).
- `size` : taille de référence en pixels logiques. L'utilisateur règle une échelle ; les proportions restent verrouillées et le contenu est mis à l'échelle (zoom de la page).
- `defaultPosition.anchor` : `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`. `x`/`y` = décalage depuis l'ancre, vers l'intérieur de l'écran, en pixels logiques (indépendant de la mise à l'échelle Windows).
- `data` : topics dont le module a besoin, avec les MÊMES noms que les topics du protocole : `session`, `match`, `event`, `connection` (au singulier pour `event` ; ce document disait `events` par erreur). Le serveur n'envoie que ceux-là ; `settings` est toujours envoyé et ne se liste pas.
- Validation au chargement (zod, `src/core/manifest.ts`) : un pack invalide apparaît dans la bibliothèque avec son erreur, il n'est pas chargé. Clé inconnue = avertissement, pas une erreur. Messages en français avec le chemin du champ (`modules[0].size.width : …`).
- Champs facultatifs et valeurs par défaut : `description`, `author` → vides ; `defaultPosition` → `top-left` 0/0 ; `data`, `settings` → vides. Obligatoires : `manifestVersion` (= 1), `name`, `version` (semver), au moins un module avec `id`, `name`, `entry`, `size`.
- Contrôles de cohérence : identifiants de module et clés de réglage uniques ; `default` d'un réglage dans ses bornes / ses options / `maxLength` ; couleur `#rrggbb[aa]`.
- `entry` et `preview` : refus lexical (`..`, `/x`, `\x`, `C:\x`) à la validation, puis sur disque (`PackLoader`) : le fichier doit exister, être un fichier et rester dans le pack APRÈS résolution des liens symboliques. Un `preview` introuvable est un avertissement ; une page d'entrée introuvable est une erreur.
- `PackLoader` : un sous-dossier de `overlays/` = un pack, identifiant = nom du dossier (`[a-z0-9-]`, sinon pack invalide). Les fichiers et dossiers cachés sont ignorés. Un `manifest.json` avec BOM UTF-8 (éditeurs Windows) est accepté ; au-delà de 1 Mo il est refusé. Un pack cassé n'empêche pas les autres de se charger ; l'actualisation est à la demande (bouton du client), pas surveillée.

### Les six types de réglages (P4)

| type      | champs                                           | valeur                            |
| --------- | ------------------------------------------------ | --------------------------------- |
| `text`    | `default`, `maxLength?`                          | string                            |
| `number`  | `default`, `min?`, `max?`, `step?`, `unit?`      | number (compteur − / +)           |
| `boolean` | `default`                                        | boolean (interrupteur)            |
| `color`   | `default` (`#rrggbb` ou `#rrggbbaa`), `palette?` | string (pastilles + valeur libre) |
| `enum`    | `default`, `options`                             | une des valeurs                   |
| `range`   | `default`, `min`, `max`, `step?`, `unit?`        | number (curseur)                  |

Communs : `key` (unique dans le module), `label`, `description?`.

- `enum` : `select` reste accepté comme alias et ressort sous le nom `enum`. Une option s'écrit `"compacte"` ou `{ "value": "compacte", "label": "Compacte" }` ; une chaîne devient `{ value, label }` avec une majuscule au libellé. Le client et les overlays ne voient que la forme canonique. Le client affiche des boutons exclusifs pour 2 à 4 options, une liste déroulante au-delà.
- `palette` (couleur) : 1 à 12 couleurs proposées en un clic ; la valeur reste libre et le défaut n'a pas à en faire partie. Sans palette, le client en propose quatre.
- `unit` (nombre, curseur) : 8 caractères au plus. Un curseur 0–1 avec `"unit": "%"` est affiché en pourcentage.
- Valeurs de l'utilisateur : `config.modules[<pack>/<module>].settings`. À l'enregistrement (`services.setModuleSetting`) la valeur est validée contre la définition (type, bornes, `maxLength`, couleur, options) ; refusée avec un message français sinon. À la lecture (`resolveSettings`, `src/core/settings.ts`) une valeur devenue invalide (manifeste modifié depuis) est remplacée par le `default`, un réglage ajouté reçoit son défaut, un réglage supprimé est ignoré.
- Mise à jour à chaud : `setModuleSetting` envoie les valeurs effectives aux overlays ouverts de ce module (`server.publishSettings`), sans rechargement de leur page ; un overlay qui se connecte ensuite reçoit les valeurs enregistrées.
- **Pas d'héritage pack → module en v1** : pas de réglages communs à un pack, pas de « hérité du pack ». La maquette le montre ; c'est hors périmètre (voir `CLAUDE.md`).

### Changements par rapport au manifeste de la première version

- `id` supprimé (vient du dossier) ; `version` en semver ; `author` ajouté.
- `defaultX`/`defaultY` absolus (1475, 0 pensés pour du 1920×1080) → ancre + décalage.
- `entry` explicite au lieu de `modules/<id>.html` implicite.
- `data` et `settings` ajoutés.

## Protocole overlay ↔ RL Studio (WebSocket `/ws`)

Le SDK s'inclut dans l'overlay avec `<script src="/sdk/rlstudio.js"></script>` (même origine, fonctionne dans l'app et dans OBS) et gère connexion, reconnexion et identification du module à partir de l'URL.

```js
RLStudio.on('settings', (values) => {
  /* au démarrage puis à chaque modification, sans rechargement */
})
RLStudio.on('session', (s) => {
  /* { wins, losses, streak, bestStreak, lastResult: { won, playlistId } | null } */
})
RLStudio.on('match', (m) => {
  /* état normalisé du match, ≤ 30/s */
})
RLStudio.on('event', (e) => {
  /* { type: 'goal' | 'matchEnded' | 'statfeed' | ..., ... } */
})
RLStudio.on('connection', (c) => {
  /* { status: 'game-closed' | 'api-disabled' | 'connected' } */
})
```

Messages sur le fil : `{ "v": 1, "type": "<topic>", "payload": { ... } }`.

Connexion : `ws://127.0.0.1:<port>/ws?module=<pack>/<module>`. Le SDK la construit seul d'après l'URL de la page (`/overlay/<pack>/<module>`). Les topics reçus sont ceux du champ `data` du manifeste du module ; un module ou un pack inconnu est refusé (404). Pour les outils de développement, `?topics=session,match` impose les topics (il l'emporte sur `data`) ; sans `module` ni `topics`, tous les topics. Un nom de topic inconnu est refusé (400) pour révéler les fautes de frappe.

`settings` est PROPRE À CHAQUE MODULE : ce n'est pas un topic global. À la connexion le serveur envoie d'abord les réglages du module (défauts du manifeste, plus tard les valeurs de l'utilisateur, P4), puis la dernière valeur connue de chaque topic d'ÉTAT demandé (`session`, `match`, `connection`), dans cet ordre. `server.publishSettings(<pack>/<module>, valeurs)` pousse de nouveaux réglages aux overlays ouverts de ce module, sans rechargement. Les clients sans `module` ne reçoivent aucun `settings`. Le topic `event` est un flux ponctuel : il n'est JAMAIS rejoué (un overlay qui se connecte ne doit pas revoir un but vieux de dix minutes). `match` vaut `null` entre deux matchs (valeur d'état à part entière, renvoyée aussi à la connexion).

Routes HTTP du même serveur (`src/server/routes.ts`), méthodes GET et HEAD seulement (sinon 405) :

- `/sdk/rlstudio.js` : le SDK, servi tel quel. Il est embarqué dans le processus principal (`import … ?raw`) : pas de chemin à résoudre dans l'application installée, pas d'`extraResources` pour lui.
- `/overlay/<pack>/<module>` : la page d'entrée du module, avec un `<base href>` injecté (dossier du fichier d'entrée) pour que ses URL relatives (`session.css`, `../img/x.png`) fonctionnent alors que la page est servie sans extension. Les commentaires HTML sont ignorés pour la détection de `<head>` et d'un `<base>` existant (une page qui définit déjà son `<base>` est laissée telle quelle).
- `/overlay/<pack>/<chemin>` : un fichier du pack (styles, scripts, images, polices, sons), avec le bon `Content-Type`, `Cache-Control: no-store` (les packs sont éditables : toujours la version du disque) et `nosniff`. Un identifiant de module prime sur un fichier de même nom.
- Le reste : 404. Chemins refusés (400/404) : segment `..` ou `.`, segments vides (`//`), `\`, `/` ou `:` après décodage (lecteurs Windows, flux NTFS), octet nul, pourcentage mal formé. Le chemin est ensuite résolu avec `realpath` et doit rester dans le dossier du pack (liens symboliques sortants refusés, `pack-evil` ne passe pas pour un sous-dossier de `pack`).

Contenu des topics (types dans `src/core/protocol.ts`, `match.ts`, `session.ts`) :

- `match` : `MatchState` (GUID, mode, statut `inProgress`/`ended`, temps, prolongation, replay de but en cours, scores par équipe = `Game.Teams[].Score`, joueurs, `localPlayerId`, `myTeamNum`, `winnerTeamNum`). Limité à 30 messages/s : un envoi immédiat, puis seule la dernière valeur est retenue et envoyée à l'échéance (la valeur finale n'est jamais perdue). Un client trop lent (> 1 Mo en attente) saute des `match`.
- `event` : tout sauf l'état périodique (→ `match`), l'horloge (incluse dans `match`) et `replayCreated` (interne). Jamais pendant un replay d'historique.

Sécurité : le serveur n'écoute que sur 127.0.0.1 (adresse non configurable). Un site web peut ouvrir un WebSocket vers 127.0.0.1 depuis le navigateur de l'utilisateur : une connexion avec un en-tête `Origin` autre que `http://127.0.0.1:<port>` ou `http://localhost:<port>` est refusée (403) ; sans `Origin` (clients non navigateur) elle est acceptée. Chemin autre que `/ws` : 404. Les messages reçus des overlays sont ignorés (taille max 1 Ko).

Pas de commandes depuis un overlay en v1 : le reset de session passe dans le client. Raison : en OBS, l'overlay n'est pas cliquable, et ça évite qu'un pack tiers agisse sur l'état.

## Processus principal et client (P2)

- `src/main/index.ts` est le seul fichier qui lance Electron : instance unique (`requestSingleInstanceLock`, deux instances se disputeraient le port), création de la fenêtre du client, arrêt propre. Tout le reste vit dans `Services` (`src/main/services.ts`), sans dépendance à Electron donc testable en Node avec un faux jeu.
- `Services` crée et relie : `ConfigStore`, `PackLoader`, `OverlayServer`, `StatsPipeline`, `GameConnection`. Démarrage : packs → serveur (échec = erreur en français, la connexion au jeu n'est pas démarrée) → connexion au jeu. Arrêt : connexion → serveur et ses clients (WebSocket fermés en 1001, connexions HTTP coupées) → fin des écritures de config. `before-quit` suspend la fermeture le temps de cet arrêt.
- Fermer la fenêtre du client quitte l'application (les overlays en dépendent). Port pris au démarrage : boîte de dialogue qui indique le port et le fichier de config où le changer.
- Config (`ConfigStore`, `<userData>/config.json`) : ports du serveur d'overlays (49200) et de l'API (49124), `localPlayerId` (mémorisé dès que `Game.Target` le désigne), `modules[<pack>/<module>].enabled`. Fichier absent → défauts ; invalide champ par champ → ce champ redevient son défaut sans perdre les autres ; JSON illisible → défauts et copie du fichier en `.bak` (le client prévient) ; clés inconnues conservées ; écritures atomiques (fichier temporaire puis renommage) et sérialisées.
- Les valeurs par défaut des ports sont codées dans `src/core/config.ts` ET dans `GameConnection` : un test les compare.
- IPC typé (`src/core/ipc.ts`, canaux dans `ipcChannels.ts`, sans import pour que le preload puisse l'utiliser) : requêtes `app:get-state`, `packs:reload`, `packs:set-enabled` (tous les modules d'un pack en une écriture), `modules:set-enabled`, `modules:set-placement` (position et/ou échelle, `null` = rétablir), `modules:set-setting`, `session:adjust` (corriger victoires, défaites, série), `session:reset`, `shell:open-overlays-folder` ; notifications `app:connection`, `app:session`, `app:packs`. Le preload n'expose que `window.rlstudio` (jamais `ipcRenderer`) ; la fenêtre du client est en `contextIsolation` et `sandbox`. Le main vérifie que l'appel vient de la fenêtre du client et revalide les arguments (zod). Rien de ce qui traverse l'IPC ne contient de chemin absolu.
- `AppState` contient aussi `display` (écran principal : zone utilisable en pixels logiques et libellé, ex. « Principal — 2560 × 1440 ») et `gamePort`. Chaque `ModuleSummary` porte `position` et `defaultPosition` (ancre + décalage), `scale` et `values` (valeurs effectives des réglages).
- Activer un module (`modules:set-enabled`) mémorise le choix et notifie `app:packs` ; `OverlayWindowManager` s'abonne à `services.onPacks` (voir la section suivante) et ouvre ou ferme la fenêtre.

### Client React (`src/renderer/`)

Interface de la maquette (direction A : fond sombre, bleu = victoires et états sains, orange = actions et série). Le client ne parle au processus principal que par `window.rlstudio`.

- Navigation par un simple état (`View` : bibliothèque, pack, module, réglages du jeu), sans routeur. Contexte `AppContext` : l'état de l'application, `go`, `report` ; toute action passe par `useAction`, qui montre l'erreur à l'utilisateur (jamais avalée en silence).
- **Bibliothèque** : cartes de packs ; l'interrupteur d'une carte active ou désactive TOUS les modules du pack (allumé = au moins un module actif ; un clic éteint tout, ou allume tout si rien n'est actif) ; carte « Ajouter un overlay » (ouvre le dossier) ; barre de session (victoires, défaites réglables à la main, remise à zéro) ; pastille de connexion.
- **Pack** : un module par ligne, interrupteur par module ; « Tout activer / Tout désactiver ».
- **Module** : aperçu en direct, position (X, Y), échelle, réglages, session. L'aperçu est la VRAIE page de l'overlay dans une `iframe` (`sandbox="allow-scripts allow-same-origin"`, origine du serveur local, `color-scheme: normal` pour garder le fond transparent) : mêmes données, mêmes réglages, mise à jour à chaud comprise. Elle compte comme un client WebSocket de plus.
- X et Y affichés sont la position réelle de la fenêtre (`placeInArea`) ; on mémorise toujours ancre + décalage : modifier X ou Y recalcule le décalage depuis la même ancre (`offsetFromPosition`, inverse exact de `placeInArea`, y compris sur les axes centrés dont le milieu tombe sur une demi-unité).
- Sécurité du client : la politique de contenu n'autorise que `127.0.0.1` (iframe d'aperçu et images d'aperçu des packs), aucune autre connexion réseau.
- Polices : Archivo / IBM Plex de la maquette pas encore embarquées, repli sur des polices système (à remplacer à la fin, sans impact sur le reste).
- Pas encore fait : « Placer à la souris » (bouton désactivé), choix de l'écran (un seul : le principal), réglages du jeu au-delà du statut (installation, ini, raccourci : P5).

## Fenêtres d'overlay (P2/P3)

`OverlayWindowManager` (`src/main/windows/`) : une fenêtre par module activé. Toute la logique est sans Electron (testée avec de fausses fenêtres) ; seul `electronHost.ts` crée les vraies fenêtres.

- `sync(packs)` à chaque `onPacks` : ouvre les modules activés qui manquent, ferme les autres, déplace / redimensionne ceux dont la position, l'échelle ou la taille ont changé (sans réouverture). Un changement d'écran (`display-metrics-changed`, écran branché ou débranché) recalcule toutes les positions. Une fenêtre fermée par le système est oubliée puis rouverte au prochain `sync`. Une page dont le rendu plante est rechargée, 3 fois au plus.
- Options de fenêtre : transparente (`backgroundColor` `#00000000`), sans cadre, sans ombre, non redimensionnable, `skipTaskbar`, `focusable: false` (ne prend jamais le clavier du jeu), `alwaysOnTop` niveau `screen-saver` (réaffirmé à l'affichage), `setIgnoreMouseEvents(true)` (les clics traversent), `backgroundThrottling: false` (animations non ralenties quand le jeu recouvre la fenêtre). Affichage par `showInactive()` sur `ready-to-show` : `show()` volerait le focus au jeu.
- Isolation (code de pack tiers) : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, pas de preload ; une session EN MÉMOIRE propre à chaque module (`partition: overlay:<pack>/<module>`) : stockage non partagé entre packs, zoom indépendant, aucune permission accordée ; ni nouvelle fenêtre, ni navigation hors du serveur local.
- Échelle : `setZoomFactor` (zoom de la page, proportions conservées) et fenêtre à `size × scale`.
- Placement (`placeInArea`, `src/core/placement.ts`, pur) : ancre + décalage dans la zone de travail de l'écran PRINCIPAL (hors barre des tâches). `x`/`y` vont vers l'intérieur : ancre à gauche/en haut → vers la droite/le bas ; ancre à droite/en bas → vers la gauche/le haut ; axe centré (`top`, `bottom`, `left`, `right`, `center` sur l'axe concerné) → positif vers la droite/le bas. Le résultat est toujours ramené dans la zone : un overlay ne peut pas être perdu hors de l'écran. Coordonnées en pixels logiques d'Electron : la mise à l'échelle de Windows est gérée par Electron.
- Config par module (`config.modules[<pack>/<module>]`) : `enabled`, `position?` (ancre + décalage), `scale?` (0,25 à 4). Absents : position du manifeste, échelle 1. `services.setModulePlacement(key, { position, scale })` les modifie (`null` = rétablir) ; c'est ce qu'appellera le mode édition.
- Limite connue : l'overlay est une fenêtre normale posée au-dessus (aucune injection, EAC). Il n'apparaît PAS si Rocket League est en plein écran exclusif : il faut le mode fenêtré ou sans bordure.
- Hors périmètre pour l'instant (cartes P3 suivantes) : choix de l'écran (multi-écrans), mode édition à la souris, redimensionnement à la souris, raccourci global.

À venir (P3) :

- Mode édition : souris activée, glisser-déposer (CSS `-webkit-app-region: drag` injecté par `insertCSS`), la position est recalculée en ancre + décalage et renvoyée au client.
- Le raccourci global masque les fenêtres d'overlay de l'app ; il n'agit pas sur OBS (OBS gère ses propres sources).
