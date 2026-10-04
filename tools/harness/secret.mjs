// The secret door opens after four switches -- is the room behind it actually
// reachable, and does the loot respond?
import { nc, load } from './stub.mjs';
const M = await load();
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
const W = g.map.w, T = 24;
const bfs = (sx, sy, open) => {
  const seen = new Set([sy * W + sx]); const q = [[sx, sy]];
  while (q.length) { const [x, y] = q.pop();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x+dx, ny = y+dy, k = ny*W+nx;
      if (seen.has(k) || !g.map.inside(nx, ny) || g.map.solidTileOn(0, nx, ny)) continue;
      seen.add(k); q.push([nx, ny]); } }
  return seen;
};
g.map.secretDoorOpen = false;
const shut = bfs(g.map.playerStart.tx ?? 20, g.map.playerStart.ty ?? 14, false);
g.map.secretDoorOpen = true;
const open = bfs(20, 14, true);
const doorK = 20 * W + 63;
console.log(`player start tile 20,14; secret door tile 63,20`);
console.log(`door reachable while shut: ${shut.has(doorK)}, while open: ${open.has(doorK)}`);
for (const l of g.map.secretLoot) {
  const tx = Math.floor(l.x / T), ty = Math.floor(l.y / T);
  const k = ty * W + tx;
  console.log(`loot at tile ${tx},${ty}  reachable: shut ${shut.has(k)} / open ${open.has(k)}`);
}
// what is actually around the door?
console.log('\ntiles around the secret room:');
for (let y = 16; y <= 24; y++) {
  let row = String(y).padStart(3) + ' ';
  for (let x = 58; x <= 71; x++) {
    const t = g.map.tileOn(0, x, y);
    const sym = t === 1 ? '#' : t === 0 ? '.' : t === 2 ? '.' : t === 3 ? 'W' : t === 4 ? 'D' : t === 5 ? 'c' : t === 6 ? 'r' : t === 7 ? 'T' : t === 8 ? 'F' : t === 9 ? 'V' : t === 10 ? 'S' : t === 11 ? '*' : t === 12 ? '~' : t === 13 ? 'R' : '?';
    row += sym;
  }
  console.log(row + '   (x 58..71)');
}
