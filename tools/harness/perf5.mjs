// Find the moment the frame cost explodes: sample every game-second.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 120;
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
const now = () => Number(process.hrtime.bigint()) / 1e6;
g.begin(); g.power = true; g.powerOn = true;
g.player.hurt = () => false;
let upd = 0, drw = 0, frames = 0, steps = 0, wall = Date.now();
for (let f = 0; f < 120 * 70; f++) {
  g.player.hp = 100;
  const t0 = now(); g.update(H); upd += now() - t0; steps++;
  if (f % 2 === 0) { const t1 = now(); g.draw(cx); drw += now() - t1; frames++; }
  if (f % 120 === 0 && f > 0) {
    const w = (Date.now() - wall) / 1000; wall = Date.now();
    const p = g.player, w2 = p.weapon ?? {};
    console.log(`t=${String((f/120)|0).padStart(3)} wall=${w.toFixed(2).padStart(6)}s draw=${(drw/frames).toFixed(1).padStart(6)} upd=${(upd/steps).toFixed(3)} r=${g.round} z=${g.zombies.length} floor=${g.map.floor} pos=${p.pos.x|0},${p.pos.y|0} ammo=${w2.ammo ?? '?'} parts=${g.particles.items.length} decals=${g.particles.decals?.length ?? '-'}`);
    upd = 0; drw = 0; frames = 0; steps = 0;
  }
}
