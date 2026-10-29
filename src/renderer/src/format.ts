/** Série signée : « +4 » (victoires d'affilée), « −2 » (défaites d'affilée), « 0 » sans série. */
export function formatStreak(streak: number): string {
  if (streak > 0) return `+${streak}`
  if (streak < 0) return `−${Math.abs(streak)}`
  return '0'
}
