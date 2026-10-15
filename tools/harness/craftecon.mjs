// Headless harness: the bench must never take money for nothing.
//
// The first bench did: +2 frags to a man already carrying nine, a 120 armour
// plate to a man already wearing one, a crate of ammo to full magazines, two
// planks to a house with no broken windows. The cost came off the purse first
// and the clamp happened after, so the player paid and got air. Every recipe
// now owes the bench a `useful()`, and this file holds them all to it --
// including the ones that are not on the bench today.
//
//   node craftecon.mjs
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l, x = '') => {
  console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`);
  if (!c) fails.push(l);
};

let seed = 424242;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();
g.started = true;
g.debug.god = true;
g.player.hurt = () => false;
const p = g.player;
const step = (n = 1) => { for (let i = 0; i < n; i++) { g.update(H); inp.endFrame(); } };

// hang the whole shelf on the bench: this file tests the contract, not what
// happens to be for sale this week
for (const [id, r] of Object.entries(M.SHELVED_RECIPES)) M.RECIPES[id] = r;

const lastPopup = () => g.popups.items[g.popups.items.length - 1]?.text ?? '';
/** Refuse: no money moves, and the reason is the useful one. */
const refuses = (id, want, label) => {
  g.popups.clear();
  const sal = p.salvage, pts = p.points;
  const got = g.tryCraft(id);
  ok(got === false, `${label}: refused`);
  ok(p.salvage === sal && p.points === pts,
    `${label}: took nothing`, `scrap ${sal}->${p.salvage}, pts ${pts}->${p.points}`);
  ok(lastPopup() === want, `${label}: says "${want}"`, `said "${lastPopup()}"`);
};
/** Accept: the cost comes off exactly once and the goods arrive. */
const accepts = (id, label, check) => {
  g.popups.clear();
  const r = M.RECIPES[id];
  const sal = p.salvage, pts = p.points;
  const got = g.tryCraft(id);
  ok(got === true, `${label}: built`);
  ok(p.salvage === sal - (r.salvage ?? 0), `${label}: scrap ${r.salvage} off`, `${sal}->${p.salvage}`);
  ok(p.points === pts - (r.points ?? 0), `${label}: points ${r.points ?? 0} off`, `${pts}->${p.points}`);
  if (check) ok(check(), `${label}: and the goods arrived`);
};
const purse = (scrap, points) => { p.salvage = scrap; p.points = points; };

console.log('--- a full pocket is not a sale ---');
// grenades: nine is the cap, and the old bench sold two more anyway
p.grenades = 9; purse(100, 9000);
refuses('fragkit', 'GRANADES FULL', 'frags at nine');
p.grenades = 0;
accepts('fragkit', 'frags at none', () => p.grenades === 2);

// armour: 120 is the cap
p.armor = 120; purse(100, 9000);
refuses('armorplate', 'ARMOUR FULL', 'armour at the cap');
p.armor = 0;
accepts('armorplate', 'armour from nothing', () => p.armor === 60);

// ammo: every carried gun already full
p.refillAllReserve(); purse(100, 9000);
refuses('ammocrate', 'AMMO FULL', 'ammo with full guns');
const owned = M.WEAPON_ORDER.find((id) => p.loadout[id]?.owned);
p.loadout[owned].reserve = 0;
accepts('ammocrate', 'ammo with one dry gun', () => p.loadout[owned].reserve > 0);

// planks: a house with nothing broken
for (const b of g.map.barricades) b.planks = b.maxPlanks;
purse(100, 9000);
refuses('plankkit', 'WINDOWS INTACT', 'planks with every window whole');
g.map.barricades[0].planks = 0;
accepts('plankkit', 'planks with one window out', () => g.map.barricades[0].planks === 2);

// medkits: three is a pocket
p.medkits = 3; purse(100, 9000);
refuses('medkit', 'POCKETS FULL', 'a fourth medkit');
p.medkits = 0;
accepts('medkit', 'the first medkit', () => p.medkits === 1);

// spikes: already up
g.workbench.spikesRounds = 3; purse(100, 9000);
refuses('spikes', 'SPIKES ALREADY UP', 'spikes while spikes are up');
g.workbench.spikesRounds = 0;
accepts('spikes', 'spikes on a bare window', () => g.workbench.spikesRounds === 3);

console.log('--- the reason that matters wins ---');
// broke AND full: "you cannot afford it" is the wrong answer, because buying
// it would be pointless even if you could
p.grenades = 9; purse(0, 0);
refuses('fragkit', 'GRANADES FULL', 'no scrap and nowhere to put them');
// broke and it would help: then the purse is the answer, and it says by how much
p.grenades = 0; purse(2, 0);
refuses('fragkit', 'NOT ENOUGH SCRAP', 'no scrap and room for them');
ok(M.craftRowNote(g, 'fragkit', 'salvage') === 'NEED 4 MORE SCRAP',
  'the row says how far short you are', M.craftRowNote(g, 'fragkit', 'salvage'));
purse(100, 0);
refuses('fragkit', 'NOT ENOUGH POINTS', 'scrap but no points');

console.log('--- one-per-run, and nothing that is not a blueprint ---');
M.RECIPES.plated = {
  id: 'plated', name: 'Plated Vest', salvage: 5, points: 0, once: true,
  colour: '#7aa8d0', glyph: 'V', desc: 'Test fixture: once per run.',
  apply: (game, who) => { who.armor = 30; },
};
purse(100, 9000);
accepts('plated', 'the first vest', () => p.armor === 30);
p.armor = 0;
refuses('plated', 'ALREADY BUILT', 'the second vest');
ok(p.crafted.plated === 1, 'and it is counted once', String(p.crafted.plated));

g.popups.clear();
const sal = p.salvage, pts = p.points;
ok(g.tryCraft('no_such_thing') === false, 'an unknown blueprint is refused');
ok(g.tryCraft('') === false, 'an empty id is refused');
ok(g.tryCraft('../../etc/passwd') === false, 'a path is refused');
ok(g.tryCraft('__proto__') === false, '__proto__ is not a blueprint');
ok(g.tryCraft(null) === false, 'null is refused');
ok(p.salvage === sal && p.points === pts, 'none of them took anything');
ok(g.popups.items.length === 0,
  'and none of them said anything: junk arrives off the wire, and a guest '
  + 'spamming ids must not paint over the host\'s screen',
  `${g.popups.items.length} popups, last "${lastPopup()}"`);
ok(Object.getPrototypeOf(p.crafted) === Object.prototype,
  'an id called __proto__ did not get into the crafted bag');
// a real refusal does say why -- that is the whole point of the row note
p.grenades = 9;
refuses('fragkit', 'GRANADES FULL', 'a known blueprint that cannot help');

console.log('--- the tally and the round tick ---');
const before = g.stats.crafted;
purse(100, 9000);
p.medkits = 0;
g.tryCraft('medkit');
ok(g.stats.crafted === before + 1, 'a build is tallied', `${before} -> ${g.stats.crafted}`);
g.workbench.spikesRounds = 1;
g.workbench.onRoundStart();
ok(g.workbench.spikesRounds === 0, 'spikes wear off with the round');
step(2);
ok(Number.isFinite(p.salvage) && Number.isFinite(p.points), 'the purse stays a number');

console.log('--- steel shutters: the whole house, once ---');
const caps = g.map.floors.map((F) => F.barricades.map((b) => b.maxPlanks));
const boards = g.map.floors.map((F) => F.barricades.map((b) => b.planks));
g.map.floors[0].barricades[0].planks = 0; boards[0][0] = 0;   // one chewed window, to watch the +2 land
let windows = 0;
for (const F of g.map.floors) windows += F.barricades.length;
purse(80, 6000);
accepts('shutters', 'shutters', () =>
  g.map.floors.every((F, f) => F.barricades.every((b, i) =>
    b.maxPlanks === caps[f][i] + 2 && b.planks === Math.min(b.maxPlanks, boards[f][i] + 2))));
ok(g.workbench.shuttersUp === true, 'the house remembers the shutters');
ok(windows > 10, `every one of the ${windows} windows was deepened, not just the ground floor`);
purse(80, 6000);
refuses('shutters', 'SHUTTERS ALREADY UP', 'a second pair of shutters');
ok(g.map.floors.every((F, f) => F.barricades.every((b, i) => b.maxPlanks === caps[f][i] + 2)),
  'the refusal left the caps alone');

console.log('--- the badges came back with the bench ---');
ok(g.achievements.has('field_medic'), 'the medkit earned Field Medic');
g.stats.crafted = 4;
purse(100, 9000);
p.medkits = 0;
g.tryCraft('medkit');
ok(g.achievements.has('master_crafter'), 'the fifth build earns Master Crafter');

for (const id of Object.keys(M.RECIPES)) delete M.RECIPES[id];

if (fails.length) {
  console.error(`\nCRAFTECON FAIL (${fails.length})`);
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log('\nCRAFTECON PASS  nothing on the bench takes money for nothing, and every no says why');
