// Second pass: what exactly is expensive, and what grows with the round?
import { nc, load, SRC } from './stub.mjs';
const M = await load();
const L = await import(SRC + '/lighting.js');
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cv = nc(M.VW, M.VH);
const raw = cv.getContext('2d');
const now = () => Number(process.hrtime.bigint()) / 1e6;

let on = false;
const big = { n: 0, ms: 0 }, small = { n: 0, ms: 0 }, grads = { n: 0, ms: 0 }, fills = { n: 0, ms: 0 }, text = { n: 0, ms: 0 };
let lights = 0, cones = 0;
for (const m of ['point', 'cone']) {
  const fn = L.Lighting.prototype[m];
  L.Lighting.prototype[m] = function (...a) { if (m === 'point') lights++; else cones++; return fn.apply(this, a); };
}
const proxy = new Proxy(raw, {
  get(t, k) {
    const v = t[k];
    if (typeof v !== 'function') return v;
    return (...a) => {
      if (!on) return t[k](...a);
      const t0 = now();
      const r = t[k](...a);
      const dt = now() - t0;
      if (k === 'drawImage') {
        const w = a.length >= 9 ? a[7] : (a[0]?.width ?? 0), h = a.length >= 9 ? a[8] : (a[0]?.height ?? 0);
        const b = w * h > 120000 ? big : small;
        b.n++; b.ms += dt;
      } else if (k === 'createRadialGradient' || k === 'createLinearGradient') { grads.n++; grads.ms += dt; }
      else if (k === 'fill' || k === 'fillRect' || k === 'stroke' || k === 'strokeRect') { fills.n++; fills.ms += dt; }
      else if (k === 'fillText' || k === 'strokeText') { text.n++; text.ms += dt; }
      return r;
    };
  },
  set(t, k, v) { t[k] = v; return true; },
});

g.begin(); g.power = true; g.powerOn = true;
for (const d of g.map.doors) d.open = true;
g.player.hurt = () => false;

const measure = (round, seconds = 5, label = '') => {
  g.zombies.length = 0; g.gases.length = 0; g.fires.length = 0;
  g.round = round; g.startRound(round);
  for (let f = 0; f < 120 * 8; f++) { g.player.hp = 100; g.update(H); }
  big.n = big.ms = small.n = small.ms = grads.n = grads.ms = fills.n = fills.ms = text.n = text.ms = 0;
  lights = cones = 0;
  let drw = 0, frames = 0;
  const N = Math.round(120 * seconds);
  const heap0 = process.memoryUsage().heapUsed;
  for (let f = 0; f < N; f++) {
    g.player.hp = 100;
    let n2 = null, d2 = 1e9;
    for (const z of g.zombies) { if ((z.floor ?? 0) !== g.map.floor) continue; const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y); if (d < d2) { d2 = d; n2 = z; } }
    if (n2) { g.input.mouse.x = n2.pos.x; g.input.mouse.y = n2.pos.y; }
    g.input.mouse.down = true; g.input.mouse.pressed = f % 8 === 0;
    g.update(H);
    if (f % 2 === 0) { on = true; const t = now(); g.draw(proxy); drw += now() - t; on = false; frames++; }
  }
  const heap1 = process.memoryUsage().heapUsed;
  const dogs = g.zombies.filter(z => z.type === 'dog').length;
  console.log(`\nround ${round}${label}  ${g.zombies.length} zombies (${dogs} dogs), ${g.particles.items.length} particles`);
  console.log(`  draw ${(drw / frames).toFixed(2)} ms/frame`);
  console.log(`  big  drawImage ${(big.n / frames).toFixed(1)}/frame  ${(big.ms / frames).toFixed(2)} ms`);
  console.log(`  small drawImage ${(small.n / frames).toFixed(1)}/frame  ${(small.ms / frames).toFixed(2)} ms`);
  console.log(`  gradients ${(grads.n / frames).toFixed(1)}/frame  ${(grads.ms / frames).toFixed(2)} ms`);
  console.log(`  fills     ${(fills.n / frames).toFixed(1)}/frame  ${(fills.ms / frames).toFixed(2)} ms`);
  console.log(`  text      ${(text.n / frames).toFixed(1)}/frame  ${(text.ms / frames).toFixed(2)} ms`);
  console.log(`  lights ${(lights / frames).toFixed(1)}/frame, cones ${(cones / frames).toFixed(1)}/frame`);
  console.log(`  heap +${((heap1 - heap0) / 1048576).toFixed(1)} MB over ${seconds}s  =>  ${(((heap1 - heap0) / 1048576) / seconds).toFixed(1)} MB/s of garbage`);
};
measure(4, 5);
measure(5, 5, ' (DOG ROUND)');
measure(6, 5);
measure(15, 5);
