// Headless harness: the TEST RANGE polygon. Every gun in the game must be
// takeable off its rack, every creature must come out of its button, the
// clear/freeze controls must work, and the round machinery must stay quiet.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 777001;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g._loadMap(true);
g.begin();
g._rangeSetup();
for (let i = 0; i < 60; i++) g.update(H);

ok(g.map.mode === 'range', 'the map is not in range mode');
ok(g.powerOn && g.debug.god, 'the range did not come up powered and safe');
ok(g.map.floor === 0, 'range floor');

// the start tile is walkable
const p = g.player;
ok(!g.map.solidAt(Math.floor(p.pos.x / 24), Math.floor(p.pos.y / 24)), 'player starts inside a wall');

// ---- every gun on the walls can be taken ----------------------------------
let taken = 0;
for (const id of M.WEAPON_ORDER) {
  const wb = g.map.wallBuys.find((b) => b.weapon === id);
  ok(!!wb, `${id} has no rack on the range`);
  if (!wb) continue;
  p.pos.x = wb.x; p.pos.y = wb.y + 4;
  const it = g.interactionFor(p);
  ok(it && it.type === 'wallbuy' && it.weapon === id, `standing at the ${id} rack offers ${it?.type}/${it?.weapon}`);
  g.doInteraction();
  ok(p.current === id, `taking the ${id} rack did not put it in the hands`);
  taken++;
}
ok(taken === M.WEAPON_ORDER.length, `only ${taken}/${M.WEAPON_ORDER.length} racks handed over their gun`);
ok(p.ownedWeapons().length <= 2, 'the range broke the two-gun law');

// ---- every creature button spawns that creature ---------------------------
const types = Object.keys(M.ENEMY_TYPES);
for (const t of types) {
  const pad = g.map.rangePads.find((q) => q.type === t);
  ok(!!pad, `${t} has no button`);
  if (!pad) continue;
  p.pos.x = pad.x + 6; p.pos.y = pad.y;
  const before = g.zombies.filter((z) => z.type === t && !z.dead).length;
  const it = g.interactionFor(p);
  ok(it && it.type === 'pad' && it.pad.type === t, `the ${t} button offers ${it?.type}`);
  g.doInteraction();
  const after = g.zombies.filter((z) => z.type === t && !z.dead).length;
  ok(after === before + 1, `pressing ${t} spawned ${after - before}`);
}

// ---- freeze and clear ------------------------------------------------------
const clearPad = g.map.rangePads.find((q) => q.pad === 'clear');
p.pos.x = clearPad.x + 6; p.pos.y = clearPad.y;
ok(g.interactionFor(p)?.type === 'pad', 'clear pad unreachable');
g.doInteraction();
ok(g.zombies.length === 0, 'clear did not clear');

const frz = g.map.rangePads.find((q) => q.pad === 'freeze');
p.pos.x = frz.x + 6; p.pos.y = frz.y;
g.doInteraction();
ok(g._dbgFreeze, 'freeze pad did not hold them');
g.doInteraction();
ok(!g._dbgFreeze, 'freeze pad did not release');

// ---- the round machinery stays quiet --------------------------------------
const r0 = g.round;
for (let i = 0; i < 60 * 8; i++) g.update(H);
ok(g.round === r0, `the range advanced to round ${g.round} by itself`);

// drawing the whole hall with a crowd must not throw
const pad0 = g.map.rangePads[0];
p.pos.x = pad0.x + 6; p.pos.y = 26 * 24;
for (let i = 0; i < 5; i++) { g.doInteraction?.(); }
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
g.draw(cx);

// ---- back to the campaign: nothing may leak across ------------------------
const unlockBefore = g.achievements.unlock;
g._loadMap(false);
g.begin();
for (let i = 0; i < 60; i++) g.update(H);
ok(g.map.mode === 'campaign', 'leaving the range did not restore the campaign');
ok(g.map.floors.length === 3, 'campaign storeys lost');
ok(!g.powerOn, 'the range left the generator on');
ok(!g.debug.god && !g.debug.ammo, 'sandbox cheats leaked into the campaign');
ok(g.player.points === 500, `pockets carried over: ${g.player.points}`);
ok(g.player.slots[0] === 'm1911' && g.player.slots[1] === null, 'range guns leaked into the campaign');
ok(g.achievements.unlock !== unlockBefore, 'the achievement lock was not handed back');
g.doInteraction();   // no crash with a fresh campaign map

if (fails.length) { console.error('RANGE FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log(`RANGE PASS  ${M.WEAPON_ORDER.length} racks hand over guns, ${types.length} buttons spawn creatures, round stays put`);
