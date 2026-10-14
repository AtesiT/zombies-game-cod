// What the new settings are actually worth: frame cost at each lighting
// quality, and what the simulation costs per second of game time at each rate.
import { nc, load } from './stub.mjs';
const M = await load();
const { settings } = await import('/home/user/zombies-game-cod/src/settings.js');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const ROUND = Number(process.argv[2] ?? 20);

const build = () => {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.power = true; g.powerOn = true;
  g.round = ROUND; g.startRound(ROUND);
  g.player.hurt = () => false;
  for (let i = 0; i < 120 * 6; i++) { g.player.hp = 100; g.update(1 / 120); }
  return g;
};
const worlds = [build(), build(), build()];

console.log(`round ${ROUND} -- median of 3 x 120 frames\n`);
console.log('LIGHTING QUALITY   frame (draw+flush)   lighting layer');
for (const v of [2, 1, 0]) {
  settings.set('lighting', v);
  settings.set('autoQuality', false);
  const samples = [];
  for (const g of worlds) {
    const cx = nc(M.VW, M.VH).getContext('2d');
    g.applySettings();          // settings.onChange only pokes the newest game
    g.tickPerf(1);
    let t = 0;
    for (let f = 0; f < 120; f++) {
      g.player.hp = 100; g.update(1 / 120);
      const t0 = now(); g.draw(cx); cx.getImageData(0, 0, 1, 1); t += now() - t0;
    }
    samples.push(t / 120);
  }
  const L = worlds[0].lighting;
  console.log(`  ${['LOW', 'MEDIUM', 'HIGH'][v].padEnd(15)} ${median(samples).toFixed(2).padStart(9)} ms         ${L.w}x${L.h}`);
}

console.log('\nSIMULATION RATE   update cost per second of game time');
for (const rate of [60, 120]) {
  const H = 1 / rate;
  const samples = [];
  for (const g of worlds) {
    g.round = ROUND;
    let t = 0;
    for (let f = 0; f < rate * 3; f++) { g.player.hp = 100; const t0 = now(); g.update(H); t += now() - t0; }
    samples.push(t / 3);
  }
  console.log(`  ${String(rate).padStart(3)} Hz         ${median(samples).toFixed(2).padStart(7)} ms   (${(median(samples) / 10).toFixed(1)}% of a 60 fps frame budget per second)`);
}
