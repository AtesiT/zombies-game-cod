// Ablation instead of per-call timing: canvas2d batches lazily, so "which
// drawImage cost 10ms" is mostly an artefact of when Skia decides to flush.
// Switch one thing off, force a flush at end of frame, and the difference is
// that thing's true marginal cost.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 120;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const ROUND = Number(process.argv[2] ?? 5);

function build() {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.power = true; g.powerOn = true;
  g.round = ROUND; g.startRound(ROUND);
  g.player.hurt = () => false;
  for (let i = 0; i < 120 * 6; i++) { g.player.hp = 100; g.update(H); }
  return g;
}
const run = (label, patch) => {
  const g = build();
  const cx = nc(M.VW, M.VH).getContext('2d');
  patch(g, cx);
  let t = 0, n = 0;
  for (let f = 0; f < 240; f++) {
    g.player.hp = 100;
    g.update(H);
    const t0 = now();
    g.draw(cx);
    cx.getImageData(0, 0, 1, 1);          // force the flush inside the timed region
    t += now() - t0; n++;
  }
  return { label, ms: t / n };
};
const noop = () => {};
const cases = [
  ['baseline', () => {}],
  ['- decal layer blit', (g, cx) => { const o = cx.drawImage.bind(cx); cx.drawImage = (s, ...a) => (s === g.decals ? undefined : o(s, ...a)); }],
  ['- lighting composite', (g) => { g.lighting.composite = noop; }],
  ['- lighting (whole pass)', (g) => { g.drawLighting = noop; }],
  ['- all text', (g, cx) => { cx.fillText = noop; }],
  ['- particles', (g) => { g.particles.draw = noop; }],
  ['- weather', (g) => { if (g.weather) g.weather.draw = noop; }],
  ['- zombies', (g) => { for (const z of g.zombies) z.draw = noop; }],
  ['- vignette+post', (g, cx) => { const o = cx.drawImage.bind(cx); cx.drawImage = (s, ...a) => (s && s.width === M.VW && s.height === M.VH ? undefined : o(s, ...a)); }],
];
const base = run(...cases[0]);
console.log(`round ${ROUND}, full frame (draw + forced flush), ms/frame:\n`);
console.log(`  ${base.label.padEnd(24)} ${base.ms.toFixed(2)}`);
for (const c of cases.slice(1)) {
  const r = run(...c);
  const d = base.ms - r.ms;
  console.log(`  ${r.label.padEnd(24)} ${r.ms.toFixed(2)}   saves ${d >= 0.1 ? d.toFixed(2) + ' ms' : '~0'}  (${(d / base.ms * 100).toFixed(0)}%)`);
}
