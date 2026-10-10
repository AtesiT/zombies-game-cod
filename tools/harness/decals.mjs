// The blood layer: it should be half size, it should stop skipping the blit
// only where there is blood, and a long session should not flood the map.
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 60, T = 24;
let s = 4242;
Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin(); g.started = true; g.power = true; g.powerOn = true;
g.player.hurt = () => false;

const cv = nc(M.VW, M.VH), ctx = cv.getContext('2d');
const bad = [];
const layer = g._decals[0];
// half of 72x50 tiles
if (layer.width !== Math.ceil(72 * T * 0.5)) bad.push(`layer ${layer.width}x${layer.height}, expected half size`);
console.log(`decal layer ${layer.width} x ${layer.height} (level is ${72 * T} x ${50 * T})`);

// nothing splatted yet: the blit must be skipped
if (g._decalsIn(0, 0, M.VW, M.VH)) bad.push('dirty box claims blood before any was spilled');

// spill a lot of it around the player, then look at the layer
const px = g.player.pos.x, py = g.player.pos.y;
for (let i = 0; i < 400; i++) {
  g.splat(px + (Math.random() - 0.5) * 200, py + (Math.random() - 0.5) * 200, 8, 0.6);
}
console.log(`after 400 splats: counter ${g._decalCount[0]} (washes at 260), box ` +
  `${Math.round(g._decalBox[0].x0)},${Math.round(g._decalBox[0].y0)}..${Math.round(g._decalBox[0].x1)},${Math.round(g._decalBox[0].y1)}`);

// a washed layer must not be solid paint: sample how much ink survived
const ink = () => {
  const d = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 24) n++;
  return n / (layer.width * layer.height);
};
const covered = ink();
console.log(`layer coverage after washing: ${(covered * 100).toFixed(1)}%`);
if (covered > 0.55) bad.push(`layer is ${(covered * 100).toFixed(0)}% covered -- the wash is not keeping up`);

// the blit: time the draw with blood on screen and with the camera elsewhere
const timeDraw = (frames) => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < frames; i++) g.draw(ctx);
  return Number(process.hrtime.bigint() - t0) / 1e6 / frames;
};
g.cam.x = px - M.VW / 2; g.cam.y = py - M.VH / 2;
const onBlood = timeDraw(90);
g.cam.x = 1100; g.cam.y = 700;                  // the far corner, no blood there
const offBlood = timeDraw(90);
console.log(`draw: ${onBlood.toFixed(2)} ms with blood on screen, ${offBlood.toFixed(2)} ms with the camera away (skipped: ${!g._decalsIn(1100, 700, 1100 + M.VW, 700 + M.VH)})`);
if (!g._decalsIn(px - M.VW / 2, py - M.VH / 2, px + M.VW / 2, py + M.VH / 2)) bad.push('dirty box does not see the blood right in front of the player');
if (g._decalsIn(1100, 700, 1100 + M.VW, 700 + M.VH)) bad.push('the far corner still thinks there is blood in view');

// and blood must actually show up on the frame
const count = () => {
  const d = ctx.getImageData(0, 0, M.VW, M.VH).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 2] + 28 && d[i] > 40) n++;
  return n;
};
g.cam.x = px - M.VW / 2; g.cam.y = py - M.VH / 2;
g.draw(ctx);
const red = count();
console.log(`reddish pixels on the frame: ${red}`);
if (red < 500) bad.push(`only ${red} red pixels -- the blood is not reaching the screen`);

// what did half resolution buy? blit the same window out of both sizes
{
  const half = nc(layer.width, layer.height), hc = half.getContext('2d');
  hc.drawImage(layer, 0, 0);
  const full = nc(72 * T, 50 * T), fc = full.getContext('2d');
  fc.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, 72 * T, 50 * T);
  const time = (src, sw, sh) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 60; i++) ctx.drawImage(src, 100, 100, sw, sh, 0, 0, M.VW, M.VH);
    return Number(process.hrtime.bigint() - t0) / 1e6 / 60;
  };
  const a = time(half, M.VW * 0.5, M.VH * 0.5), b = time(full, M.VW, M.VH);
  console.log(`one blit: ${a.toFixed(2)} ms from the half-size layer, ${b.toFixed(2)} ms from a full-size one`);
}

console.log(bad.length ? '\nDECALS FAIL\n  ' + bad.join('\n  ') : '\nDECALS PASS');
