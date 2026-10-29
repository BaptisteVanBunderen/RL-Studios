# Create an overlay for RL Studio

An overlay is a small web page (HTML, CSS, JavaScript) that RL Studio displays on top of Rocket League, or in OBS. It receives the state of the match and of the session live. There is **no build step**: you edit the files, refresh the list, and the result is visible.

This guide is enough to create a complete pack. The `example` pack, shipped with the application, is a ready-made model.

> The guide is also available in French: `docs/overlay-guide.fr.md`, shown in the client when the interface is in French.

## In five minutes

1. In the sidebar, click the folder icon ("Open the overlays folder"). This is your packs folder: `%APPDATA%\rl-studio\overlays`.
2. Create a folder `my-pack` in it. Its name is the pack identifier.
3. In `my-pack`, create `manifest.json`:

```json
{
  "manifestVersion": 1,
  "name": "My pack",
  "version": "1.0.0",
  "modules": [
    {
      "id": "score",
      "name": "Match score",
      "entry": "modules/score.html",
      "size": { "width": 220, "height": 60 },
      "defaultPosition": { "anchor": "top", "x": 0, "y": 20 },
      "data": ["match"]
    }
  ]
}
```

4. Create `modules/score.html`:

```html
<!doctype html>
<html lang="en">
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

5. In the library, click "Refresh the pack list". "My pack" appears: enable its module and it shows up on your screen.

> If the pack does not appear, or appears with an error, the library shows the reason, with the path of the faulty field (for example `modules[0].size.width`).

## Where to put your packs

| Folder                                | Content                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `%APPDATA%\rl-studio\overlays`        | **Your** packs. Never touched by an application update or uninstall.      |
| `resources\overlays` (install folder) | The bundled packs. Rewritten at every update: do not edit anything there. |

- One sub-folder = one pack. Its name is the identifier: only `a-z`, `0-9` and `-`.
- If your pack has the same name as a bundled pack, **yours replaces it**. To modify a bundled pack, copy it into your folder.
- Hidden folders and files (starting with a dot) are ignored.
- Packs are not watched: after editing the manifest, use "Refresh the pack list". An edit to the HTML, CSS or JS shows up when you reload the overlay.

## The manifest

`manifest.json` describes the pack and its modules. A pack holds one or more modules; each module is a page displayed in its own window.

### The pack

| Field             | Required | Purpose                                   |
| ----------------- | -------- | ----------------------------------------- |
| `manifestVersion` | yes      | Always `1`.                               |
| `name`            | yes      | Displayed name.                           |
| `version`         | yes      | Version in the `1.0.0` format.            |
| `description`     | no       | One-sentence presentation.                |
| `author`          | no       | Your name.                                |
| `preview`         | no       | Preview image of the pack, relative path. |
| `modules`         | yes      | At least one module.                      |

### A module

| Field             | Required | Purpose                                                                                 |
| ----------------- | -------- | --------------------------------------------------------------------------------------- |
| `id`              | yes      | Identifier, `a-z`, `0-9`, `-`, unique within the pack.                                  |
| `name`            | yes      | Displayed name.                                                                         |
| `entry`           | yes      | Page of the module, path relative to the pack (never outside the folder).               |
| `size`            | yes      | `{ "width": 425, "height": 48 }`: reference size in pixels.                             |
| `description`     | no       | One-sentence presentation.                                                              |
| `defaultPosition` | no       | Starting position: an anchor and an offset (see below). Otherwise top left.             |
| `data`            | no       | The topics the module needs (see "The SDK"). Without them, it only receives `settings`. |
| `settings`        | no       | The settings the user can change (see "Settings").                                      |
| `category`        | no       | `session`, `stats` or `match`: picks the help panel of the module page.                 |

### The default position

`anchor` is a point of the screen: `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`. `x` and `y` shift the module **towards the inside of the screen**, in pixels. A module anchored at `top-right` with `x: 20, y: 20` sits 20 pixels from the right edge and from the top edge.

The user can then move and resize it with the mouse; that choice overrides your default position.

### The size

`size` is the reference size: the one you draw at. If the user enlarges the module, RL Studio zooms the page while keeping the proportions. So draw your overlay at a fixed size, and do not rely on the window size.

## Settings

Each entry of `settings` creates a field in the module page, which the user adjusts without touching the code. All of them share:

| Field         | Purpose                                    |
| ------------- | ------------------------------------------ |
| `key`         | Name of the setting, unique in the module. |
| `type`        | One of the six types below.                |
| `label`       | Text shown to the user.                    |
| `default`     | Starting value.                            |
| `description` | Optional help text.                        |

The six types:

| `type`    | Extra fields                            | Value received     | Display                   |
| --------- | --------------------------------------- | ------------------ | ------------------------- |
| `text`    | `maxLength`                             | text               | text field                |
| `number`  | `min`, `max`, `step`, `unit`            | number             | − / + counter             |
| `boolean` | none                                    | `true` or `false`  | switch                    |
| `color`   | `palette` (1 to 12 `#rrggbb` colors)    | text `#rrggbb[aa]` | swatches and free value   |
| `enum`    | `options`                               | one of the values  | buttons or drop-down list |
| `range`   | `min`, `max` (required), `step`, `unit` | number             | slider                    |

