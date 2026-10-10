// Headless harness for the things that used to bleed through the ceiling.
//
// The bodies themselves were always culled to the storey you are standing on,
// but everything they *did* was not. A walker pacing about upstairs dragged a
// pair of glowing eyes across your wall. It bled on your floor, it dropped
// "+130" over your shoulder, its grenade blew your legs off from above, and
// the Max Ammo it dropped landed at your feet. None of it was on your floor.
//
// Every effect now carries the number of the storey it was made on, and only
// the storey you are looking at gets to show it.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { Powerup } = await import(SRC + '/powerups.js');
const H = 1 / 60;
const T = 24;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

// a deterministic world, so a frame can be compared with itself
let seed = 20261010;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

function boot() {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(2);
  for (let i = 0; i < 90; i++) g.update(H);
  return g;
}

/** A canvas context that counts how many marks were actually made on it. */
function spyCtx() {
  const t = { ops: 0 };
  return new Proxy(t, {
    get(o, k) {
      if (k === 'ops') return o.ops;
      if (k === 'canvas') return { width: M.VW, height: M.VH };
      return () => { o.ops++; };
    },
    set() { return true; },
  });
}

// ---- 1. the eyes: a walker upstairs must not glow in through the wall ------
// This was the loudest of them all. The actor pass filtered by storey; the
// glow pass that runs over the same zombies did not.
{
  const g = boot();
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  g.draw(ctx);
  const before = Uint8ClampedArray.from(ctx.getImageData(0, 0, M.VW, M.VH).data);

  const px = g.player.pos.x + 46, py = g.player.pos.y - 20;
  const up = g.makeZombie({ x: px, y: py, floor: 1 });
  up.floor = 1;
  g.zombies.push(up);
  g.draw(ctx);
  const withUpstairs = ctx.getImageData(0, 0, M.VW, M.VH).data;

  let diff = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] !== withUpstairs[i] || before[i + 1] !== withUpstairs[i + 1]
      || before[i + 2] !== withUpstairs[i + 2]) diff++;
  }
  ok(diff === 0, `a walker on another storey still paints ${diff} pixels on yours`);

  // ...and the test can see a walker when it is actually there
  g.zombies.pop();
  const here = g.makeZombie({ x: px, y: py, floor: 0 });
  here.floor = 0;
  g.zombies.push(here);
  const c2 = nc(M.VW, M.VH).getContext('2d');
  g.draw(c2);
  const withHere = c2.getImageData(0, 0, M.VW, M.VH).data;
  let diff2 = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] !== withHere[i] || before[i + 1] !== withHere[i + 1]
      || before[i + 2] !== withHere[i + 2]) diff2++;
  }
  ok(diff2 > 80, `the frame cannot even see a walker on your own storey (${diff2} pixels)`);
  console.log(`  eyes: ${diff} pixels from upstairs, ${diff2} from your own floor`);
}

// ---- 2. blood and score belong to the storey that made them ----------------
{
  const g = boot();
  const px = g.player.pos.x + 30, py = g.player.pos.y;
  const z = g.makeZombie({ x: px, y: py, floor: 1 });
  z.floor = 1;
  g.zombies.push(z);
  const before = g.particles.items.length;
  g._fxOn(z);
  z.hurt(99999, false, g, 0);
  const made = g.particles.items.slice(before);
  ok(made.length > 0, 'killing a walker made no mess at all');
  ok(made.every((p) => p.f === 1),
    `${made.filter((p) => p.f !== 1).length} specks of it forgot which storey they came from`);

  const c0 = spyCtx(), c1 = spyCtx();
  g.particles.draw(c0, 0);
  g.particles.draw(c1, 1);
  ok(c0.ops === 0, `${c0.ops} marks from another storey landed on this one`);
  ok(c1.ops > 0, 'the mess vanished from its own storey too');

  // the same for the floating score
  const pb = g.popups.items.length;
  g.addPoints(130, px, py, '#fff', z);
  const pops = g.popups.items.slice(pb);
  ok(pops.length > 0, 'no score floated up');
  ok(pops.every((p) => p.f === 1), 'the score forgot which storey it was earned on');
  // the popup pass opens with a save() of its own, so measure it against an
  // empty pass rather than against zero
  const stash = g.popups.items.splice(0, g.popups.items.length);
  const idle = spyCtx();
  g.popups.draw(idle, 0);
  g.popups.items.push(...stash);
  const p0 = spyCtx(), p1 = spyCtx();
  g.popups.draw(p0, 0);
  g.popups.draw(p1, 1);
  ok(p0.ops === idle.ops, 'a score from another storey is floating over your head');
  ok(p1.ops > idle.ops, 'the score vanished from the storey that earned it');
  console.log(`  blood: ${made.length} specks and ${pops.length} score, none of them here`);
}

