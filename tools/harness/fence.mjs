// "In rounds 1-2 they just run around outside the fence and can't get in."
// Put the player in the bunker, plant zombies on the outside spawn ring and
// see whether they reach a barricade and start chewing on it.
import { nc, load } from './stub.mjs';
const M = await load();
const { ZSTATE } = await import('/home/user/zombies-game-cod/src/entities.js');
const NAME = Object.fromEntries(Object.entries(ZSTATE).map(([k, v]) => [v, k]));
const H = 1 / 60;
let s = 12345;
Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin(); g.started = true; g.power = true; g.powerOn = true;
g.player.hurt = () => false;
g.map.setFloor(0); g.useFloor(0);
g.player.pos.x = g.map.playerStart.x; g.player.pos.y = g.map.playerStart.y;
const ROUND = Number(process.env.ROUND ?? 2);
g.startRound(ROUND);
g.zombies.length = 0;
const zs = [];
// let the game choose, the way it does in play -- this is what decides how
// far the walk in is
for (let i = 0; i < 6; i++) {
  const pick = g.pickSpawn();
  const sp = pick.s ?? pick;
  const z = g.makeZombie({ x: sp.x, y: sp.y, floor: pick.floor });
  g.zombies.push(z);
  zs.push({ z, from: `${sp.tx},${sp.ty}`, d0: Math.round(Math.hypot(sp.x - g.player.pos.x, sp.y - g.player.pos.y)), t: null });
}
console.log(`round ${ROUND}: spawned ${zs.map((o) => `${o.from}(${o.d0}px)`).join(' ')}`);
const boards = g.map.floors[0].barricades;
const nearest = (z) => {
  let best = 1e9;
  for (const b of boards) best = Math.min(best, Math.hypot(b.cx - z.pos.x, b.cy - z.pos.y));
  return best;
};
// inside the bunker = within reach of the player, wherever he stands
const toPlayer = (z) => Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y);
console.log('t(s)  distance to the player   * = chewing a barricade, + = indoors');
const inside = (z) => {
  if (z.floor !== 0) return false;
  const tx = Math.floor(z.pos.x / 24), ty = Math.floor(z.pos.y / 24);
  // FLOOR only: rubble and crates lie around the yard too, and counting
  // those made every walk look four seconds long
  return g.map.tileOn(0, tx, ty) === 1;
};
let firstIn = null;
for (let f = 0; f < 60 * 45; f++) {
  g.player.hp = 100;
  g.update(H);
  for (const o of zs) if (o.t === null && inside(o.z)) o.t = f / 60;
  if (firstIn === null && zs.some((o) => inside(o.z))) firstIn = f / 60;
  if (f % 180 === 0) console.log(`${String((f / 60) | 0).padStart(4)}  ` +
    zs.map((o) => `${o.from}:${Math.round(toPlayer(o.z))}${o.z.state === ZSTATE.BARRICADE ? '*' : ''}${inside(o.z) ? '+' : ''}`).join(' '));
}
const inside9 = zs.filter((o) => inside(o.z)).length;
const times = zs.map((o) => (o.t === null ? 99 : o.t));
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`\nfirst one indoors after ${firstIn === null ? 'never' : firstIn.toFixed(1) + 's'}; indoors at the end: ${inside9}/${zs.length}`);
console.log(`times indoors: ${times.map((t) => (t >= 99 ? 'never' : t.toFixed(1))).join(', ')}  (avg ${avg.toFixed(1)}s, worst ${Math.max(...times).toFixed(1)}s)`);
console.log(`states: ${zs.map((o) => NAME[o.z.state]).join(',')}`);
console.log(inside9 >= zs.length - 1 ? 'FENCE PASS' : `FENCE FAIL (${zs.length - inside9} still outside)`);
