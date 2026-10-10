// Headless harness for how loud a Pack-a-Punched shot is.
//
// The punch used to make shots *dimmer*, not brighter. A punched gun fires an
// hsl() rainbow, and the light pass ran every colour through parseInt(x, 16) --
// so the muzzle light of the loudest weapon in the game came out as
// rgba(NaN,NaN,NaN), which the canvas silently throws away. No light at all.
// On top of that the tracer was the same 1px hairline as an unpunched pistol.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { hexA } = await import(SRC + '/game.js');
const { Lighting } = await import(SRC + '/lighting.js');
const { defFor, packedTracer } = await import(SRC + '/weapons.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

// ---- colours: hex, hsl and rgb all have to survive -------------------------
{
  const cases = [
    ['#f0913a', /^rgba\(240,145,58,0\.5\)$/],
    ['#fff', /^rgba\(255,255,255,0\.5\)$/],
    ['hsl(210, 95%, 70%)', /^rgba\(\d+,\d+,\d+,0\.5\)$/],
    ['hsl(0, 100%, 50%)', /^rgba\(255,0,0,0\.5\)$/],
    ['rgb(10, 20, 30)', /^rgba\(10,20,30,0\.5\)$/],
  ];
  for (const [c, re] of cases) {
    const got = hexA(c, 0.5);
    ok(!/NaN|undefined/.test(got), `hexA(${c}) came out as ${got}`);
    ok(re.test(got), `hexA(${c}) came out as ${got}`);
  }
  // the exact bug: a punched tracer through the old parseInt(x, 16)
  const rainbow = hexA('hsl(123, 95%, 70%)', 0.85);
  ok(!/NaN/.test(rainbow), `a packed muzzle light is still ${rainbow}`);
}

// ---- fire the same gun twice: plain, then punched --------------------------
// The punch changes the bullet, not the bang: the flash and the pool of light
// it throws must be exactly what an unpunched gun makes, or the room goes
// white every time you pull the trigger.
function shot(packIt) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(4);
  for (let i = 0; i < 60; i++) g.update(H);
  const p = g.player;
  const id = p.current;
  if (packIt) p.packed.add(id);
  const def = defFor(id, packIt);
  ok(!!def, `no def for ${id}`);
  ok(!!def.packed === packIt, `defFor(${id}, ${packIt}) forgot to say it is packed`);
  g.tracers.length = 0;
  g.flashLights.length = 0;
  g.muzzleFlash = null;
  p.fireTimer = 0;
  p.fire(g);
  return { g, def, id };
}

const plain = shot(false);
const packed = shot(true);

