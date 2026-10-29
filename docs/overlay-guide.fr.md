# Créer un overlay pour RL Studio

Un overlay est une petite page web (HTML, CSS, JavaScript) que RL Studio affiche par-dessus Rocket League, ou dans OBS. Elle reçoit en direct l'état du match et de la session. Il n'y a **aucune étape de build** : tu édites les fichiers, tu actualises la liste, c'est visible.

Ce guide suffit pour créer un pack complet. Le pack `example`, fourni avec l'application, sert de modèle.

> Le guide existe aussi en anglais : `docs/overlay-guide.md`, affiché dans le client quand l'interface est en anglais.

## En cinq minutes

1. Dans la barre latérale, clique sur le dossier (« Ouvrir le dossier des overlays »). C'est ton dossier de packs : `%APPDATA%\rl-studio\overlays`.
2. Crée-y un dossier `mon-pack`. Son nom est l'identifiant du pack.
3. Dans `mon-pack`, crée `manifest.json` :

```json
{
  "manifestVersion": 1,
  "name": "Mon pack",
  "version": "1.0.0",
  "modules": [
    {
      "id": "score",
      "name": "Score du match",
      "entry": "modules/score.html",
      "size": { "width": 220, "height": 60 },
      "defaultPosition": { "anchor": "top", "x": 0, "y": 20 },
      "data": ["match"]
    }
  ]
}
```

4. Crée `modules/score.html` :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        background: transparent;
      }
      #score {
        width: 220px;
        height: 60px;
        line-height: 60px;
        text-align: center;
        font:
          700 32px system-ui,
          sans-serif;
        color: #fff;
        background: rgba(15, 18, 28, 0.85);
        border-radius: 10px;
      }
    </style>
  </head>
  <body>
    <div id="score">–</div>

    <script src="/sdk/rlstudio.js"></script>
    <script>
      RLStudio.on('match', function (match) {
        var el = document.getElementById('score')
        if (!match || match.teams.length < 2) {
          el.textContent = '–'
          return
        }
        el.textContent = match.teams[0].score + ' – ' + match.teams[1].score
      })
    </script>
  </body>