Example:

```json
"settings": [
  { "key": "showTimer", "type": "boolean", "label": "Show the timer", "default": true },
  { "key": "accent", "type": "color", "label": "Accent color", "default": "#4cdb8a" },
  { "key": "opacity", "type": "range", "label": "Background opacity", "min": 0, "max": 1, "step": 0.05, "unit": "%", "default": 0.85 },
  {
    "key": "layout",
    "type": "enum",
    "label": "Layout",
    "default": "compact",
    "options": ["compact", { "value": "large", "label": "Large" }]
  }
]
```

- `enum`: an option is written `"compact"` (the label is derived from it) or `{ "value": "…", "label": "…" }`.
- A 0 to 1 slider with `"unit": "%"` is displayed as a percentage.
- The `default` must respect the bounds (`min`, `max`, `maxLength`) and the options, otherwise the manifest is rejected.

### Reading the settings in the page

```js
RLStudio.on('settings', function (settings) {
  document.documentElement.style.setProperty('--accent', settings.accent)
  document.getElementById('timer').hidden = !settings.showTimer
})
```

This function is called **at load**, then **on every change** made by the user, without reloading the page. Write it as a function that applies all the values, not as a one-time initialization. Settings are **specific to each module**: there is no setting shared across a pack.

If you edit the manifest of a pack that is already in use: a value that became invalid goes back to the `default`, a new setting receives its `default`, and a removed setting disappears.

## Writing the page

- **Transparent background.** Put `background: transparent` on `html` and `body`. The overlay window and the OBS source are transparent: a background set on the page would show up on screen.
- **No build step.** Write HTML, CSS and JavaScript directly. No bundler needed.
- **Plain JavaScript.** Write ES2015 (`var`, `function`, no `?.` or `??`): some versions of OBS embed an old Chromium.
- **Pack files.** Relative paths work from your page: `<link rel="stylesheet" href="score.css" />`, `<img src="../img/logo.png" />`. You can add styles, scripts, images, fonts and sounds to the pack folder.
- **The SDK** is included with `<script src="/sdk/rlstudio.js"></script>`, with exactly this path. It connects by itself and reconnects if the application restarts.
- **A single contact: the SDK.** It is the only way to receive data; your page sends nothing to the application or to the game.

## The `RLStudio` SDK

```js
var stop = RLStudio.on('session', function (session) {
  /* … */
})
stop() // unsubscribe
```

- `RLStudio.on(topic, function)` subscribes the function and returns a function to unsubscribe.
- `RLStudio.off(topic, function)` does the same.
- `RLStudio.module` is `"pack/module"` for the current page.
- A late subscriber receives the last known value of `settings`, `session`, `match` and `connection` **right away**. Not `event`: a goal is not replayed.

You only receive the topics declared in `data` (plus `settings`, which is always sent).

| Topic        | To declare in `data` | When                                         |
| ------------ | -------------------- | -------------------------------------------- |
| `settings`   | no, always received  | at load and on every change                  |
| `session`    | `"session"`          | on every change of the session               |
| `match`      | `"match"`            | about 30 times per second at most            |
| `event`      | `"event"`            | on every one-off event (goal, end of match…) |
| `connection` | `"connection"`       | when the connection to the game changes      |

### `session`

```js
{
  wins: 3, losses: 1,
  streak: 2,          // > 0: wins in a row, < 0: losses in a row, 0: no result yet
  bestStreak: 3,      // best win streak
  lastResult: { won: true, playlistId: 11 },   // or null
  stats: { goals: 5, assists: 2, saves: 4, shots: 11, demos: 3, demosTaken: 1 }
}
```

`stats` accumulates the local player over the whole session. Every shot, goal, assist, save or demolition is added as soon as it happens: just display these values. Freeplay does not count towards the session.

### `match`

`null` between two matches. Otherwise:

