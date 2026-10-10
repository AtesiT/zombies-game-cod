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
const { defFor } = await import(SRC + '/weapons.js');
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

// the flash sprite is bigger
ok(packed.g.muzzleFlash.packed === 1, 'the packed muzzle flash is not marked as packed');
ok(packed.g.muzzleFlash.size > plain.g.muzzleFlash.size * 1.2,
  `a punched muzzle flash is ${packed.g.muzzleFlash.size}, barely bigger than ${plain.g.muzzleFlash.size}`);

// and so is the pool of light it throws
const pf = packed.g.flashLights.at(-1), nf = plain.g.flashLights.at(-1);
ok(!!pf && !!nf, 'firing did not make a light');
ok(pf.packed === 1, 'the packed shot light is not marked as packed');
ok(pf.r > nf.r * 1.2, `a punched shot lights ${pf.r}px against ${nf.r}px`);
ok(pf.life > nf.life, 'a punched shot light dies as fast as a plain one');

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
// a punched shot has to add a clearly bigger pool of light than a plain one
const lit = (s) => litPoints(s.g).reduce((n, l) => n + l.r, 0);
const plainSum = lit(plain), packedSum = lit(packed);
ok(packedSum > plainSum + 120,
  `the punched frame lights ${(packedSum - plainSum).toFixed(0)}px more than the plain one`);

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
