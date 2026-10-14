// Headless harness for the night on every storey.
//
// The lighting pass used to die on the way upstairs. A guard for the
// Pack-a-Punch drum -- which only exists on the ground floor -- was written
// as a bare `return`, so on the second floor and the roof the whole thing
// bailed out before it drew anything: no darkness, no torch, no lamps, no
// muzzle flash, no bloom, and no composite() at all. Two storeys of the game
// had no lighting whatsoever, and the one place you would notice first is
// the flash of your own gun: huge downstairs, invisible up top.
//
// The lamp list had the same problem in miniature -- it read the ground
// floor's hand-placed table on every storey, so the barracks lamps never lit.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { Lighting } = await import(SRC + '/lighting.js');
const { defFor } = await import(SRC + '/weapons.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 9182736;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

// count how many times the darkness layer actually reaches the screen
let composites = 0;
const realComposite = Lighting.prototype.composite;
Lighting.prototype.composite = function (...a) { composites++; return realComposite.apply(this, a); };

function bootAt(floor) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(2);
  g.powerOn = true;
  for (let i = 0; i < 40; i++) g.update(H);
  if (floor) {
    const lk = (g.map.links ?? []).find((l) => l.a.floor === floor || l.b.floor === floor);
    if (lk) {
      const dest = lk.a.floor === floor ? lk.a : lk.b;
      g.goToFloor(floor, { x: (dest.tx + 0.5) * 24, y: (dest.ty + 0.5) * 24 }, lk);
    }
  }
  for (let i = 0; i < 20; i++) g.update(H);
  return g;
}

function frame(g) {
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  composites = 0;
  g.draw(ctx);
  const d = ctx.getImageData(0, 0, M.VW, M.VH).data;
  let sum = 0, dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += v;
    if (v < 14) dark++;
  }
  const n = d.length / 4;
  return { mean: sum / n, dark: dark / n, composites, data: d };
}

// ---- 1. every storey runs the whole lighting pass ---------------------------
const per = [];
for (let f = 0; f < 3; f++) {
  const g = bootAt(f);
  ok(g.map.floor === f, `could not get to storey ${f} (ended on ${g.map.floor})`);
  const lit = frame(g);
  ok(lit.composites === 1, `storey ${f} never reached the lighting composite`);
  per.push({ f, ...lit, g });

  // the darkness layer is really there: `begin()` fills it, and `composite()`
  // puts it on the screen. (Blanking it proves nothing on the bright storeys
  // -- up there the sky light punches most of it back out again, by design.)
  const L = g.lighting;
  const layer = L.ctx.getImageData(0, 0, L.w, L.h).data;
  let da = 0;
  for (let i = 3; i < layer.length; i += 4) da += layer[i];
  da /= layer.length / 4;
  ok(da > 4, `storey ${f} laid down no darkness at all (mean alpha ${da.toFixed(1)})`);

  // and it is not a black screen: the brief is atmosphere, not a cave
  ok(lit.mean > 26, `storey ${f} is grim dark: mean brightness ${lit.mean.toFixed(1)}`);
  ok(lit.dark < 0.42, `storey ${f} is ${(lit.dark * 100).toFixed(0)}% near-black pixels`);
  console.log(`  storey ${f}: mean ${lit.mean.toFixed(1)}, ${(lit.dark * 100).toFixed(1)}% near-black, `
    + `${g.lampsHere().length} lamps, ambient ${L.ambientAlpha}`);
}

// the roof is outdoors: it must read brighter than the ground floor
{
  const ground = per.find((p) => p.f === 0);
  const roof = per.find((p) => p.f === 2);
  ok(roof && roof.mean > ground.mean,
    `the roof (${roof?.mean.toFixed(1)}) is darker than the ground floor (${ground.mean.toFixed(1)})`);
}

// ---- 2. the lamps belong to the storey you are on ---------------------------
{
  const g0 = bootAt(0), g1 = bootAt(1);
  const l0 = g0.lampsHere(), l1 = g1.lampsHere();
  ok(l0.length > 0 && l1.length > 0, 'a storey has no lamps at all');
  ok(l0 !== l1, 'both storeys are using the same lamp table');
  const same = l1.every((l) => l0.some((o) => o.x === l.x && o.y === l.y));
  ok(!same, 'the second floor is being lit by the ground floor lamps');
  console.log(`  lamps: ${l0.length} downstairs, ${l1.length} upstairs`);
}

