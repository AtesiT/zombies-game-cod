// Zombies that spawn upstairs are supposed to walk to the staircase and come
// down. Do they?
import { nc, load } from './stub.mjs';
const M = await load();
const { ZSTATE } = await import('/home/user/zombies-game-cod/src/entities.js');
const H = 1 / 60, T = 24;
const NAME = { 0: 'HUNT', 1: 'BARRICADE', 2: 'DOOR', 3: 'ATTACK', 4: 'DEAD' };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin(); g.power = true; g.powerOn = true;
g.player.hurt = () => false;
g.startRound(8);
// clear the round's own zombies, then plant three on each upper storey
g.zombies.length = 0;
const planted = [];
for (const f of [1, 2]) {
  const pts = g.map.floors[f].spawnPoints;
  console.log(`storey ${f}: ${pts.length} spawn points, first at tile ${pts[0].tx},${pts[0].ty}`);
  for (let i = 0; i < 3; i++) {
    const sp = pts[i % pts.length];
    const z = g.makeZombie({ x: sp.x, y: sp.y, floor: f });
    g.zombies.push(z);
    planted.push(z);
  }
}
console.log(`player on storey ${g.map.floor}; planted ${planted.length}\n`);
console.log('t(s)  zombie floors        states                 distances to their staircase');
for (let f = 0; f < 60 * 40; f++) {
  g.player.hp = 100;
  g.update(H);
  if (f % 300 === 0) {
    const fl = planted.map((z) => z.floor).join(',');
    const st = planted.map((z) => (z.state === 0 ? 'CLIMB' : NAME[z.state] ?? z.state)).join(',');
    const ds = planted.map((z) => {
      const hop = g.map.hopTowards(z.floor, g.map.floor);
      if (!hop) return 'nohop';
      const at = g.map.linkPos(hop.link, z.floor);
      return Math.round(Math.hypot(z.pos.x - at.x, z.pos.y - at.y));
    }).join(',');
    console.log(`${String((f / 60) | 0).padStart(4)}  ${fl.padEnd(20)} ${st.padEnd(22)} ${ds}`);
  }
}
const down = planted.filter((z) => z.floor === g.map.floor).length;
console.log(`\nreached the player's storey: ${down}/${planted.length}`);
