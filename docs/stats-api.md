# Stats API Rocket League — ce que disent les captures réelles

Doc officielle : https://www.rocketleague.com/developer/stats-api
Ce document liste ce qui a été OBSERVÉ et qui diffère de la doc ou la complète. En cas de conflit, ce document fait foi.

Captures de référence dans `captures/` (gzip, une trame par ligne : `{ "t": ms depuis le début, "raw": "<message exact reçu>" }`) :

- `2026-10-01_match-complet` — 2v2 en ligne joué jusqu'au bout (PlaylistId 2)
- `2026-10-01_abandon` — 2v2 en ligne quitté en cours de match
- `2026-10-01_freeplay` — entraînement libre (PlaylistId 9)
- `2026-10-01_prive-admin` — partie privée contre bots, score / temps / pause modifiés par l'admin (PlaylistId 6)
- `2026-10-01_replay-historique` — replay chargé depuis l'historique
- `2026-10-02_session-7-matchs-ff` — 38 min, 7 matchs classés et non classés en 1v1/2v2/3v3, dont 4 terminés par ff (enregistrement allégé : ~1 UpdateState/s + tous les events). Résumé par match dans `.matches.jsonl`.

## Configuration

- Fichier : `<Install Dir>\TAGame\Config\TAStatsAPI.ini` (ou `DefaultStatsAPI.ini` s'il n'existe pas), section `[TAGame.MatchStatsExporter_TA]`.
- `PacketSendRate` (0 = désactivé, max 120), `Port` (TCP, 49123), `WebPort` (WebSocket, 49124). Toute modification exige de relancer le jeu.

## Format

- `Data` arrive TOUJOURS en string JSON (100 % des 20 200 messages), y compris via le WebSocket → double `JSON.parse` obligatoire.
- Les commandes, elles, doivent être envoyées avec `Data` en OBJET (voir « Commandes »).
- `MatchGuid` vide en freeplay, en privé au moment du `MatchCreated`, et sur les tout premiers events d'un match en ligne. Ne pas s'en servir comme clé avant qu'il soit renseigné.
- Des events peuvent précéder `MatchCreated` (ex. `PlayerJoined` du joueur local).

## Identification du joueur local

- `Game.Target` = joueur local en jeu (stable sur 99 % des trames hors replay). Absent pendant les replays de but et les transitions.
- En replay depuis l'historique, `Target` suit la caméra → inutilisable.
- `TeamNum` peut valoir 255 de façon transitoire.
- Le joueur peut changer d'équipe avant le début (privé : équipe 0 puis 1) → déterminer l'équipe au moment du résultat, pas au début.
- `bHasCar`, `Boost`, `Speed`… ne sont PAS « spectateur uniquement » comme dit la doc : envoyés pour le joueur local et ses coéquipiers, et pour tout le monde pendant les replays de but.
- Stratégie : identité = `PrimaryId` (ex. `Epic|…|0`) du joueur désigné par `Target` hors replay ; à mémoriser dans la config.

## Fin de match / résultat