</html>
```

5. Dans la bibliothèque, clique sur « Actualiser la liste des packs ». « Mon pack » apparaît : active son module, il s'affiche sur l'écran.

> Si le pack n'apparaît pas, ou apparaît en erreur, la bibliothèque affiche la raison, avec le chemin du champ fautif (par exemple `modules[0].size.width`).

## Où mettre ses packs

| Dossier                                  | Contenu                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `%APPDATA%\rl-studio\overlays`           | **Tes** packs. Jamais touché par une mise à jour ou une désinstallation de l'application. |
| `resources\overlays` (dossier d'install) | Les packs fournis. Réécrits à chaque mise à jour : n'y modifie rien.                      |

- Un sous-dossier = un pack. Son nom est l'identifiant : uniquement `a-z`, `0-9` et `-`.
- Si ton pack a le même nom qu'un pack fourni, **le tien le remplace**. Pour modifier un pack fourni, copie-le dans ton dossier.
- Les dossiers et fichiers cachés (qui commencent par un point) sont ignorés.
- Les packs ne sont pas surveillés : après une modification du manifeste, utilise « Actualiser la liste des packs ». Une modification du HTML, du CSS ou du JS se voit en rechargeant l'overlay.

## Le manifeste

`manifest.json` décrit le pack et ses modules. Un pack contient un ou plusieurs modules ; chaque module est une page affichée dans sa propre fenêtre.

### Le pack

| Champ             | Obligatoire | Rôle                                    |
| ----------------- | ----------- | --------------------------------------- |
| `manifestVersion` | oui         | Toujours `1`.                           |
| `name`            | oui         | Nom affiché.                            |
| `version`         | oui         | Version au format `1.0.0`.              |
| `description`     | non         | Phrase de présentation.                 |
| `author`          | non         | Ton nom.                                |
| `preview`         | non         | Image d'aperçu du pack, chemin relatif. |
| `modules`         | oui         | Au moins un module.                     |

### Un module

| Champ             | Obligatoire | Rôle                                                                                         |
| ----------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `id`              | oui         | Identifiant, `a-z`, `0-9`, `-`, unique dans le pack.                                         |
| `name`            | oui         | Nom affiché.                                                                                 |
| `entry`           | oui         | Page du module, chemin relatif au pack (jamais en dehors du dossier).                        |
| `size`            | oui         | `{ "width": 425, "height": 48 }` : taille de référence en pixels.                            |
| `description`     | non         | Phrase de présentation.                                                                      |
| `defaultPosition` | non         | Position de départ : une ancre et un décalage (voir plus bas). Sinon en haut à gauche.       |
| `data`            | non         | Les topics dont le module a besoin (voir « Le SDK »). Sans eux, il ne reçoit que `settings`. |
| `settings`        | non         | Les réglages que l'utilisateur peut modifier (voir « Les réglages »).                        |
| `category`        | non         | `session`, `stats` ou `match` : choisit le panneau d'aide de la page du module.              |

### La position par défaut

`anchor` est un point de l'écran : `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`. `x` et `y` décalent le module **vers l'intérieur de l'écran**, en pixels. Un module ancré en `top-right` avec `x: 20, y: 20` est à 20 pixels du bord droit et du bord haut.

L'utilisateur peut ensuite le déplacer et le redimensionner à la souris ; ce choix prime sur ta position par défaut.

### La taille

`size` est la taille de référence : celle à laquelle tu dessines. Si l'utilisateur agrandit le module, RL Studio zoome la page en gardant les proportions. Dessine donc ton overlay à une taille fixe, sans compter sur la taille de la fenêtre.

## Les réglages

Chaque entrée de `settings` crée un champ dans la page du module, que l'utilisateur règle sans toucher au code. Tous partagent :

| Champ         | Rôle                                   |
| ------------- | -------------------------------------- |
| `key`         | Nom du réglage, unique dans le module. |
| `type`        | Un des six types ci-dessous.           |
| `label`       | Texte affiché à l'utilisateur.         |
| `default`     | Valeur de départ.                      |
| `description` | Aide facultative.                      |

Les six types :

| `type`    | Champs en plus                              | Valeur reçue        | Affichage                   |
| --------- | ------------------------------------------- | ------------------- | --------------------------- |
| `text`    | `maxLength`                                 | texte               | champ de texte              |
| `number`  | `min`, `max`, `step`, `unit`                | nombre              | compteur − / +              |
| `boolean` | aucun                                       | `true` ou `false`   | interrupteur                |
| `color`   | `palette` (1 à 12 couleurs `#rrggbb`)       | texte `#rrggbb[aa]` | pastilles et valeur libre   |
| `enum`    | `options`                                   | une des valeurs     | boutons ou liste déroulante |
| `range`   | `min`, `max` (obligatoires), `step`, `unit` | nombre              | curseur                     |

Exemple :

```json
"settings": [
  { "key": "showTimer", "type": "boolean", "label": "Afficher le chrono", "default": true },
  { "key": "accent", "type": "color", "label": "Couleur d'accent", "default": "#4cdb8a" },
  { "key": "opacity", "type": "range", "label": "Opacité du fond", "min": 0, "max": 1, "step": 0.05, "unit": "%", "default": 0.85 },
  {
    "key": "layout",
    "type": "enum",
    "label": "Disposition",
    "default": "compact",
    "options": ["compact", { "value": "large", "label": "Large" }]
  }
]
```

- `enum` : une option s'écrit `"compact"` (le libellé est déduit) ou `{ "value": "…", "label": "…" }`.
- Un curseur de 0 à 1 avec `"unit": "%"` s'affiche en pourcentage.
- Le `default` doit respecter les bornes (`min`, `max`, `maxLength`) et les options, sinon le manifeste est refusé.

### Lire les réglages dans la page

```js
RLStudio.on('settings', function (settings) {
  document.documentElement.style.setProperty('--accent', settings.accent)
  document.getElementById('timer').hidden = !settings.showTimer
})
```

Cette fonction est appelée **au chargement**, puis **à chaque modification** faite par l'utilisateur, sans recharger la page. Écris-la comme une fonction qui applique toutes les valeurs, pas comme une initialisation unique. Les réglages sont **propres à chaque module** : il n'y a pas de réglage commun à un pack.

Si tu modifies le manifeste d'un pack déjà utilisé : une valeur devenue invalide revient au `default`, un nouveau réglage reçoit son `default`, un réglage supprimé disparaît.

## Écrire la page

