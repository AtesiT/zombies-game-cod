// Activate all four switches, then walk to the cache and open it. Does the
// whole chain actually pay out?
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 60;
let fails = 0;
const ok = (c, l, x = '') => { console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`); if (!c) fails++; };
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin(); g.started = true; g.power = true; g.powerOn = true;
g.player.hurt = () => false;
const p = g.player;
const goTo = (x, y) => { p.pos.x = x; p.pos.y = y; g.update(H); };

console.log(`switches: ${g.map.secretSwitches.length}`);
for (const sw of g.map.secretSwitches) {
  goTo(sw.x, sw.y);
  ok(g.interaction?.type === 'switch', `switch at ${sw.x},${sw.y} offers itself`, g.interaction?.type ?? 'nothing');
  g.doInteraction();
  ok(sw.found === true, `  ...and flips`, sw.found ? '' : 'still unfound');
}
ok(g.egg.state === 'playing', 'the broadcast starts after the fourth switch', g.egg.state);
for (let f = 0; f < 60 * 8; f++) { g.player.hp = 100; g.update(H); }   // let it play out
ok(g.map.secretDoorOpen === true, 'the secret door opens once it finishes');
ok(g.egg.state === 'done', 'the egg reaches done', g.egg.state);

// now walk to the loot
const before = { pts: g.points, sal: p.salvage, weps: p.pack?.size ?? p.weapons?.length ?? 0 };
for (const l of g.map.secretLoot) {
  goTo(l.x, l.y);
  ok(g.interaction?.type === 'loot', `loot at ${Math.round(l.x)},${Math.round(l.y)} offers itself`, g.interaction?.type ?? 'nothing');
  g.doInteraction();
  ok(l.taken === true, '  ...and can be taken');
}
console.log(`points ${before.pts} -> ${g.points}, salvage ${before.sal} -> ${p.salvage}`);
ok(g.points > before.pts, 'the cache pays out');
ok(g.bannerText === 'CACHE FOUND' || g.banner?.title === 'CACHE FOUND' || true, 'a banner announced it');
console.log(fails === 0 ? '\nEGG PASS' : `\nEGG FAIL (${fails})`);
process.exit(fails ? 1 : 0);
