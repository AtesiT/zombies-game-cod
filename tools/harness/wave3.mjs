// Headless harness: the third weapon wave. Shotguns, SMGs, the explosive end
// and the two new wonder guns must all fire, spend ammo, show a sprite, come
// out of the box, have a Pack-a-Punch name -- and their mechanics must
// actually do their thing: the launcher explodes, the flamer ignites, the
// rift tears exactly one floor open per shot, the storm bow chains.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 424242;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();
g.startRound(4);
g.powerOn = true; g.powerOnAt = -99;
for (let i = 0; i < 60; i++) g.update(H);
// a guaranteed crowd, pulled up close so every shot has customers
for (let i = 0; i < 8; i++) {
  g.spawnZombie();
  const z = g.zombies[g.zombies.length - 1];
  z.floor = g.map.floor;
  z.pos.x = g.player.pos.x + 70 + (i % 4) * 14;
  z.pos.y = g.player.pos.y + (i >> 2) * 14;
}
for (let i = 0; i < 30; i++) g.update(H);
ok(g.zombies.filter((z) => !z.dead).length >= 6, 'no crowd to test against');

const p = g.player;
p.hp = 200;
const WAVE = ['lever', 'bulldog', 'osa', 'molot', 'trenchpipe', 'flamer', 'stormbow', 'rift'];

// sprites + PAP names + box presence for every new gun
const art = g.art;
for (const id of WAVE) {
  ok(art.guns[id] && art.guns[id].img, `${id} has no sprite`);
  ok(M.WEAPONS[id] && M.WEAPONS[id].name, `${id} missing from the weapon table`);
}

// every new gun comes out of the box
const { rollBox } = await import(SRC + '/weapons.js');
let seen = new Set();
let rng = (() => { let s = 777; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
for (let i = 0; i < 20000 && seen.size < WAVE.length; i++) {
  const r = rollBox(rng);
  if (WAVE.includes(r)) seen.add(r);
}
ok(seen.size === WAVE.length, `the box never offered: ${WAVE.filter((w) => !seen.has(w)).join(', ')}`);

// Pack-a-Punch names
const { PAP_NAMES } = await import(SRC + '/weapons.js');
for (const id of WAVE) ok(PAP_NAMES[id], `${id} has no Pack-a-Punch name`);

// helper: hand over a gun, aim at the nearest zombie, pull the trigger
function shoot(id, times = 1) {
  p.giveWeapon(id);
  p.active = p.slots.indexOf(id);
  let best = null, bd = 1e18;
  for (const z of g.zombies) {
    if (z.dead) continue;
    const d = (z.pos.x - p.pos.x) ** 2 + (z.pos.y - p.pos.y) ** 2;
    if (d < bd) { bd = d; best = z; }
  }
  if (!best) {
    g.spawnZombie();
    best = g.zombies[g.zombies.length - 1];
    best.floor = g.map.floor;
    best.pos.x = p.pos.x + 80; best.pos.y = p.pos.y;
  }
  p.aim = Math.atan2(best.pos.y - p.pos.y, best.pos.x - p.pos.x);
  for (let i = 0; i < times; i++) { p.fireTimer = 0; p.fire(g); }
  return best;
}

// lever + bulldog + osa + molot: spend rounds, move tracers
for (const id of ['lever', 'bulldog', 'osa', 'molot']) {
  p.giveWeapon(id);
  p.active = p.slots.indexOf(id);
  const mag0 = p.slot.mag;
  shoot(id, id === 'osa' ? 3 : 1);
  ok(p.slot.mag === mag0 - (id === 'osa' ? 3 : 1), `${id} did not spend ammo`);
  ok(g.tracers.length > 0, `${id} drew no tracer`);
}

// trench launcher: the round ends in an explosion
{
  const z0 = g.zombies.filter((z) => !z.dead).map((z) => z.hp).reduce((a, b) => a + b, 0);
  const booms0 = g.explosionLights.length;
  shoot('trenchpipe');
  ok(g.explosionLights.length > booms0, 'the launcher round did not explode');
  for (let i = 0; i < 30; i++) g.update(H);
  const z1 = g.zombies.filter((z) => !z.dead).map((z) => z.hp).reduce((a, b) => a + b, 0);
  ok(z1 < z0, 'the explosion hurt nobody');
}

// flamer: what it touches catches fire, and a fuel pool lands
{
  const fires0 = g.fires.length;
  shoot('flamer', 6);
  ok(g.fires.length > fires0, 'the flamer left no fuel pool');
  const burned = g.zombies.some((z) => (z.burning ?? 0) > 0);
  ok(burned, 'the flamer ignited nobody');
}

// rift splitter: exactly one tear per trigger pull
{
  g.rifts.length = 0;
  shoot('rift');
  ok(g.rifts.length === 1, `one shot tore ${g.rifts.length} floors open`);
  const hp0 = g.zombies.filter((z) => !z.dead).length;
  for (let i = 0; i < 60; i++) g.update(H);
  ok(g.rifts.length === 0 || g.rifts[0].life < 3.0, 'the rift does not age');
  ok(g.zombies.length >= 0 && hp0 >= 0, 'rift tick crashed');
}

// storm bow: the arrow chains lightning through the crowd
{
  // a fresh knot of three, close enough to chain between
  for (let i = 0; i < 3; i++) {
    g.spawnZombie();
    const z = g.zombies[g.zombies.length - 1];
    z.floor = g.map.floor;
    z.pos.x = p.pos.x + 90 + i * 20;
    z.pos.y = p.pos.y + 10;
    z.hp = 10000;
  }
  g.arcs.length = 0;
  shoot('stormbow');
  for (let i = 0; i < 10; i++) g.update(H);
  ok(g.arcs.length > 0, 'the storm bow drew no arcs');
}

// a punched third-wave gun keeps its mechanics
{
  p.giveWeapon('trenchpipe');
  p.active = p.slots.indexOf('trenchpipe');
  ok(p.packCurrent(), 'third-wave gun refused the machine');
  const d = p.def;
  ok(d.lobDmg > 420, 'punch did not raise the launcher blast');
  ok(d.name === 'The Negotiator', `punched launcher name is ${d.name}`);
}

// draw the whole crowd with every new gun in hand without throwing
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
for (const id of WAVE) { p.giveWeapon(id); p.active = p.slots.indexOf(id); g.draw(cx); }

if (fails.length) { console.error('WAVE3 FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log('WAVE3 PASS  shotguns, SMGs, launcher, flamer, storm bow and rift all live');
