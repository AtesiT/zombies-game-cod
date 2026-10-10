// Profile the frame. The canvas here is CPU-rasterised, so absolute draw ms
// are not what a browser sees -- but the *call counts* and the update cost are,
// and both go up the same way in a browser.
import { nc, load, SRC } from './stub.mjs';
const M = await load();
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cv = nc(M.VW, M.VH);
const raw = cv.getContext('2d');
const now = () => Number(process.hrtime.bigint()) / 1e6;

// ---- count and time every canvas operation --------------------------------
const calls = {}; const times = {};
let counting = false;
const COUNTED = new Set(['fillRect','strokeRect','clearRect','drawImage','beginPath','arc','ellipse',
  'fill','stroke','fillText','strokeText','save','restore','translate','rotate','scale','setTransform',
  'moveTo','lineTo','closePath','clip','createRadialGradient','createLinearGradient','putImageData',
  'getImageData','drawFocusIfNeeded','quadraticCurveTo','bezierCurveTo','rect','createPattern']);
const ctxProxy = new Proxy(raw, {
  get(t, k) {
    const v = t[k];
    if (typeof v !== 'function') return v;
    return (...a) => {
      if (!counting) return t[k](...a);
      const t0 = counting === 2 ? now() : 0;
      const r = t[k](...a);
      if (COUNTED.has(k)) { calls[k] = (calls[k] || 0) + 1; if (t0) times[k] = (times[k] || 0) + (now() - t0); }
      return r;
    };
  },
  set(t, k, v) { t[k] = v; return true; },
});

// ---- time whole subsystems -------------------------------------------------
const tally = {};
const wrap = (obj, name, label) => {
  const fn = obj[name];
  if (typeof fn !== 'function') return false;
  obj[name] = function (...a) { const t = now(); const r = fn.apply(this, a); tally[label] = (tally[label] ?? 0) + (now() - t); return r; };
  return true;
};
wrap(M.Game.prototype, 'rebuildFlow', 'update: buildFlow x3');
wrap(M.Game.prototype, 'update', 'update: everything');
wrap(M.Zombie.prototype, 'update', 'update: zombies');
wrap(M.Zombie.prototype, 'draw', 'draw: zombies');
for (const n of ['drawLighting','drawBarricades','drawDoors','drawWeather','drawWallBuys','drawPerkMachines',
  'drawPowerups','drawSecretDoor','drawGrenadeCrates','drawMysteryBox','drawWorkbench','drawPackAPunch']) wrap(M.Game.prototype, n, 'draw: ' + n.slice(4));

g.begin(); g.power = true; g.powerOn = true;
for (const d of g.map.doors) d.open = true;
g.player.hurt = () => false;

const run = (round, seconds) => {
  g.zombies.length = 0; g.gases.length = 0; g.fires.length = 0;
  g.round = round; g.startRound(round);
  for (let f = 0; f < 120 * 8; f++) { g.player.hp = 100; g.update(H); }
  for (const k in tally) delete tally[k];
  for (const k in calls) delete calls[k];
  for (const k in times) delete times[k];
  let upd = 0, drw = 0, frames = 0;
  const N = Math.round(120 * seconds);
  for (let f = 0; f < N; f++) {
    g.player.hp = 100;
    let n2 = null, d2 = 1e9;
    for (const z of g.zombies) { if ((z.floor ?? 0) !== g.map.floor) continue; const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y); if (d < d2) { d2 = d; n2 = z; } }
    if (n2) { g.input.mouse.x = n2.pos.x; g.input.mouse.y = n2.pos.y; }
    g.input.mouse.down = true; g.input.mouse.pressed = f % 8 === 0;
    const t0 = now(); g.update(H); upd += now() - t0;
    if (f % 2 === 0) { counting = 2; const t1 = now(); g.draw(ctxProxy); drw += now() - t1; counting = 0; frames++; }
  }
  const totalCalls = Object.values(calls).reduce((a, b) => a + b, 0);
  console.log(`\n=== ROUND ${round === 0 ? 1 : round} ===  ${g.zombies.length} zombies, ${g.particles.items.length} particles, ${g.decals ? '' : ''}${g.gases.length} gas, ${g.fires.length} fires, ${g.tracers.length} tracers`);
  console.log(`  update ${(upd / N).toFixed(3)} ms/step x2 = ${(upd / N * 2).toFixed(2)} ms/frame`);
  console.log(`  draw   ${(drw / frames).toFixed(2)} ms/frame     (CPU canvas -- browser is faster, but the call count is not)`);
  console.log(`  canvas calls ${Math.round(totalCalls / frames)}/frame`);
  const top = Object.entries(calls).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => `${k} ${Math.round(v / frames)}`).join(', ');
  console.log(`  busiest calls: ${top}`);
  const slow = Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k} ${(v / frames).toFixed(2)}ms`).join(', ');
  console.log(`  slowest canvas ops: ${slow}`);
  const sub = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 7)
    .map(([k, v]) => `${k} ${(v / frames).toFixed(2)}ms`).join('\n      ');
  console.log(`  subsystems/frame:\n      ${sub}`);
};
const which = process.argv[2] ? process.argv[2].split(',').map(Number) : [1, 5, 10, 20];
for (const r of which) run(r === 1 ? 0 : r, 6);