// ---- 3. a grenade only blows up the storey it was thrown on ----------------
{
  const g = boot();
  const px = g.player.pos.x + 40, py = g.player.pos.y;
  const down = g.makeZombie({ x: px, y: py, floor: 0 });
  const up = g.makeZombie({ x: px, y: py, floor: 1 });
  down.hp = down.maxHp = 99999;
  up.hp = up.maxHp = 99999;
  g.zombies.push(down, up);

  const gr = new M.Grenade(px, py, 0, 0, 1);
  ok(gr.floor === 1, 'a grenade does not remember the storey it was thrown from');
  g._fxOn(gr);
  gr.explode(g);
  ok(down.hp === 99999, 'a blast upstairs took the legs off a walker down here');
  ok(up.hp < 99999, 'a blast did not even reach its own storey');
  ok(g.particles.items.slice(-40).every((p) => p.f === 1),
    'the blast sprayed sparks on a storey it never happened on');
  console.log(`  blast: downstairs ${down.hp}, upstairs ${up.hp}`);
}

// ---- 4. a drop belongs to the storey it fell on -----------------------------
{
  const g = boot();
  const px = g.player.pos.x, py = g.player.pos.y;
  const up = new Powerup(px, py, 'maxammo', 1);
  g.powerups.push(up);
  for (let i = 0; i < 8; i++) g.update(H);
  ok(g.powerups.includes(up), 'a drop from upstairs was collected down here');
  // ...and it is still there waiting when you climb up to it
  up.f = 0;
  g.update(H);
  ok(!g.powerups.includes(up), 'a drop on your own storey was not picked up');
  console.log('  drops: one stayed upstairs, one was picked up here');
}

// ---- 5. the DG-2 arc must not crawl up the stairs ---------------------------
{
  const g = boot();
  const def = M.WEAPONS.wunderwaffe;
  ok(def?.special === 'chain', 'the wonder weapon lost its chain');
  const px = g.player.pos.x + 34, py = g.player.pos.y;
  const here = g.makeZombie({ x: px, y: py, floor: 0 });
  const up = g.makeZombie({ x: px + 8, y: py, floor: 1 });
  here.hp = here.maxHp = 99999;
  up.hp = up.maxHp = 99999;
  g.zombies.push(here, up);
  g.arcs.length = 0;
  g.applySpecial(def, px, py, null, 1);
  ok(here.hp < 99999, 'the chain did not reach the walker standing right there');
  ok(up.hp === 99999, 'the chain crawled up to another storey');
  ok(g.arcs.length > 0 && g.arcs.every((a) => a.f === 0),
    `${g.arcs.filter((a) => a.f !== 0).length} arcs were drawn on another storey`);
  console.log(`  chain: ${g.arcs.length} arcs, all of them on this storey`);
}

// ---- 6. and you only hear them properly when they are on your floor ---------
{
  const g = boot();
  const up = g.makeZombie({ x: g.player.pos.x, y: g.player.pos.y, floor: 1 });
  const here = g.makeZombie({ x: g.player.pos.x, y: g.player.pos.y, floor: 0 });
  ok(up._muffled(g) === true, 'a walker directly overhead is as loud as one in the room');
  ok(here._muffled(g) === false, 'a walker in the room with you is muffled');
}

if (fails.length) {
  console.log('FLOORSFX FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('FLOORSFX PASS  nothing upstairs reaches the storey you are standing on');