- Match terminé : `StatfeedEvent Win` (gagnants, ~0,1 s avant) + `MVP`, puis `MatchEnded {WinnerTeamNum}`, puis `MatchDestroyed` et `PlayerLeft` × n.
- `bHasWinner` ne passe à true dans `UpdateState` qu'APRÈS `MatchEnded` → inutile pour anticiper le résultat.
- `PodiumStart` : présent en non classé et en privé, ABSENT en classé.
- ff (vote en 2v2, départ de l'adversaire en 1v1, 2 adversaires partis en 3v3) : `MatchEnded` arrive immédiatement avec du temps restant (38 à 204 s observés).
- En non classé, un adversaire qui part en cours de match (remplacé ensuite) ne termine pas le match.
- Abandon : `MatchDestroyed` + `PlayerLeft`, AUCUN `MatchEnded`.
- `Game.Winner` est le NOM d'équipe : « Orange » en ligne, nom de club censuré (« ******** ») en privé → utiliser uniquement `WinnerTeamNum` / `TeamNum`.

### Règle de résultat (validée sur 7 matchs en ligne dont 4 ff)

1. `MatchEnded` reçu → `WinnerTeamNum` comparé à l'équipe du joueur local.
2. Sinon, si un `StatfeedEvent Win` a été reçu → vainqueur déduit de son équipe (filet de sécurité).
3. Sinon → défaite (le joueur a quitté avant la fin).
   Ne JAMAIS déduire le résultat du seul score : dans la capture d'abandon, le joueur menait 1-0 au moment de quitter.

## Buts

- `GoalScored` fantôme à la fin de chaque replay de but, dans le même tick que `GoalReplayEnd` (y compris replay passé) : `Scorer.Name` vide, `GoalSpeed` 0, `GoalTime` 0 → à ignorer. Non observé en freeplay ni en replay d'historique.
- `ImpactLocation` du vrai `GoalScored` est périmée (position du but précédent, parfois 0,0,0) → ne pas l'utiliser.
- Les changements de score par l'admin (privé) ne déclenchent aucun `GoalScored` → le score de référence est `Game.Teams[].Score` dans `UpdateState`.
- Freeplay : `GoalScored` et rafales de `CountdownBegin`/`RoundStarted` (reset de balle).

## Autres events

- `CrossbarHit` en rafale : jusqu'à 19 events en 0,1 s, `ImpactForce` négatif, doublons exacts → filtrer (force > 0) et dédoublonner.
- `MatchPaused`/`MatchUnpaused` : pause admin, menu pause hors ligne, pause de lecture de replay, séquence de sortie de partie, et souvent à l'entrée en freeplay.
- `BoostPickup` et `bDemolished` : reçus seulement en spectateur/replay.
- `StatfeedEvent` noms vus : Shot, Goal, Save, Assist, Demolish, BicycleHit, BicycleGoal, FlipReset, LongGoal, HatTrick, Win, MVP.
- Admin en privé : peut changer le score, le temps, relancer depuis le kick-off, mettre en pause. Pas de redémarrage complet du match.

## Commandes (test du 2026-10-02, `tools/test-commands.mjs`)

- Fonctionnent via le WebSocket 49124 avec `Data` en objet : `{ "Command": "SetHUDVisibility", "Data": { "bVisible": false } }`.
- Aucune réaction : WebSocket avec `Data` en string, TCP 49123 (objet ou string).
- `SetMatchPaused true` → event `MatchPaused` émis. `SetMatchPaused false` → pas de `MatchUnpaused` dans les 3 s.
- `SetHUDVisibility` : effet confirmé à l'écran.

## Replays depuis l'historique

- Détection : `ReplayCreated`, puis `Game.Frame`/`Game.Elapsed` présents et `bReplay` = true sur quasi toutes les trames.
- Le `MatchGuid` est celui du match d'origine → un replay rejoue des `GoalScored` (et potentiellement `MatchEnded`) d'un match déjà compté.
- Un seek dans le replay émet `MatchDestroyed` → `MatchCreated` → `PlayerJoined` × n avec le même GUID.
- → Ignorer tout le suivi de session quand un replay est chargé ; dédoublonner les résultats par GUID.

## PlaylistId (confirmés)

| ID                                                             | Mode                    |
| -------------------------------------------------------------- | ----------------------- |
| 1                                                              | Duel 1v1 non classé     |
| 2                                                              | Doubles 2v2 non classé  |
| 3                                                              | Standard 3v3 non classé |
| 6                                                              | Partie privée           |
| 9                                                              | Freeplay / entraînement |
| 10                                                             | Duel 1v1 classé         |
| 11                                                             | Doubles 2v2 classé      |
| 13                                                             | Standard 3v3 classé     |
| Extra modes, tournois et exhibition hors ligne : non observés. |
