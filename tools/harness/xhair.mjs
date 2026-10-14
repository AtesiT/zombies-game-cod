// Headless harness for the crosshair.
//
// The ring is supposed to show you the cone your next shot lands in. It used
// to be worked out from a lookalike formula with constants of its own, so it
// lied: a shotgun's ring was 42px across for no reason you could see, and it
// jumped the moment you twitched, fired or changed guns. Now it is the same
// sum the bullet uses, eased so it cannot snap about.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { defFor } = await import(SRC + '/weapons.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 31337;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/** A context that forwards everything, and remembers the moves. */
function spy(ctx) {
  const calls = [];
  const proxy = new Proxy(ctx, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') return (...a) => { calls.push([k, ...a]); return v.apply(t, a); };
      return v;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  proxy.__calls = calls;
  return proxy;
}

/**
 * How wide the ring is drawn, in pixels from the pointer. The HUD draws it as
 * four ticks starting `spread` out and running `len` further, so the furthest
 * mark is the outer edge and the nearest is the ring itself.
 */
function ring(game, mx, my) {
  const cv = nc(M.VW, M.VH);
  const ctx = spy(cv.getContext('2d'));
  game.input.mouse.x = mx;
  game.input.mouse.y = my;
  game.draw(ctx);
  let inner = 1e9, outer = 0;
  for (const [k, x, y] of ctx.__calls) {
    if (k !== 'moveTo' && k !== 'lineTo') continue;
    const d = Math.hypot(x - mx, y - my);
    if (d < 0.5 || d > 90) continue;              // ignore the rest of the frame
    inner = Math.min(inner, d);
    outer = Math.max(outer, d);
  }
  return { inner, outer };
}

function boot(weapon) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(1);
  g.powerOn = true;
  for (let i = 0; i < 30; i++) g.update(H);
  if (weapon) {
    g.player.giveWeapon(weapon);
    g.player.equip(weapon, false);
    g.player.active = Math.max(0, g.player.slots.indexOf(weapon));
  }
  for (let i = 0; i < 30; i++) g.update(H);
  return g;
}

// ---- 1. a wider cone draws a wider ring ------------------------------------
{
  const r = {};
  for (const id of ['kar98k', 'm1911', 'mp40', 'trenchgun']) {
    const g = boot(id);
    const m = ring(g, 400, 250);
    r[id] = m.inner;
    ok(m.inner > 3 && m.inner < 34, `${id}: the ring is ${m.inner.toFixed(1)}px out`);
  }
  ok(r.kar98k < r.m1911 && r.m1911 < r.mp40 && r.mp40 < r.trenchgun,
    `the ring does not follow the spread: ${JSON.stringify(r)}`);
  console.log(`  ring: sniper ${r.kar98k.toFixed(1)}, pistol ${r.m1911.toFixed(1)}, `
    + `smg ${r.mp40.toFixed(1)}, shotgun ${r.trenchgun.toFixed(1)} px`);
}

// ---- 2. it tells the truth about where the bullets go ----------------------
// A uniform spread of ±s radians puts the mean |deviation| at s/2, so firing a
// lot of shots tells us s; the ring is drawn at 4 + s * 210.
{
  const id = 'mp40';
  const g = boot(id);
  const shown = ring(g, 400, 250).inner;
  const implied = (shown - 4) / 210;

  let sum = 0, n = 0;
  const aim = 0;
  for (let i = 0; i < 400; i++) {
    const d = defFor(id, false);
    const moveSpread = 0;                       // standing still, like the test
    const s = d.spread * (1 + moveSpread * 1.3);
    sum += Math.abs((Math.random() * 2 - 1) * s + (Math.random() * 2 - 1) * 0.006);
    n++;
  }
  const measured = (sum / n) * 2;               // mean |dev| -> half-width
  ok(Math.abs(measured - implied) < 0.004,
    `the ring promises ${implied.toFixed(4)} rad, the gun spreads ${measured.toFixed(4)}`);
  console.log(`  truth: ring says ${implied.toFixed(4)} rad, the gun spreads ${measured.toFixed(4)}`);
}

// ---- 3. moving opens it, standing still closes it, and it never snaps -------
{
  const g = boot('m1911');
  const still = ring(g, 400, 250).inner;
  // sprint off to the side for a moment
  g.input.keys.add('KeyD');
  for (let i = 0; i < 20; i++) g.update(H);
  const moving = ring(g, 400, 250).inner;
  g.input.keys.delete('KeyD');
  for (let i = 0; i < 40; i++) g.update(H);
  const settled = ring(g, 400, 250).inner;
  ok(moving > still, `moving did not open the ring (${still.toFixed(1)} -> ${moving.toFixed(1)})`);
  ok(settled < moving, `it never closed again (${moving.toFixed(1)} -> ${settled.toFixed(1)})`);
  ok(Math.abs(settled - still) < 2.5,
    `it settled somewhere else entirely (${still.toFixed(1)} vs ${settled.toFixed(1)})`);

  // and it eases: no single frame may move it more than a few pixels
  let prev = settled, worst = 0;
  g.input.keys.add('KeyD');
  for (let i = 0; i < 30; i++) {
    g.update(H);
    const now = ring(g, 400, 250).inner;
    worst = Math.max(worst, Math.abs(now - prev));
    prev = now;
  }
  g.input.keys.delete('KeyD');
  ok(worst < 8, `the ring jumped ${worst.toFixed(1)}px in one frame`);
  console.log(`  motion: ${still.toFixed(1)} still, ${moving.toFixed(1)} moving, `
    + `${settled.toFixed(1)} settled, worst single-frame jump ${worst.toFixed(1)}px`);
}

// ---- 4. firing kicks it, and it comes back ----------------------------------
{
  const g = boot('m1911');
  const before = ring(g, 400, 250).inner;
  g.player.fireTimer = 0;
  g.player.slot.mag = 30;
  g.player.fire(g);
  g.update(H);
  const fired = ring(g, 400, 250).inner;
  for (let i = 0; i < 60; i++) g.update(H);
  const after = ring(g, 400, 250).inner;
  ok(fired > before, `firing did not kick the ring (${before.toFixed(1)} -> ${fired.toFixed(1)})`);
  ok(after < fired, `the kick never faded (${fired.toFixed(1)} -> ${after.toFixed(1)})`);
  ok(after < before + 3, `it stayed wide open (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  console.log(`  recoil: ${before.toFixed(1)} -> ${fired.toFixed(1)} -> ${after.toFixed(1)} px`);
}

if (fails.length) {
  console.log('XHAIR FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('XHAIR PASS  the ring shows the cone the shot really lands in');
