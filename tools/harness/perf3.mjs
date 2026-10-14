// Third pass: attribute the expensive calls to the code that makes them.
import { nc, load, SRC } from './stub.mjs';
const M = await load();
const L = await import(SRC + '/lighting.js');
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cv = nc(M.VW, M.VH);
const raw = cv.getContext('2d');
const now = () => Number(process.hrtime.bigint()) / 1e6;

let on = false;
const byCaller = {};
const bump = (kind, ms) => {
  const st = new Error().stack.split('\n').slice(3, 5).map(s => s.trim().replace(/^at /, '').replace(/file:.*src\//, '')).join(' <- ');
  const key = kind + '  ' + st;
  const e = byCaller[key] ?? (byCaller[key] = { n: 0, ms: 0 });
  e.n++; e.ms += ms;
};
const proxy = new Proxy(raw, {
  get(t, k) {
    const v = t[k];
    if (typeof v !== 'function') return v;
    return (...a) => {
      if (!on) return t[k](...a);
      const t0 = now(); const r = t[k](...a); const dt = now() - t0;
      if (k === 'drawImage') {
        const w = a.length >= 9 ? a[7] : (a[0]?.width ?? 0), h = a.length >= 9 ? a[8] : (a[0]?.height ?? 0);
        if (w * h > 120000) bump(`BIG drawImage ${w}x${h}`, dt);
      } else if (k === 'fillText' || k === 'strokeText') bump('text', dt);
      return r;
    };
  },
  set(t, k, v) { t[k] = v; return true; },
});
// who adds the lights?
const lightCalls = {};
for (const m of ['point', 'cone']) {
  const fn = L.Lighting.prototype[m];
  L.Lighting.prototype[m] = function (...a) {
    const st = new Error().stack.split('\n').slice(2, 4).map(s => s.trim().replace(/^at /, '').replace(/file:.*src\//, '')).join(' <- ');
    lightCalls[st] = (lightCalls[st] ?? 0) + 1;
    return fn.apply(this, a);
  };
}

g.begin(); g.power = true; g.powerOn = true;
for (const d of g.map.doors) d.open = true;
g.player.hurt = () => false;
g.zombies.length = 0; g.round = 5; g.startRound(5);
for (let f = 0; f < 120 * 8; f++) { g.player.hp = 100; g.update(H); }
for (const k in lightCalls) delete lightCalls[k];
let frames = 0;
for (let f = 0; f < 120 * 5; f++) {
  g.player.hp = 100;
  let n2 = null, d2 = 1e9;
  for (const z of g.zombies) { const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y); if (d < d2) { d2 = d; n2 = z; } }
  if (n2) { g.input.mouse.x = n2.pos.x; g.input.mouse.y = n2.pos.y; }
  g.input.mouse.down = true; g.input.mouse.pressed = f % 8 === 0;
  g.update(H);
  if (f % 2 === 0) { on = true; g.draw(proxy); on = false; frames++; }
}
console.log(`round 5 (dogs), ${frames} frames\n-- expensive calls per frame --`);
for (const [k, v] of Object.entries(byCaller).sort((a, b) => b[1].ms - a[1].ms).slice(0, 8))
  console.log(`  ${(v.ms / frames).toFixed(2)} ms  ${(v.n / frames).toFixed(1)}/frame  ${k}`);
console.log('\n-- who adds lights (per frame) --');
for (const [k, v] of Object.entries(lightCalls).sort((a, b) => b[1] - a[1]).slice(0, 10))
  console.log(`  ${(v / frames).toFixed(1)}  ${k}`);