ok(/^hsl\(/.test(packed.g.tracers.at(-1).colour),
  `a punched bullet is ${packed.g.tracers.at(-1).colour}, not a rainbow`);
ok(!/^hsl\(/.test(plain.g.tracers.at(-1).colour), 'an unpunched bullet came out as a rainbow');

// the tracer lingers and is marked so the renderer can make it fat
ok(!!packed.g.tracers.at(-1).packed, 'the packed tracer is not marked as packed');
ok(!plain.g.tracers.at(-1).packed, 'an unpunched tracer is marked as packed');
ok(packed.g.tracers.at(-1).life > plain.g.tracers.at(-1).life,
  'a punched tracer vanishes as fast as a plain one');

// the flash is the same size it always was
ok(Math.abs(packed.g.muzzleFlash.size - plain.g.muzzleFlash.size) < 0.01,
  `a punched muzzle flash is ${packed.g.muzzleFlash.size}, an unpunched one is ${plain.g.muzzleFlash.size}`);

// and it throws the same pool of light
const pf = packed.g.flashLights.at(-1), nf = plain.g.flashLights.at(-1);
ok(!!pf && !!nf, 'firing did not make a light');
ok(Math.abs(pf.r - nf.r) < 0.01, `a punched shot lights ${pf.r}px against ${nf.r}px`);
ok(Math.abs(pf.life - nf.life) < 0.001, 'a punched shot light lasts a different time');

// ---- and the light actually reaches the renderer ---------------------------
// Watch every light the game asks for while a punched shot is on screen: none
// of them may be NaN, and one of them has to be the big muzzle pool.
function litPoints(g) {
  const seen = [];
  const orig = Lighting.prototype.point;
  Lighting.prototype.point = function (x, y, r, i, colour, k) {
    seen.push({ r, colour: String(colour) });
    return orig.call(this, x, y, r, i, colour, k);
  };
  try {
    g.draw(nc(M.VW, M.VH).getContext('2d'));
  } finally {
    Lighting.prototype.point = orig;
  }
  return seen;
}

for (const [name, s] of [['plain', plain], ['punched', packed]]) {
  const seen = litPoints(s.g);
  ok(seen.length > 0, `the ${name} frame lit nothing at all`);
  const bad = seen.filter((l) => /NaN|undefined/.test(l.colour));
  ok(bad.length === 0, `${name} frame asked for ${bad.length} lights with a broken colour (${bad[0]?.colour})`);
}

// the player's own torch is the same in both frames, so compare the total:
// a punched shot must not light the room up any more than a plain one
const lit = (s) => litPoints(s.g).reduce((n, l) => n + l.r, 0);
const plainSum = lit(plain), packedSum = lit(packed);
ok(Math.abs(packedSum - plainSum) < 1,
  `the punched frame throws ${(packedSum - plainSum).toFixed(0)}px more light than the plain one`);

// ---- the round itself is what travels brighter ------------------------------
// Same shot, same place, one plain and one punched: the punched one has to
// leave a fatter, brighter streak on the screen. Counted off the pixels,
// because "brighter" is not a thing you can assert from the object.
function streak(packedShot) {
  const g2 = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g2.begin();
  g2.startRound(1);
  for (let i = 0; i < 30; i++) g2.update(H);
  g2.tracers.length = 0;
  g2.muzzleFlash = null;
  g2.flashLights.length = 0;
  // world coordinates: the scene is drawn inside one big camera translate
  const wx = g2.player.pos.x, wy = g2.player.pos.y;
  g2.tracers.push({
    x0: wx - 200, y0: wy, x1: wx + 200, y1: wy, life: 0.085, max: 0.085,
    colour: packedShot ? packedTracer(1.5) : '#d9c27a', packed: packedShot ? 1 : 0,
  });
  const c = nc(M.VW, M.VH);
  const cx2 = c.getContext('2d');
  g2.draw(cx2);
  const sy = Math.max(0, Math.min(M.VH - 21, Math.round(wy - g2.cam.y) - 10));
  const d = cx2.getImageData(0, sy, M.VW, 21).data;
  let lit = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] + d[i + 1] + d[i + 2];
    sum += v;
    if (v > 210) lit++;
  }
  return { lit, sum };
}

const plainStreak = streak(false);
const packedStreak = streak(true);
ok(packedStreak.lit > plainStreak.lit * 1.5,
  `a punched round lights ${packedStreak.lit} px against ${plainStreak.lit}`);
ok(packedStreak.sum > plainStreak.sum * 1.15,
  `a punched round is barely brighter (${(packedStreak.sum / Math.max(1, plainStreak.sum)).toFixed(2)}x)`);
console.log(`  round: ${plainStreak.lit} -> ${packedStreak.lit} lit px, ` +
  `brightness x${(packedStreak.sum / Math.max(1, plainStreak.sum)).toFixed(2)}`);

// ---- and the rainbow survives being drawn ----------------------------------
{
  const stops = [];
  const g = packed.g;
  g.muzzleFlash = { x: g.player.pos.x, y: g.player.pos.y, a: 0, t: 0.055, size: 18, colour: 'hsl(200, 95%, 70%)', packed: 1 };
  const ctx = nc(M.VW, M.VH).getContext('2d');
  const orig = ctx.createRadialGradient.bind(ctx);
  ctx.createRadialGradient = (...a) => {
    const gr = orig(...a);
    const oa = gr.addColorStop.bind(gr);
    gr.addColorStop = (o, c) => { stops.push(String(c)); return oa(o, c); };
    return gr;
  };
  g.draw(ctx);
  ctx.createRadialGradient = orig;
  ok(stops.length > 0, 'the muzzle flash drew no gradient at all');
  const bad = stops.filter((c) => /NaN|undefined/.test(c));
  ok(bad.length === 0, `the muzzle gradient has a broken stop: ${bad[0]}`);
}

if (fails.length) {
  console.log('PACKEDFX FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('PACKEDFX PASS  a punched gun throws a bigger, brighter, coloured light');
}
