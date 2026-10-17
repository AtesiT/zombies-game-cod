// Host-authoritative, per-wave TEAM totals, independent of legacy lifetime stats.
export const ROUND_METRICS = Object.freeze([
  'seconds', 'kills', 'headshots', 'specialKills', 'summonedKills', 'knifeKills',
  'trapKills', 'rays', 'hitRays', 'points', 'salvage', 'damage', 'armor',
  'planks', 'doors', 'crafted', 'throws', 'medkits', 'revives', 'downs',
]);
export const newRoundMetrics = () => Object.fromEntries(ROUND_METRICS.map((key) => [key, 0]));
export function recordRound(game, key, value = 1) {
  if (game.rangeMode || !game.started || game.gameOver || !ROUND_METRICS.includes(key)) return;
  if (!Number.isFinite(value) || value < 0) return;
  if (game.runMetrics) game.runMetrics[key] += value;
  if (game.roundActive && game.roundMetrics) game.roundMetrics[key] += value;
}
export function finishRoundReport(game) {
  const m = { ...newRoundMetrics(), ...game.roundMetrics };
  return Object.freeze({ ...m, round: game.round, players: game.players?.length ?? 1,
    accuracy: m.rays ? Math.round(100 * Math.min(m.hitRays, m.rays) / m.rays) : 0,
    headshotRate: m.kills ? Math.round(100 * m.headshots / m.kills) : 0,
  });
}
