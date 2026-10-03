// The HUD alone, drawn 2000 times, so the text cache can be judged without
// the lighting pass drowning it out.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 120;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cx = nc(M.VW, M.VH).getContext('2d');
g.begin(); g.power = true; g.powerOn = true; g.started = true;
g.startRound(6);
g.player.hurt = () => false;
for (let i = 0; i < 120 * 5; i++) { g.player.hp = 100; g.update(H); }
let t = 0; const N = 2000;
for (let i = 0; i < N; i++) {
  const t0 = now(); g.hud.draw(cx, g, M.VW, M.VH); cx.getImageData(0, 0, 1, 1); t += now() - t0;
}
console.log(`HUD draw: ${(t / N).toFixed(3)} ms/frame  (${N} frames)`);