| Field           | Content                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `status`        | `"inProgress"` or `"ended"`                                                                                                  |
| `timeSeconds`   | match clock, in seconds                                                                                                      |
| `overtime`      | `true` in overtime                                                                                                           |
| `isReplay`      | `true` during a goal replay                                                                                                  |
| `teams`         | `[{ teamNum, name, score }]`: the score is authoritative, it is the game's own                                               |
| `players`       | players: `name`, `teamNum`, `primaryId`, `score`, `goals`, `shots`, `assists`, `saves`, `demos`, `touches`, `speed`, `boost` |
| `localPlayerId` | `primaryId` of the local player, or `null`                                                                                   |
| `myTeamNum`     | team of the local player, or `null`                                                                                          |
| `winnerTeamNum` | winning team once the match is over, otherwise `null`                                                                        |
| `ballSpeed`     | ball speed, in km/h                                                                                                          |
| `maxBallSpeed`  | ball speed record over the match, in km/h                                                                                    |
| `demosTaken`    | demolitions suffered by the local player                                                                                     |
| `playlistId`    | game mode, or `null`                                                                                                         |

- `speed` and `boost` (0 to 100) are `null` when the game does not send them: usually for opponents.
- To find your player: `match.players.find(function (p) { return p.primaryId === match.localPlayerId })`.
- To tell the teams apart: compare `teamNum` with `match.myTeamNum`.
- Never use the score alone to decide a victory: the result of the match is in `session.lastResult`.

### `event`

One-off events. Each one has a `type` and the `matchGuid` of the match concerned:

| `type`           | Useful fields                                                               |
| ---------------- | --------------------------------------------------------------------------- |
| `goal`           | `scorer`, `assister` (or `null`), `goalSpeed`, `goalTime`                   |
| `matchEnded`     | `winnerTeamNum`                                                             |
| `statfeed`       | `name` (for example `"Demolish"`), `label`, `mainTarget`, `secondaryTarget` |
| `crossbarHit`    | `ballSpeed`, `impactForce`, `lastTouch`                                     |
| `playerJoined`   | `playerName`, `primaryId`                                                   |
| `playerLeft`     | `playerName`, `primaryId`                                                   |
| `matchCreated`   | `matchGuid` only                                                            |
| `matchDestroyed` | `matchGuid` only                                                            |

A `scorer`, an `assister` or a target is `{ name, shortcut, teamNum }`.

### `connection`

```js
{
  status: 'game-closed'
} // Rocket League is not running
{
  status: 'api-disabled'
} // the game is running, but the Stats API is off
{
  status: 'connected'
} // data is flowing
```

## Examples

### React to a goal

```js
RLStudio.on('event', function (event) {
  if (event.type !== 'goal') return
  var flash = document.getElementById('flash')
  flash.textContent = event.scorer.name + ' scores at ' + Math.round(event.goalSpeed) + ' km/h'
  flash.classList.add('visible')
  setTimeout(function () {
    flash.classList.remove('visible')
  }, 3000)
})
```

### Display the session

```js
RLStudio.on('session', function (s) {
  document.getElementById('record').textContent = s.wins + ' W – ' + s.losses + ' L'
  document.getElementById('streak').textContent = (s.streak > 0 ? '+' : '') + s.streak
})
```

### Show "waiting for the game"

```js
RLStudio.on('connection', function (c) {
  document.getElementById('waiting').hidden = c.status === 'connected'
})
```

## Testing

1. **In the client**: the module page shows a live preview, with the same data and the same settings as the real overlay. You can set the session by hand there to test your counters without playing.
2. **In a browser**: open `http://127.0.0.1:49200/overlay/<pack>/<module>` (for example `…/overlay/my-pack/score`). The application must be running. The port is the `overlayPort` of `config.json` (49200 by default). The browser console shows the errors of your page.
3. **In game**: enable the module and start a match. **Freeplay** should be enough to test `match` and `event`; it simply does not count towards the session.
4. **In OBS**: add a "Browser" source with the link shown in the module page, at the size of the module.

## Common pitfalls

| Symptom                                           | Likely cause                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The pack does not appear                          | Invalid folder name (capital letter, space, accent), or the list was not refreshed.        |
| The pack appears with an error                    | The message points to the faulty field of the manifest.                                    |
| The page stays empty                              | The topic is missing from `data`, or `entry` points to a missing file.                     |
| A white or black background surrounds the overlay | `html` and `body` do not have `background: transparent`.                                   |
| Nothing shows in game                             | Rocket League is in fullscreen: switch to windowed or borderless mode.                     |
| Your settings do not update                       | You read them only once; do everything in the function given to `RLStudio.on('settings')`. |
| The edited manifest is ignored                    | Use "Refresh the pack list".                                                               |

## Limits

- The overlay is a window placed above the game: no injection. It does not appear in exclusive fullscreen.
- An overlay cannot send a command to the application or to the game: it only displays.
- The texts of a pack (names, settings, page) are the ones you write: RL Studio does not translate them.
