// Late rounds are where every new type is on the table at once. Run one with
// an immortal player and watch for explosions, NaN and runaway counts.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 60;
let s = Number(process.argv[3] ?? 777);
Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const round = Number(process.argv[2] ?? 22);
const secs = Number(process.argv[4] ?? 60);

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin(); g.started = true; g.power = true; g.powerOn = true;
g.player.hurt = () => false;
g.startRound(round);
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
const seen = new Set();
let errors = 0, nan = 0, peak = 0, drew = 0;
for (let f = 0; f < secs * 60; f++) {
  g.player.hp = 100;
  try { g.update(H); } catch (e) { errors++; if (errors === 1) console.log('update threw: ' + e.message); }
  for (const z of g.zombies) {
    seen.add(z.type);
    if (!Number.isFinite(z.pos.x) || !Number.isFinite(z.pos.y) || !Number.isFinite(z.hp)) nan++;
  }
  peak = Math.max(peak, g.zombies.length);
  if (f % 4 === 0) { try { g.draw(cx); drew++; } catch (e) { errors++; if (errors === 1) console.log('draw threw: ' + e.message); } }
}
const types = [...seen].sort().join(', ');
console.log(`round ${round}, ${secs}s: zombies peak ${peak}, alive ${g.zombies.filter((z) => !z.dead).length}, ` +
  `killed ${g.zombiesKilled}/${g.zombiesTotal}, ${drew} frames drawn`);
console.log(`types seen: ${types}`);
console.log(`errors ${errors}   NaN ${nan}`);
console.log(errors === 0 && nan === 0 ? 'LATE PASS' : 'LATE FAIL');
