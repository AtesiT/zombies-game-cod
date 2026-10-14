import { nc, load } from './stub.mjs';
const M = await load();
const { TILE } = await import('/home/user/zombies-game-cod/src/art.js');
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
const W = g.map.w, T = 24;
// walk with the barricades down: windows and doors no longer stop you
const bfs = (sx, sy, breakIn) => {
  const seen = new Set([sy * W + sx]); const q = [[sx, sy]];
  while (q.length) { const [x, y] = q.pop();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x+dx, ny = y+dy, k = ny*W+nx;
      if (seen.has(k) || !g.map.inside(nx, ny)) continue;
      const t = g.map.tileOn(0, nx, ny);
      if (g.map.solidTileOn(0, nx, ny)) {
        const openable = breakIn && (t === TILE.WINDOW || t === TILE.DOOR);
        if (!openable) continue;
      }
      seen.add(k); q.push([nx, ny]); } }
  return seen;
};
const start = { tx: 20, ty: 14 };
for (const open of [false, true]) {
  g.map.secretDoorOpen = open;
  const r = bfs(start.tx, start.ty, true);
  const dk = 20 * W + 63;
  const loot = g.map.secretLoot.map((l) => {
    const k = Math.floor(l.y / T) * W + Math.floor(l.x / T);
    return `tile ${Math.floor(l.x / T)},${Math.floor(l.y / T)} ${r.has(k) ? 'YES' : 'no'}`;
  });
  console.log(`door ${open ? 'OPEN ' : 'shut '}: door tile reachable ${r.has(dk)}, reach ${r.size} tiles; loot: ${loot.join(' | ')}`);
}
// print the neighbourhood with real symbols
const sym = {}; for (const [c, v] of Object.entries({ ' ': 0, '.': 1, '#': 2, W: 3, D: 4, c: 5, r: 6, T: 7, F: 8, V: 9, S: 10, '*': 11, '~': 12, R: 13 })) sym[v] = c;
console.log('\n    ' + Array.from({ length: 16 }, (_, i) => String((58 + i) % 10)).join(''));
for (let y = 15; y <= 25; y++) {
  let row = String(y).padStart(3) + ' ';
  for (let x = 58; x <= 73; x++) row += (x < W ? (sym[g.map.tileOn(0, x, y)] ?? '?') : ' ');
  console.log(row);
}