- **Fond transparent.** Mets `background: transparent` sur `html` et `body`. La fenêtre d'overlay et la source OBS sont transparentes : un fond posé sur la page apparaîtrait à l'écran.
- **Pas d'étape de build.** Écris du HTML, du CSS et du JavaScript directement. Pas besoin de bundler.
- **JavaScript simple.** Écris en ES2015 (`var`, `function`, pas de `?.` ni `??`) : certaines versions d'OBS embarquent un Chromium ancien.
- **Fichiers du pack.** Les chemins relatifs fonctionnent depuis ta page : `<link rel="stylesheet" href="score.css" />`, `<img src="../img/logo.png" />`. Tu peux ajouter styles, scripts, images, polices et sons dans le dossier du pack.
- **Le SDK** s'inclut avec `<script src="/sdk/rlstudio.js"></script>`, avec ce chemin exact. Il se connecte tout seul et se reconnecte si l'application redémarre.
- **Un seul interlocuteur : le SDK.** Il est la seule façon de recevoir des données ; ta page n'envoie rien à l'application ni au jeu.

## Le SDK `RLStudio`

```js
var stop = RLStudio.on('session', function (session) {
  /* … */
})
stop() // se désabonner
```

- `RLStudio.on(topic, fonction)` abonne la fonction et renvoie une fonction pour se désabonner.
- `RLStudio.off(topic, fonction)` fait la même chose.
- `RLStudio.module` vaut `"pack/module"` pour la page courante.
- Un abonné tardif reçoit **tout de suite** la dernière valeur connue de `settings`, `session`, `match` et `connection`. Pas de `event` : un but ne se rejoue pas.

Tu ne reçois que les topics déclarés dans `data` (plus `settings`, toujours envoyé).

| Topic        | À déclarer dans `data` | Quand                                            |
| ------------ | ---------------------- | ------------------------------------------------ |
| `settings`   | non, toujours reçu     | au chargement et à chaque modification           |
| `session`    | `"session"`            | à chaque changement de la session                |
| `match`      | `"match"`              | environ 30 fois par seconde au plus              |
| `event`      | `"event"`              | à chaque événement ponctuel (but, fin de match…) |
| `connection` | `"connection"`         | quand la connexion au jeu change                 |

### `session`

```js
{
  wins: 3, losses: 1,
  streak: 2,          // > 0 : victoires d'affilée, < 0 : défaites d'affilée, 0 : aucun résultat
  bestStreak: 3,      // meilleure série de victoires
  lastResult: { won: true, playlistId: 11 },   // ou null
  stats: { goals: 5, assists: 2, saves: 4, shots: 11, demos: 3, demosTaken: 1 }
}
```

`stats` cumule le joueur local sur toute la session. Chaque tir, but, passe, arrêt ou démolition s'y ajoute dès qu'il se produit : affiche simplement ces valeurs. Le freeplay ne compte pas dans la session.

### `match`

`null` entre deux matchs. Sinon :

| Champ           | Contenu                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `status`        | `"inProgress"` ou `"ended"`                                                                                                   |
| `timeSeconds`   | chrono du match, en secondes                                                                                                  |
| `overtime`      | `true` en prolongation                                                                                                        |
| `isReplay`      | `true` pendant le replay d'un but                                                                                             |
| `teams`         | `[{ teamNum, name, score }]` : le score fait foi, c'est celui du jeu                                                          |
| `players`       | joueurs : `name`, `teamNum`, `primaryId`, `score`, `goals`, `shots`, `assists`, `saves`, `demos`, `touches`, `speed`, `boost` |
| `localPlayerId` | `primaryId` du joueur local, ou `null`                                                                                        |
| `myTeamNum`     | équipe du joueur local, ou `null`                                                                                             |
| `winnerTeamNum` | équipe gagnante une fois le match fini, sinon `null`                                                                          |
| `ballSpeed`     | vitesse de la balle, en km/h                                                                                                  |
| `maxBallSpeed`  | record de vitesse de la balle sur le match, en km/h                                                                           |
| `demosTaken`    | démolitions subies par le joueur local                                                                                        |
| `playlistId`    | mode de jeu, ou `null`                                                                                                        |

