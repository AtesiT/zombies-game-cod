// Interleaved, median-of-N ablation. A single 200-frame sample varied by 20%
// run to run on this box, so every case is measured N times in rotation and
// the median reported -- otherwise the numbers are noise, not signal.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 120;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const ROUND = Number(process.argv[2] ?? 5);
const REPS = 3, FRAMES = 120;
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

const world = [];
for (let k = 0; k < REPS; k++) {                 // one world per rep, reused by every case
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.power = true; g.powerOn = true;
  g.round = ROUND; g.startRound(ROUND);
  g.player.hurt = () => false;
  for (let i = 0; i < 120 * 6; i++) { g.player.hp = 100; g.update(H); }
  world.push(g);
}
const noop = () => {};
const cases = [
  ['baseline', () => {}],
  ['- decal layer blit', (g, cx) => { const o = cx.drawImage.bind(cx); cx.drawImage = (s, ...a) => (s === g.decals ? undefined : o(s, ...a)); }],
  ['- lighting (whole pass)', (g) => { g.drawLighting = noop; }],
  ['- glow pass only', (g) => { const c = g.lighting.composite.bind(g.lighting); g.lighting.composite = (ctx, w, h) => { const keep = g.lighting.glow.splice(0); c(ctx, w, h); g.lighting.glow.push(...keep); }; }],
  ['- all text', (g, cx) => { cx.fillText = noop; }],
  ['- particles', (g) => { g.particles.draw = noop; }],
  ['- weather', (g) => { if (g.weather) g.weather.draw = noop; }],
  ['- zombies', (g) => { for (const z of g.zombies) z.draw = noop; g.zombies.forEach((z) => { z.draw = noop; }); }],
  ['- vignette', (g, cx) => { const o = cx.drawImage.bind(cx); cx.drawImage = (s, ...a) => (s && s.width === M.VW && s.height === M.VH ? undefined : o(s, ...a)); }],
];
const samples = cases.map(() => []);
for (let rep = 0; rep < REPS; rep++) {
  for (let ci = 0; ci < cases.length; ci++) {
    const g = world[rep];
    const cx = nc(M.VW, M.VH).getContext('2d');
    const undo = [];
    // patch, then remember how to put it back
    const saveM = (obj, key) => { undo.push([obj, key, obj[key]]); };
    const [, patch] = cases[ci];
    const g2 = new Proxy(g, { get: (t, k) => t[k], set: (t, k, v) => { if (!(k in t)) {} t[k] = v; return true; } });
    for (const k of ['drawLighting', 'particles', 'weather']) saveM(g, k);
    for (const k of ['composite']) saveM(g.lighting, k);
    for (const k of ['drawImage', 'fillText']) saveM(cx, k);
    for (const z of g.zombies) saveM(z, 'draw');
    patch(g2, cx);
    let t = 0;
    for (let f = 0; f < FRAMES; f++) {
      g.player.hp = 100; g.update(H);
      const t0 = now(); g.draw(cx); cx.getImageData(0, 0, 1, 1); t += now() - t0;
    }
    samples[ci].push(t / FRAMES);
    for (const [obj, key, val] of undo) obj[key] = val;
  }
}
const base = median(samples[0]);
console.log(`round ${ROUND} -- median of ${REPS} x ${FRAMES} frames (draw + forced flush)\n`);
console.log(`  ${cases[0][1] ? '' : ''}${'baseline'.padEnd(26)} ${base.toFixed(2)} ms`);
for (let ci = 1; ci < cases.length; ci++) {
  const m = median(samples[ci]);
  const d = base - m;
  console.log(`  ${cases[ci][0].padEnd(26)} ${m.toFixed(2)} ms   saves ${d >= 0.15 ? d.toFixed(2) + ' ms' : '~0'}  (${(d / base * 100).toFixed(0)}%)`);
}
