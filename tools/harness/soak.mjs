// Two minutes of real play (power on, doors open, shooting) with every frame
// drawn. Asserts nothing NaNs out, nothing leaks, and no frame throws.
import { nc, load } from './stub.mjs';
const M = await load();
let canvases = 0;
const doc = globalThis.document, rawCreate = doc.createElement;
doc.createElement = (t) => { if (t === 'canvas') canvases++; return rawCreate(t); };
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cx = nc(M.VW, M.VH).getContext('2d');
g.begin();
g.power = true; g.powerOn = true;
for (const d of g.map.doors) d.open = true;
g.player.hurt = () => false;
const bad = [];
const chk = (label, v) => { if (!Number.isFinite(v)) bad.push(`${label} = ${v}`); };
let kills = 0, maxZ = 0, err = 0;
const SECS = Number(process.argv[2] ?? 120);
for (let f = 0; f < 120 * SECS; f++) {
  g.player.hp = 100; g.points += 1;
  let near = null, d2 = 1e9;
  for (const z of g.zombies) {
    if ((z.floor ?? 0) !== g.map.floor) continue;
    const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y);
    if (d < d2) { d2 = d; near = z; }
  }
  if (near) { g.input.mouse.x = near.pos.x; g.input.mouse.y = near.pos.y; }
  g.input.mouse.down = true; g.input.mouse.pressed = f % 10 === 0;
  if (f % 900 === 0) g.input.keys.add('w'); else if (f % 900 === 300) g.input.keys.delete('w');
  try { g.update(H); if (f % 2 === 0) g.draw(cx); } catch (e) { err++; if (err < 3) console.log('THREW', e.message); }
  maxZ = Math.max(maxZ, g.zombies.length);
  if (f % 240 === 0) {
    chk('player.x', g.player.pos.x); chk('player.y', g.player.pos.y);
    chk('cam.x', g.cam.x); chk('points', g.points);
    for (const z of g.zombies) { chk('z.x', z.pos.x); chk('z.hp', z.hp); }
  }
  if (f % (120 * 20) === 0 && f > 0) {
    console.log(`t=${String((f / 120) | 0).padStart(3)}s  round ${String(g.round).padStart(2)}  zombies ${String(g.zombies.length).padStart(2)} (peak ${maxZ})  kills ${g.stats?.kills ?? '?'}  canvases/frame ${(canvases / (f / 2)).toFixed(2)}  heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}MB`);
  }
}
console.log(`\nerrors ${err}   NaN/invalid ${bad.length ? bad.slice(0, 5).join(', ') : 'none'}   canvases/frame ${(canvases / (120 * SECS / 2)).toFixed(2)}   final heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)}MB`);
console.log(bad.length === 0 && err === 0 ? 'SOAK PASS' : 'SOAK FAIL');