- `speed` et `boost` (0 à 100) valent `null` quand le jeu ne les envoie pas : en général pour les adversaires.
- Pour trouver ton joueur : `match.players.find(function (p) { return p.primaryId === match.localPlayerId })`.
- Pour trouver tes équipes : compare `teamNum` à `match.myTeamNum`.
- N'utilise jamais le score seul pour décider d'une victoire : le résultat du match est dans `session.lastResult`.

### `event`

Événements ponctuels. Chacun a un `type` et le `matchGuid` du match concerné :

| `type`           | Champs utiles                                                               |
| ---------------- | --------------------------------------------------------------------------- |
| `goal`           | `scorer`, `assister` (ou `null`), `goalSpeed`, `goalTime`                   |
| `matchEnded`     | `winnerTeamNum`                                                             |
| `statfeed`       | `name` (par exemple `"Demolish"`), `label`, `mainTarget`, `secondaryTarget` |
| `crossbarHit`    | `ballSpeed`, `impactForce`, `lastTouch`                                     |
| `playerJoined`   | `playerName`, `primaryId`                                                   |
| `playerLeft`     | `playerName`, `primaryId`                                                   |
| `matchCreated`   | `matchGuid` seulement                                                       |
| `matchDestroyed` | `matchGuid` seulement                                                       |

Un `scorer`, un `assister` ou une cible est `{ name, shortcut, teamNum }`.

### `connection`

```js
{
  status: 'game-closed'
} // Rocket League n'est pas lancé
{
  status: 'api-disabled'
} // le jeu tourne, mais l'API Stats est inactive
{
  status: 'connected'
} // les données arrivent
```

## Exemples

### Réagir à un but

```js
RLStudio.on('event', function (event) {
  if (event.type !== 'goal') return
  var flash = document.getElementById('flash')
  flash.textContent = event.scorer.name + ' marque à ' + Math.round(event.goalSpeed) + ' km/h'
  flash.classList.add('visible')
  setTimeout(function () {
    flash.classList.remove('visible')
  }, 3000)
})
```

### Afficher la session

```js
RLStudio.on('session', function (s) {
  document.getElementById('record').textContent = s.wins + ' V – ' + s.losses + ' D'
  document.getElementById('streak').textContent = (s.streak > 0 ? '+' : '') + s.streak
})
```

### Afficher « en attente du jeu »

```js
RLStudio.on('connection', function (c) {
  document.getElementById('waiting').hidden = c.status === 'connected'
})
```

## Tester

1. **Dans le client** : la page du module affiche un aperçu en direct, avec les mêmes données et les mêmes réglages que l'overlay réel. Tu peux y régler la session à la main pour tester tes compteurs sans jouer.
2. **Dans un navigateur** : ouvre `http://127.0.0.1:49200/overlay/<pack>/<module>` (par exemple `…/overlay/mon-pack/score`). L'application doit être lancée. Le port est celui de `overlayPort` dans `config.json` (49200 par défaut). La console du navigateur affiche les erreurs de ta page.
3. **En jeu** : active le module et lance une partie. Le **freeplay** devrait suffire pour tester `match` et `event` ; il ne compte simplement pas dans la session.
4. **Dans OBS** : ajoute une source « Navigateur » avec le lien affiché dans la page du module, à la taille du module.

## Pièges courants

| Symptôme                                | Cause probable                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Le pack n'apparaît pas                  | Nom de dossier invalide (majuscule, espace, accent), ou liste non actualisée.              |
| Le pack apparaît en erreur              | Le message indique le champ fautif du manifeste.                                           |
| La page reste vide                      | Le topic manque dans `data`, ou `entry` pointe vers un fichier absent.                     |
| Un fond blanc ou noir entoure l'overlay | `html` et `body` n'ont pas `background: transparent`.                                      |
| Rien ne s'affiche en jeu                | Rocket League est en plein écran : passe en mode fenêtré ou sans bordure.                  |
| Tes réglages ne se mettent pas à jour   | Tu les lis une seule fois ; fais tout dans la fonction passée à `RLStudio.on('settings')`. |
| Le manifeste modifié est ignoré         | Utilise « Actualiser la liste des packs ».                                                 |

## Limites

- L'overlay est une fenêtre posée au-dessus du jeu : aucune injection. Elle n'apparaît pas en plein écran exclusif.
- Un overlay ne peut pas envoyer de commande à l'application ni au jeu : il affiche seulement.
- Les textes d'un pack (noms, réglages, page) sont ceux que tu écris : RL Studio ne les traduit pas.
