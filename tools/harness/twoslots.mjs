// Headless harness: a soldier carries two guns, period. A third weapon must
// knock the one in the hands out of the kit -- box pull, wall buy or debug
// gift, the rule is the same -- and the dropped gun takes its Pack-a-Punch
// upgrade with it.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 90210;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();
const p = g.player;

ok(p.ownedWeapons().length === 1, 'does not start with exactly one gun');

// first pickup fills the free slot
ok(p.giveWeapon('mp40') === 'weapon', 'first pickup was not a weapon grant');
ok(p.ownedWeapons().length === 2, 'first pickup did not fill the second slot');
ok(p.slots.includes('mp40'), 'mp40 is not in a slot');

// buying ammo for an owned gun must not add a third
ok(p.giveWeapon('mp40') === 'ammo', 're-buying an owned gun did not top up ammo');
ok(p.ownedWeapons().length === 2, 'ammo top-up changed the weapon count');

// punch the gun in hand, then take a third: the punched one must be the drop
p.active = p.slots.indexOf('mp40');
ok(p.packCurrent(), 'pack-a-punch refused');
ok(p.packed.has('mp40'), 'mp40 not registered as packed');
ok(p.giveWeapon('thompson') === 'weapon', 'third gun was not granted');
ok(p.ownedWeapons().length === 2, 'carrying three weapons after a third pickup');
ok(p.loadout.thompson.owned && p.current === 'thompson', 'the new gun is not in the hands');
ok(!p.loadout.mp40.owned, 'the gun in the hands was not the one dropped');
ok(p.packed.size === 0, 'the dropped gun kept its Pack-a-Punch upgrade');

// picking the dropped gun back up returns a fresh, unpunched copy
ok(p.giveWeapon('mp40') === 'weapon', 'dropped gun did not come back as a weapon');
ok(!p.packed.has('mp40'), 'dropped gun came back punched');
ok(p.ownedWeapons().length === 2, 'swap grew the kit');
ok(!p.loadout.thompson.owned, 'thompson should have been the one dropped');

// the mystery box obeys the same law
g.box.state = 'offering';
g.box.weapon = 'kar98k';
const id = g.box.take();
ok(id === 'kar98k', 'box did not offer what it was holding');
p.giveWeapon(id);
ok(p.ownedWeapons().length === 2, 'box pull grew the kit past two');
ok(p.loadout.kar98k.owned, 'box gun not owned');

// swapping between the two carried guns still works
const before = p.current;
p.swapActive();
ok(p.current !== before, 'swap between the two guns is dead');

// and the HUD-facing weapon count never exceeds two for long
for (const w of ['garand', 'stg44', 'sawedoff', 'python']) p.giveWeapon(w);
ok(p.ownedWeapons().length === 2, 'rapid pickups grew the kit');

if (fails.length) { console.error('TWOSLOTS FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log('TWOSLOTS PASS  two-gun limit holds; third gun replaces the one in hand; PAP drops with it');
