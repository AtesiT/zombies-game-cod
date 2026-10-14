// A zombie that spawns in a pocket it cannot walk out of just stands there.
// Check every indoor spawn point can reach a staircase -- and that the
// ground-floor outdoor ones can reach the barricades (the way in).
import { nc, load } from './stub.mjs';
const M = await load();
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
const W = g.map.w;
const bfs = (floor, sx, sy, breakIn) => {
  const seen = new Set([sy * W + sx]); const q = [[sx, sy]];
  while (q.length) { const [x, y] = q.pop();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x+dx, ny = y+dy, k = ny*W+nx;
      if (seen.has(k) || !g.map.inside(nx, ny)) continue;
      if (g.map.solidTileOn(floor, nx, ny)) {
        if (!breakIn) continue;
        const t = g.map.tileOn(floor, nx, ny);
        // tileOn answers with TILE numbers, not the generator's letters --
        // comparing to 'W'/'D' here meant nothing ever broke in, and every
        // outdoor spawn looked stranded
        if (t !== 3 && t !== 4) continue;          // WINDOW, DOOR: the way in
      }
      seen.add(k); q.push([nx, ny]); } }
  return seen;
};
const tile = (k) => `${k % W},${(k / W) | 0}`;
let bad = 0;
for (let f = 0; f < g.map.floors.length; f++) {
  const F = g.map.floors[f];
  const links = g.map.linksOn(f).map((l) => (l.a.floor === f ? l.a : l.b));
  const linkKeys = links.map((e) => e.ty * W + e.tx);
  console.log(`\nstorey ${f} -- ${F.spawnPoints.length} spawn points, staircases at ${links.map((e) => `${e.tx},${e.ty}`).join(' | ')}`);
  const fromLink = new Set();
  for (const e of links) for (const k of bfs(f, e.tx, e.ty, true)) fromLink.add(k);
  const toBarricade = new Set();
  for (const k of F.barricades.flatMap((b) => b.tiles))
    for (const c of bfs(f, k % W, (k / W) | 0, true)) toBarricade.add(c);
  for (const sp of F.spawnPoints) {
    const open = bfs(f, sp.tx, sp.ty, true);
    const shut = bfs(f, sp.tx, sp.ty, false);
    const indoor = f > 0;
    // Upstairs every spawn must be able to walk to a staircase, or whatever
    // appears there is stuck for good. Outside, the goal is not the stairs
    // but the building: a spawn that cannot reach a barricade is a spawn
    // that can never threaten the player.
    // barricades are stored as flat tile indices, one entry per boarded tile
    const boards = F.barricades.flatMap((b) => b.tiles);
    const key = sp.ty * W + sp.tx;
    const goal = indoor ? linkKeys.some((k) => open.has(k))
                        : boards.some((k) => open.has(k));
    const back = indoor ? fromLink.has(key) : toBarricade.has(key);
    const flag = (goal && back) ? ' ok ' : 'FAIL';
    if (flag === 'FAIL') bad++;
    console.log(`  ${flag} spawn ${String(sp.tx).padStart(2)},${String(sp.ty).padStart(2)}  reach ${String(open.size).padStart(4)} (${String(shut.size).padStart(4)} while barred)  -> ${indoor ? 'stairs' : 'barricade'} ${goal ? 'yes' : 'NO'}  <- back ${back ? 'yes' : 'NO'}`);
  }
  let walkable = 0; const seenAll = new Set(); const pockets = [];
  for (let ty = 0; ty < g.map.h; ty++) for (let tx = 0; tx < g.map.w; tx++) {
    if (g.map.solidTileOn(f, tx, ty)) continue;
    walkable++;
    const k = ty * W + tx;
    if (seenAll.has(k)) continue;
    const comp = bfs(f, tx, ty, true);
    for (const c of comp) seenAll.add(c);
    // the map is ringed by a few tiles of outdoor scenery that no route
    // reaches; a pocket only matters if it sits inside the playfield
    const onRim = [...comp].some((k) => { const x = k % W, y = (k / W) | 0;
      return x < 3 || y < 3 || x > g.map.w - 4 || y > g.map.h - 4; });
    if (comp.size < 10 && !onRim) pockets.push(`${comp.size}@${tile([...comp][0])}`);
  }
  console.log(`  walkable ${walkable}, reached from the staircases ${fromLink.size}` + (pockets.length ? `, pockets: ${pockets.join(' ')}` : ', no cut-off pockets'));
}
console.log(bad === 0 ? '\nSPAWNREACH PASS' : `\nSPAWNREACH FAIL (${bad})`);
