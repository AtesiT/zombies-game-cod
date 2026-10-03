// Does the frame cost creep up during a long run, or is it flat? Leaks are the
// usual reason a game is fine at round 3 and sticky by round 5.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
const now = () => Number(process.hrtime.bigint()) / 1e6;
g.begin(); g.power = true; g.powerOn = true;
for (const d of g.map.doors) d.open = true;
g.player.hurt = () => false;
const arrays = () => {
  const out = [];
  const add = (label, v) => { if (Array.isArray(v) && v.length) out.push(`${label} ${v.length}`); };
  add('zombies', g.zombies); add('particles', g.particles.items); add('decalQueue', g.particles.decals);
  add('popups', g.popups.items); add('tracers', g.tracers); add('gases', g.gases); add('fires', g.fires);
  add('flashLights', g.flashLights); add('explosionLights', g.explosionLights);
  add('gibs', g.gibs); add('blood', g.blood); add('shells', g.shells); add('corpses', g.corpses);
  add('powerups', g.powerups); add('grenades', g.grenades); add('monkeys', g.monkeys);
  for (const k of Object.keys(g)) { const v = g[k]; if (Array.isArray(v) && v.length > 40) out.push(`${k} ${v.length}`); }
  return out.join('  ');
};
console.log('t(s)  round  draw(ms)  update(ms/step)  heap(MB)  |  arrays');
let upd = 0, drw = 0, frames = 0, steps = 0;
const W0=Date.now();
for (let f = 0; f < 120 * 95; f++) {
  g.player.hp = 100;
  let n2 = null, d2 = 1e9;
  for (const z of g.zombies) { if ((z.floor ?? 0) !== g.map.floor) continue; const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y); if (d < d2) { d2 = d; n2 = z; } }
  if (n2) { g.input.mouse.x = n2.pos.x; g.input.mouse.y = n2.pos.y; }
  g.input.mouse.down = true; g.input.mouse.pressed = f % 8 === 0;
  const t0 = now(); g.update(H); upd += now() - t0; steps++;
  if (f % 2 === 0) { const t1 = now(); g.draw(cx); drw += now() - t1; frames++; }
  if (f % (120 * 5) === 0 && f > 0) {
    console.log(`${String((f/120)|0).padStart(4)} ${String(((Date.now()-W0)/1000)|0).padStart(5)}s  ${String(g.round).padStart(5)}  ${(drw/frames).toFixed(2).padStart(8)}  ${(upd/steps).toFixed(3).padStart(15)}  ${(process.memoryUsage().heapUsed/1048576).toFixed(0).padStart(8)}  |  ${arrays()}`);
    upd = 0; drw = 0; frames = 0; steps = 0;
  }
}