// ---- 3. your own muzzle flash is visible on every storey --------------------
for (let f = 0; f < 3; f++) {
  const g = bootAt(f);
  g.muzzleFlash = null; g.flashLights.length = 0;
  const before = frame(g).mean;
  g.player.fireTimer = 0;
  g.player.slot.mag = 30;
  g.player.fire(g);
  g.update(1 / 240);            // a quarter of the way through the flash
  const after = frame(g).mean;
  ok(after - before > 0.8,
    `storey ${f}: the muzzle flash lit nothing (+${(after - before).toFixed(2)})`);
  ok(after - before < 9,
    `storey ${f}: the muzzle flash still washes the room out (+${(after - before).toFixed(2)})`);
  console.log(`  flash on storey ${f}: +${(after - before).toFixed(2)} mean brightness`);
}

// ---- 4. a punched gun flashes less, and throws a thinner ribbon -------------
{
  const g = bootAt(0);
  const plain = defFor('m1911', false), punched = defFor('m1911', true);

  // the bang: the packed one must be the smaller of the two
  function flashOf(def) {
    const gg = bootAt(0);
    gg.muzzleFlash = null; gg.flashLights.length = 0;
    gg.player.loadout.m1911 = { owned: true, mag: 30, reserve: 120 };
    gg.player.equip('m1911', false);
    gg.player.active = Math.max(0, gg.player.slots.indexOf('m1911'));
    gg.player.packed.clear();
    if (def.packed) gg.player.packed.add('m1911');
    gg.player.fireTimer = 0;
    gg.player.slot.mag = 30;
    gg.player.fire(gg);
    return { size: gg.muzzleFlash.size, r: gg.flashLights[0].r };
  }
  const a = flashOf(plain), b = flashOf(punched);
  ok(b.size < a.size, `the packed flash is not smaller (${a.size} -> ${b.size})`);
  ok(b.r < a.r, `the packed flash light is not smaller (${a.r} -> ${b.r})`);
  console.log(`  packed flash: size ${a.size} -> ${b.size}, light ${a.r} -> ${b.r}`);

  // the round: measure what the tracer itself adds, by diffing the frame
  // against the same frame without it -- counting bright pixels in a band
  // mostly measures the floor
  function tracerWidth(def) {
    const gg = bootAt(0);
    gg.tracers.length = 0;
    gg.player.packed.clear();
    if (def.packed) gg.player.packed.add('m1911');
    const before = frame(gg).data;
    gg.tracers.push({
      x0: gg.player.pos.x, y0: gg.player.pos.y,
      x1: gg.player.pos.x + 220, y1: gg.player.pos.y,
      life: 0.06, max: 0.06, colour: def.tracer, packed: !!def.packed, f: gg.map.floor,
    });
    const after = frame(gg).data;
    let lit = 0, sum = 0;
    for (let i = 0; i < before.length; i += 4) {
      const b = (before[i] + before[i + 1] + before[i + 2]) / 3;
      const a = (after[i] + after[i + 1] + after[i + 2]) / 3;
      if (a - b > 10) { lit++; sum += a - b; }
    }
    return { lit, sum };
  }
  const plainPx = tracerWidth(plain), packedPx = tracerWidth(punched);
  ok(packedPx.lit > plainPx.lit * 1.6,
    `the packed tracer is barely different (${plainPx.lit} vs ${packedPx.lit} lit pixels)`);
  ok(packedPx.lit < plainPx.lit * 14,
    `the packed tracer is still a rope (${plainPx.lit} vs ${packedPx.lit} lit pixels)`);
  ok(packedPx.sum > plainPx.sum * 1.6,
    `the packed tracer is no brighter (${plainPx.sum | 0} vs ${packedPx.sum | 0})`);
  console.log(`  tracer: ${plainPx.lit} plain vs ${packedPx.lit} packed lit pixels `
    + `(brightness ${plainPx.sum | 0} -> ${packedPx.sum | 0})`);
}

if (fails.length) {
  console.log('LIGHTFLOORS FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('LIGHTFLOORS PASS  every storey has a night, and a flash you can see in it');
