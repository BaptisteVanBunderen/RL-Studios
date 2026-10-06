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

## Statut de connexion (P5)

- `game-closed` : processus du jeu absent.
- `api-disabled` : jeu lancé mais port 49124 injoignable (ini non configuré ou modifié sans relance).
- `connected` : connexion WS établie.

## Commandes vers le jeu (P5)

- Envoyées sur la même connexion WebSocket que la réception des events (49124).
- Format : `{ "Command": "SetHUDVisibility", "Data": { "bVisible": false } }` — `Data` en OBJET (en string ou en TCP : aucun effet).

## Règle de résultat et filtre de session

1. `MatchEnded` reçu → `WinnerTeamNum` comparé à l'équipe du joueur local au moment de la fin (couvre aussi les ff).
2. Sinon, si un `StatfeedEvent Win` a été reçu → vainqueur déduit de l'équipe du gagnant.
3. Sinon → défaite (le joueur a quitté avant la fin).
   Ne jamais déduire le résultat du seul score.

Filtre : liste d'exclusion, pour que les modes non encore vus (extra modes, tournois) comptent par défaut.

- Exclus : PlaylistId 9 (freeplay) et les replays d'historique (`Game.Frame` présent).
- Les parties privées (6) COMPTENT : elles servent au score des BO. Score d'un BO = compteur de session remis à zéro avant la série.
- Chaque résultat transmis aux overlays porte son `playlistId`, pour qu'un overlay puisse distinguer privé / en ligne.

## Arborescence du dépôt

```
src/
  main/          processus principal (index.ts, ipc/, windows/, config/)
  core/          normalize, MatchTracker, SessionStore, types des events (sans dépendance Electron)
  game/          GameConnection, ReplaySource, Recorder, GameSetup
  server/        OverlayServer, sdk/rlstudio.js (servi tel quel)
  preload/       preload du client uniquement
  renderer/      client React + Tailwind
overlays/        packs (extraResources → reste éditable après installation)
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
- `data` : topics dont le module a besoin (`session`, `match`, `events`, `connection`). Le serveur n'envoie que ceux-là ; `settings` est toujours envoyé.
- Validation au chargement (zod) : un pack invalide apparaît dans la bibliothèque avec son erreur, il n'est pas chargé. Clé inconnue = avertissement, pas une erreur.

### Les six types de réglages (P4)

| type      | champs                               | valeur           |
| --------- | ------------------------------------ | ---------------- |
| `text`    | `default`, `maxLength?`              | string           |
| `number`  | `default`, `min?`, `max?`, `step?`   | number           |
| `boolean` | `default`                            | boolean          |
| `color`   | `default` (`#rrggbb` ou `#rrggbbaa`) | string           |
| `select`  | `default`, `options[{value,label}]`  | une des `value`  |
| `range`   | `default`, `min`, `max`, `step?`     | number (curseur) |

Communs : `key` (unique dans le module), `label`, `description?`. Une valeur sauvegardée invalide (manifeste modifié depuis) est remplacée par le `default`.

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
À la connexion, le serveur envoie immédiatement la dernière valeur connue de chaque topic demandé.

Pas de commandes depuis un overlay en v1 : le reset de session passe dans le client. Raison : en OBS, l'overlay n'est pas cliquable, et ça évite qu'un pack tiers agisse sur l'état.

## Fenêtres d'overlay (P3)

- Une fenêtre par module actif : transparente, sans cadre, `alwaysOnTop` (niveau `screen-saver`), ignore la souris hors mode édition, absente de la barre des tâches.
- Mode édition : souris activée, glisser-déposer (CSS `-webkit-app-region: drag` injecté par `insertCSS`), la position est recalculée en ancre + décalage et renvoyée au client.
- Le raccourci global masque les fenêtres d'overlay de l'app ; il n'agit pas sur OBS (OBS gère ses propres sources).
