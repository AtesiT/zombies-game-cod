// The new performance settings: do they actually move the renderer, does the
// governor behave, and does the game still draw at every quality level?
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 120;
const { settings } = await import('/home/user/zombies-game-cod/src/settings.js');
let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? '  -- ' + extra : ''}`);
  if (!cond) fails++;
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cx = nc(M.VW, M.VH).getContext('2d');
g.begin(); g.power = true; g.powerOn = true; g.startRound(5);
g.player.hurt = () => false;
for (let i = 0; i < 60; i++) { g.player.hp = 100; g.update(H); }

// 1. defaults
ok(g.stepRate === 60, 'default simulation rate is 60', `got ${g.stepRate}`);
ok(near(g.lighting.scale, 0.5), 'default lighting is HIGH (0.5)', `got ${g.lighting.scale}`);
ok(g._perfStage === 0, 'governor starts at full quality');

// 2. the slider moves the lighting layers
const settle = () => { for (let i = 0; i < 3; i++) { g.player.hp = 100; g.update(H); g.draw(cx); } };
for (const [v, want, label] of [[0, 0.25, 'LOW'], [1, 0.375, 'MEDIUM'], [2, 0.5, 'HIGH']]) {
  settings.set('lighting', v);
  const L = g.lighting;
  // the glow layer is deliberately half the darkness layer again -- soft
  // blobs lose nothing at a quarter of screen resolution
  const gw = Math.max(1, Math.round(L.w * 0.5)), gh = Math.max(1, Math.round(L.h * 0.5));
  ok(near(L.scale, want) && L.w === Math.round(M.VW * want) && L.h === Math.round(M.VH * want)
    && L.glowCanvas.width === gw && L.glowCanvas.height === gh && L.gw === gw,
    `LIGHTING ${label} re-cuts both layers`, `scale ${L.scale}, ${L.w}x${L.h} + glow ${gw}x${gh}`);
  settle();
}

// 3. simulation rate
settings.set('simRate', 1); ok(g.stepRate === 120, 'SIMULATION RATE high -> 120 Hz', `got ${g.stepRate}`);
settings.set('simRate', 0); ok(g.stepRate === 60, 'SIMULATION RATE normal -> 60 Hz', `got ${g.stepRate}`);

// 4. the governor walks down under load and back up when it clears
settings.set('lighting', 2);
settings.set('autoQuality', true);
let scaleSeen = [];
for (let i = 0; i < 400; i++) { g.tickPerf(30); scaleSeen.push(g.lighting.scale); }
ok(g._perfStage === 2 && near(g.lighting.scale, 0.25), 'sustained slow frames drop to LOW', `stage ${g._perfStage}, scale ${g.lighting.scale}`);
ok(scaleSeen.includes(0.375), 'it steps through MEDIUM on the way down, not straight to LOW');
settle();
for (let i = 0; i < 4000; i++) g.tickPerf(5);
ok(g._perfStage === 0 && near(g.lighting.scale, 0.5), 'a long calm stretch climbs back to HIGH', `stage ${g._perfStage}`);

// 5. one bad frame must not twitch the quality
settings.set('lighting', 2);
for (let i = 0; i < 20; i++) g.tickPerf(80);
ok(g._perfStage === 0, 'a brief hitch does not drop quality', `stage ${g._perfStage}`);

// 6. the player's own pick is a ceiling the governor respects
settings.set('lighting', 1);
for (let i = 0; i < 400; i++) g.tickPerf(30);
ok(g._perfStage === 1 && near(g.lighting.scale, 0.25), 'governor stops at the player\'s MEDIUM ceiling', `stage ${g._perfStage}, scale ${g.lighting.scale}`);
settings.set('lighting', 0);
for (let i = 0; i < 400; i++) g.tickPerf(30);
ok(g._perfStage === 0 && near(g.lighting.scale, 0.25), 'LOW is already the floor', `scale ${g.lighting.scale}`);

// 7. switching it off leaves the player in charge
settings.set('lighting', 2);
settings.set('autoQuality', false);
for (let i = 0; i < 400; i++) g.tickPerf(30);
ok(near(g.lighting.scale, 0.5), 'AUTO PERFORMANCE off -> nothing moves under load', `scale ${g.lighting.scale}`);

// 8. every level still renders a sane, non-empty frame
settings.set('autoQuality', true);
for (const v of [0, 1, 2]) {
  settings.set('lighting', v);
  g.tickPerf(1);
  let threw = null;
  try { for (let i = 0; i < 10; i++) { g.player.hp = 100; g.update(H); g.draw(cx); } } catch (e) { threw = e.message; }
  const d = cx.getImageData(0, 0, M.VW, M.VH).data;
  let sum = 0, lit = 0;
  for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; sum += l; if (l > 90) lit++; }
  ok(!threw && sum > 0 && lit > 20000, `quality ${['LOW','MEDIUM','HIGH'][v]} draws a lit frame`,
    threw ?? `${(lit / (M.VW * M.VH) * 100).toFixed(0)}% of pixels lit`);
}

// 9. survives a restart at a low setting
settings.set('lighting', 0);
const g2 = new M.Game(new M.Input(nc(M.VW, M.VH)));
g2.begin(); g2.power = true; g2.powerOn = true;
ok(near(g2.lighting.scale, settings.get('lighting') === 0 ? 0.25 : 0.5), 'a fresh game picks the saved quality up', `scale ${g2.lighting.scale}`);

console.log(fails === 0 ? '\nQUALITY PASS' : `\nQUALITY FAIL (${fails})`);
process.exit(fails ? 1 : 0);
