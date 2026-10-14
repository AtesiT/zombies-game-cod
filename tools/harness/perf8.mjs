// Lighting is 75% of the frame -- which half of it? The darkness blit or the
// additive glow pass? And which light is the expensive one?
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
  const g = build(); const cx = nc(M.VW, M.VH).getContext('2d');
  patch(g, cx);
  let t = 0, n = 0, glowN = 0, glowPx = 0;
  for (let f = 0; f < 200; f++) {
    g.player.hp = 100; g.update(H);
    const t0 = now(); g.draw(cx); cx.getImageData(0, 0, 1, 1); t += now() - t0; n++;
    for (const q of g.lighting.glow) { glowN++; const d = Math.min(q.radius * 2, M.VW) * Math.min(q.radius * 2, M.VH); glowPx += d; }
  }
  console.log(`  ${label.padEnd(30)} ${(t / n).toFixed(2)} ms/frame` + (glowN ? `   [glows ${(glowN / n).toFixed(0)}/frame, ${(glowPx / n / 1e6).toFixed(2)} Mpx/frame]` : ''));
  return t / n;
};
const base = run('baseline', () => {});
run('- glow pass only', (g) => { const c = g.lighting.composite.bind(g.lighting); g.lighting.composite = (ctx, w, h) => { const keep = g.lighting.glow.splice(0); c(ctx, w, h); g.lighting.glow.push(...keep); }; });
run('- darkness blit only', (g) => { const c = g.lighting.composite.bind(g.lighting); const o = g.lighting.ctx; g.lighting.composite = (ctx, w, h) => { const save = ctx.drawImage; ctx.drawImage = () => {}; c(ctx, w, h); ctx.drawImage = save; }; });
run('- player bubble light', (g) => { const o = g.lighting.point.bind(g.lighting); g.lighting.point = (x, y, r, ...a) => (r > 400 ? undefined : o(x, y, r, ...a)); });
run('- lights over r=200', (g) => { const o = g.lighting.point.bind(g.lighting); g.lighting.point = (x, y, r, ...a) => (r > 200 ? undefined : o(x, y, r, ...a)); });
run('- lights over r=120', (g) => { const o = g.lighting.point.bind(g.lighting); g.lighting.point = (x, y, r, ...a) => (r > 120 ? undefined : o(x, y, r, ...a)); });
