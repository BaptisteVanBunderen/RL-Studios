/**
 * Commandes envoyées au jeu sur le WebSocket de la Stats API. `Data` doit être un OBJET : en
 * chaîne, ou sur le TCP, le jeu ne réagit pas (docs/stats-api.md, « Commandes »).
 */
export type GameCommand =
  | { command: 'SetHUDVisibility'; data: { bVisible: boolean } }
  | { command: 'SetMatchPaused'; data: { bPaused: boolean } }

export function buildCommandMessage(command: GameCommand): string {
  return JSON.stringify({ Command: command.command, Data: command.data })
}
