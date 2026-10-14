// Headless harness for the second wave of weapons.
//
// Eight new guns went into the box: a magnum, two SMGs, a semi-auto rifle, an
// assault rifle, a sawed-off, a marksman rifle and a pan-mag LMG. Every one of
// them has to build a sprite, hand back a definition, be reachable from the
// box, and actually fire without breaking the frame.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { WEAPONS, WEAPON_ORDER, defFor, rollBox } = await import(SRC + '/weapons.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 24601;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const NEW = ['python', 'sten', 'greasegun', 'garand', 'stg44', 'sawedoff', 'gewehr43', 'lewis'];

function boot() {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(2);
  g.powerOn = true;
  for (let i = 0; i < 20; i++) g.update(H);
  return g;
}

// ---- 1. every gun exists, is ordered, and has a sane definition ------------
{
  for (const id of NEW) {
    ok(WEAPONS[id], `${id} is not in the weapon table`);
    ok(WEAPON_ORDER.includes(id), `${id} is not in WEAPON_ORDER`);
    const d = defFor(id, false);
    ok(d && d.dmg > 0 && d.mag > 0 && d.delay > 0, `${id} has a broken def`);
    // the punched version has to exist too, or Pack-a-Punch would eat it
    const p = defFor(id, true);
    ok(p && p.packed, `${id} has no Pack-a-Punch definition`);
    ok(p.dmg >= d.dmg, `${id} gets weaker when it is punched (${d.dmg} -> ${p.dmg})`);
  }
  console.log(`  all ${NEW.length} guns are defined, ordered, and packable`);
}

// ---- 2. every gun builds a sprite ------------------------------------------
{
  const g = boot();
  for (const id of NEW) {
    const img = g.art.guns[id];
    ok(img && img.img && img.img.width > 4, `${id} has no sprite`);
    ok(img.flip && img.flip.width === img.img.width, `${id} has no flipped sprite`);
  }
  console.log('  every gun has a sprite and a facing');
}

// ---- 3. every gun fires and draws a frame ----------------------------------
{
  const g = boot();
  const cv = nc(M.VW, M.VH), ctx = cv.getContext('2d');
  for (const id of NEW) {
    g.player.giveWeapon(id);
    g.player.equip(id, false);
    g.player.active = Math.max(0, g.player.slots.indexOf(id));
    const slot = g.player.slot;
    slot.mag = WEAPONS[id].mag;
    slot.reserve = WEAPONS[id].reserve;
    g.player.fireTimer = 0;
    g.player.reloading = false;
    const before = slot.mag;
    g.player.fire(g);
    ok(slot.mag === before - 1, `${id} did not spend a round (${before} -> ${slot.mag})`);
    let threw = null;
    for (let i = 0; i < 12; i++) { g.update(H); }
    try { g.draw(ctx); } catch (e) { threw = e; }
    ok(!threw, `${id} threw while firing/drawing: ${threw?.message}`);
  }
  console.log('  every gun fires, spends a round, and draws cleanly');
}

// ---- 4. the box can hand out each of them ----------------------------------
// Use a fresh, isolated RNG: the boot() calls above have already walked the
// shared seeded generator, and the box draws must not depend on how far along it is.
{
  let rs = 777001;
  const rng = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  // only the new guns matter here -- the box rolls the whole table, so a
  // counter that includes the wonder weapons fills up long before every new
  // gun has had its turn
  const seen = new Set();
  for (let i = 0; i < 8000 && seen.size < NEW.length; i++) {
    const id = rollBox(rng);
    if (NEW.includes(id)) seen.add(id);
  }
  for (const id of NEW) ok(seen.has(id), `the box never offered a ${WEAPONS[id].name}`);
  console.log('  the box offers every one of the new guns');
}

// ---- 5. the shotgun really scatters, the sniper really does not ------------
{
  const pellets = (id) => WEAPONS[id].pellets ?? 1;
  ok(pellets('sawedoff') > 1, 'the sawed-off throws a single pellet');
  ok((WEAPONS.sawedoff.spread ?? 0) > (WEAPONS.gewehr43.spread ?? 1),
    'the sawed-off is tighter than the marksman rifle');
  ok(WEAPONS.gewehr43.range > WEAPONS.sawedoff.range, 'the marksman rifle outranges the shotgun');
  console.log('  the archetypes actually feel different');
}

if (fails.length) {
  console.log('WEAPONS FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('WEAPONS PASS  eight new guns, all firing, all in the box');
