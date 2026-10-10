// Staircases have to be findable: a marker on the floor, an arrow saying
// which way it goes, a label when you are close, and a pin on the minimap.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 60, T = 24;
let fails = 0;
const ok = (c, l, x = '') => { console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`); if (!c) fails++; };
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cx = nc(M.VW, M.VH).getContext('2d');
g.begin(); g.started = true; g.power = true; g.powerOn = true;
g.player.hurt = () => false;

// stand next to the west stair on the ground floor and look at the pixels
const ink = () => {
  const d = cx.getImageData(0, 0, M.VW, M.VH).data;
  let warm = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 110 && d[i] - d[i + 2] > 45) warm++;
  return warm;
};
g.player.pos.x = 24 * 19; g.player.pos.y = 24 * 11;     // beside the west stair
for (let f = 0; f < 40; f++) { g.player.hp = 100; g.update(H); }
g.draw(cx);
const near = ink();
g.player.pos.x = 24 * 30; g.player.pos.y = 24 * 24;     // far away, down the room
for (let f = 0; f < 40; f++) { g.player.hp = 100; g.update(H); }
g.draw(cx);
const far = ink();
ok(near > far + 200, 'the stair draws a marker and label when you stand by it', `${near} vs ${far} warm px`);

// every storey's links are marked, pointing the right way
for (const f of [0, 1, 2]) {
  g.map.setFloor(f);
  g.useFloor(f);
  const links = g.map.linksOn(f);
  ok(links.length > 0, `storey ${f} has links to mark`, `${links.length}`);
  for (const l of links) {
    const here = l.a.floor === f ? l.a : l.b;
    const there = l.a.floor === f ? l.b : l.a;
    const up = there.floor > f;
    const dest = g.map.floors[there.floor]?.def?.name;
    console.log(`     ${l.name.padEnd(14)} at ${here.tx},${here.ty} -> ${up ? 'UP  ' : 'DOWN'} to ${dest}`);
    ok(!!dest, `  ${l.name}: destination named`);
  }
}
// the marker must not throw when the player is miles away
g.map.setFloor(0); g.useFloor(0);
g.player.pos.x = 100; g.player.pos.y = 900;
try { g.draw(cx); ok(true, 'drawing with every stair off screen is fine'); }
catch (e) { ok(false, 'drawing with every stair off screen is fine', e.message); }

console.log(fails === 0 ? '\nSTAIRS PASS' : `\nSTAIRS FAIL (${fails})`);
process.exit(fails ? 1 : 0);
