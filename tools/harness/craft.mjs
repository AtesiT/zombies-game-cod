// Headless harness: the workbench.
//
//   1. a bare bench still opens, still draws, and says so instead of lying
//   2. the menu is usable by keys, by mouse and by thumb -- a phone has no
//      digits, and the bench used to be openable and then unusable on one
//   3. E closes it. It used to close it and reopen it in the same frame,
//      because the interaction code underneath read the same press again
//   4. the movement keys belong to the list while it is up
//   5. walking off, or taking the stairs, shuts it
//
//   node craft.mjs
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l, x = '') => {
  console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`);
  if (!c) fails.push(l);
};

let seed = 20261015;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();
g.started = true;
g.debug.god = true;
g.player.hurt = () => false;
const ctx = nc(M.VW, M.VH).getContext('2d');
const step = (n = 1) => { for (let i = 0; i < n; i++) { g.update(H); inp.endFrame(); } };
const p = g.player;

/** The bench is on the roof and nowhere else: go up and stand at it. */
const toBench = () => {
  g.map.setFloor(2);
  g.useFloor(2);
  p.floor = 2;
  p.pos.x = g.workbench.x;
  p.pos.y = g.workbench.y + 12;
  p.vel.x = 0; p.vel.y = 0;
  p.craftOpen = false;
  step(2);
};
const press = (code) => { inp.pressed.add(code); };
const card = (i) => {
  const L = M.craftLayout(g, M.VW, M.VH);
  return {
    L,
    x: L.x0 + (i % L.cols) * (L.cw + L.gap) + L.cw / 2,
    y: L.y0 + ((i / L.cols) | 0) * (L.ch + L.gap) + L.ch / 2,
  };
};
// what the bench shipped with, kept aside so clear()/hang() can put it back
const SHIPPED_SET = Object.fromEntries(M.recipeIds().map((id) => [id, M.RECIPES[id]]));
const hang = () => {
  Object.assign(M.RECIPES, SHIPPED_SET);
  for (const [id, r] of Object.entries(M.SHELVED_RECIPES)) M.RECIPES[id] = r;
};
const clear = () => { for (const id of Object.keys(M.RECIPES)) delete M.RECIPES[id]; };

// ---------------------------------------------------------------- part 1 ----
// What ships on the bench today: two consumables and one change to the house.
console.log('--- what ships on the bench ---');
const SHIPPED = M.recipeIds();
ok(SHIPPED.join(',') === 'medkit,armorplate,shutters',
  'the bench ships medkit, armour plate and steel shutters', SHIPPED.join(',') || 'nothing');
ok(M.RECIPES.shutters.salvage === 30 && M.RECIPES.shutters.points === 2500,
  'shutters cost 30 scrap and 2500 points',
  `${M.RECIPES.shutters.salvage}/${M.RECIPES.shutters.points}`);
for (const id of SHIPPED) {
  const why = g.workbench.canCraft(g, id, g.player);
  ok(why !== 'ok', `${id} refuses an empty purse`, String(why));
}
// a bench with nothing hung must still open, draw and close honestly
console.log('--- a cleared bench stays honest ---');
clear();
ok(M.recipeIds().length === 0, 'a cleared bench has nothing on it');
toBench();
ok(g.interaction?.type === 'workbench', 'standing at the bench offers it', g.interaction?.type ?? 'nothing');
press('KeyE'); step();
ok(g.craftOpen === true, 'E opens the bench even with nothing on it');
let drew = true;
try { g.draw(ctx); } catch (e) { drew = false; console.log('   draw threw:', e.message); }
ok(drew, 'the bare bench draws');
ok(M.craftRowAt(g, M.VW, M.VH, 400, 200) === -1, 'a bare bench has no row to hit');
inp.mouse.x = 400; inp.mouse.y = 200; inp.mouse.pressed = true;
step();
ok(g.craftOpen === true, 'clicking a bare bench does not close or crash it');
inp.mouse.pressed = false;
press('KeyE'); step();
ok(g.craftOpen === false, 'E steps away from a bare bench');

// ---------------------------------------------------------------- part 2 ----
// E must close it, and stay closed. This is the bug the harness exists for.
console.log('--- E closes what E opened ---');
hang();
toBench();
press('KeyE'); step();
ok(g.craftOpen === true, 'E opens the bench');
press('KeyE'); step();
ok(g.craftOpen === false, 'E closes it again (it used to reopen in the same frame)');
step(3);
ok(g.craftOpen === false, '...and it stays closed');
press('KeyF'); step();
ok(g.craftOpen === true, 'F opens it too, which is what a phone has');
press('KeyF'); step();
ok(g.craftOpen === false, 'F closes it too');
press('KeyE'); step();
press('Escape'); step();
ok(g.craftOpen === false, 'Escape still closes it');

// ---------------------------------------------------------------- part 3 ----
// The pointer: hit-test the cards, the gutters and the space outside.
console.log('--- the pointer can hit a card ---');
toBench();
press('KeyE'); step();
const ids = M.recipeIds();
const at = (id) => ids.indexOf(id);
ok(ids.length === 7, 'the shipped three plus the shelved four are on the bench', ids.join(','));
ok(ids.slice(0, 3).join(',') === SHIPPED.join(','), 'the shipped stock sits at the top of the menu');
let hits = 0;
for (let i = 0; i < ids.length; i++) {
  const c = card(i);
  if (M.craftRowAt(g, M.VW, M.VH, c.x, c.y) === i) hits++;
}
ok(hits === ids.length, `every card centre is its own card (${hits}/${ids.length})`);
const L = M.craftLayout(g, M.VW, M.VH);
ok(M.craftRowAt(g, M.VW, M.VH, L.x0 + L.cw + L.gap / 2, L.y0 + 10) === -1,
  'the gutter between two columns hits nothing');
ok(M.craftRowAt(g, M.VW, M.VH, L.x0 - 30, L.y0 + 10) === -1, 'outside the panel hits nothing');
ok(M.craftRowAt(g, M.VW, M.VH, L.x0 + 10, L.y0 + L.rows * (L.ch + L.gap)) === -1,
  'below the last row hits nothing');

// hovering moves the selection
const c3 = card(3);
inp.mouse.x = c3.x; inp.mouse.y = c3.y;
step();
ok(p.craftRow === 3, 'hovering a card selects it', String(p.craftRow));

// and clicking it builds it
p.salvage = 40; p.points = 5000; p.medkits = 0;
const c0 = card(0);
ok(ids[0] === 'medkit', 'the first card is the medkit', ids[0]);
inp.mouse.x = c0.x; inp.mouse.y = c0.y; inp.mouse.pressed = true;
step();
inp.mouse.pressed = false;
ok(p.medkits === 1, 'clicking the medkit card built one', String(p.medkits));
ok(p.salvage === 32, `...and took 8 scrap for it (${p.salvage})`);

// a click on the card must not also pull the trigger
const magBefore = p.slot?.mag ?? 0;
inp.mouse.x = c0.x; inp.mouse.y = c0.y; inp.mouse.down = true; inp.mouse.pressed = true;
step(4);
inp.mouse.down = false; inp.mouse.pressed = false;
ok((p.slot?.mag ?? 0) === magBefore,
  `clicking a card did not fire the gun (${magBefore} -> ${p.slot?.mag ?? 0})`);

// ---------------------------------------------------------------- part 4 ----
// Keys: digits, arrows, Enter.
console.log('--- keys still work ---');
toBench(); press('KeyE'); step();
p.salvage = 60; p.points = 5000; p.medkits = 0;
press('Digit1'); step();
ok(p.medkits === 1, 'Digit1 built the first card', String(p.medkits));
p.grenades = 0;
press(`Digit${at('fragkit') + 1}`); step();
ok(p.grenades === 2, `Digit${at('fragkit') + 1} built the frag bundle`, String(p.grenades));
// arrows walk the grid: two columns, so down is +2. The pointer is parked
// off the panel first -- a resting mouse must not fight the arrows.
inp.mouse.x = 6; inp.mouse.y = 6;
p.craftRow = 0;
press('ArrowDown'); step();
ok(p.craftRow === M.craftLayout(g, M.VW, M.VH).cols, 'ArrowDown walks a row', String(p.craftRow));
press('ArrowRight'); step();
ok(p.craftRow === M.craftLayout(g, M.VW, M.VH).cols + 1, 'ArrowRight walks a card', String(p.craftRow));
// ...and a mouse parked on another card must not overrule them
const parked = card(0);
inp.mouse.x = parked.x; inp.mouse.y = parked.y;
p.craftRow = 4;
press('ArrowDown'); step();
ok(p.craftRow === (4 + M.craftLayout(g, M.VW, M.VH).cols) % ids.length,
  'a resting pointer does not fight the arrows', String(p.craftRow));
inp.mouse.x = 6; inp.mouse.y = 6;
// Enter builds whatever is lit
p.craftRow = ids.indexOf('medkit');
p.medkits = 0; p.salvage = 60;
press('Enter'); step();
ok(p.medkits === 1, 'Enter built the selected card', String(p.medkits));

// ---------------------------------------------------------------- part 5 ----
// While the list is up, the movement keys are the list's.
console.log('--- the menu owns the movement keys ---');
toBench(); press('KeyE'); step();
const y0 = p.pos.y, x0 = p.pos.x;
inp.keys.add('KeyS');
step(30);
inp.keys.delete('KeyS');
ok(Math.abs(p.pos.y - y0) < 1 && Math.abs(p.pos.x - x0) < 1,
  'holding S at the bench does not walk you off it',
  `moved ${Math.hypot(p.pos.x - x0, p.pos.y - y0).toFixed(1)}px`);
// ...and they walk again the moment it shuts
press('KeyE'); step();
inp.keys.add('KeyS');
step(20);
inp.keys.delete('KeyS');
ok(p.pos.y - y0 > 5, 'with the menu shut, S walks', `moved ${(p.pos.y - y0).toFixed(1)}px`);

// ---------------------------------------------------------------- part 6 ----
// Leaving shuts it: walking off, and taking the stairs down.
console.log('--- leaving shuts it ---');
toBench(); press('KeyE'); step();
ok(g.craftOpen === true, 'open at the bench');
p.pos.x += 200;
step();
ok(g.craftOpen === false, 'walking 200px off shuts it');
toBench(); press('KeyE'); step();
ok(g.craftOpen === true, 'open again');
g.map.setFloor(0); g.useFloor(0); p.floor = 0;
step();
ok(g.craftOpen === false, 'taking the stairs down shuts it (the bench is on the roof only)');

clear();
Object.assign(M.RECIPES, SHIPPED_SET);
if (fails.length) {
  console.error(`\nCRAFT FAIL (${fails.length})`);
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log('\nCRAFT PASS  bare bench honest, keys + mouse + thumb all build, E closes, the list owns the arrows');
