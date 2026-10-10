// Headless harness for DLSS5.
//
// It is supersampling: the frame is drawn into a backing store larger than the
// picture you see, and the browser scales it back down. That is what gets rid
// of the staircase on every rotated sprite, light cone and letter of the HUD --
// and it is exactly the sort of thing that silently breaks the mouse, because
// the pointer used to be mapped through the backing store's own size.
import { nc, load, SRC } from './stub.mjs';

// capture the listeners before any module installs them
const winL = {};
globalThis.window.addEventListener = (t, fn) => { (winL[t] = winL[t] || []).push(fn); };

const M = await load();
const { SETTING_DEFS } = await import(SRC + '/settings.js');
const { Input } = await import(SRC + '/input.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

// ---- it exists, and it says what it does -----------------------------------
const def = SETTING_DEFS.find((d) => d.id === 'dlss');
ok(!!def, 'there is no DLSS5 setting at all');
ok(def?.type === 'toggle', 'DLSS5 is not a toggle');
ok((def?.hint ?? '').length > 20, 'DLSS5 has no explanation under it');
ok(def?.def === false, 'DLSS5 ships switched on, on every machine including the slow ones');

// ---- the mouse still works when the backing store is not 800x500 -----------
{
  const canvas = nc(1600, 1000);          // what DLSS5 leaves behind
  const input = new Input(canvas);
  input.setLogicalSize(800, 500);
  const move = (x, y) => { for (const fn of winL.mousemove ?? []) fn({ clientX: x, clientY: y }); };
  ok((winL.mousemove ?? []).length > 0, 'the input never installed a mousemove listener');
  move(1600, 1000);                       // bottom-right of a 1600x1000 canvas
  ok(Math.abs(input.mouse.x - 800) < 1 && Math.abs(input.mouse.y - 500) < 1,
    `a click in the far corner landed at ${input.mouse.x.toFixed(0)},${input.mouse.y.toFixed(0)} instead of 800,500`);
  move(800, 500);                         // dead centre
  ok(Math.abs(input.mouse.x - 400) < 1 && Math.abs(input.mouse.y - 250) < 1,
    `a click in the middle landed at ${input.mouse.x.toFixed(0)},${input.mouse.y.toFixed(0)} instead of 400,250`);
  // and a plain 800x500 canvas behaves exactly as it always did
  const plain = new Input(nc(800, 500));
  move(400, 250);
  ok(Math.abs(plain.mouse.x - 400) < 1, 'the plain 800x500 mapping broke');
}

// ---- the game gives up its hard pixels when asked --------------------------
{
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(3);
  for (let i = 0; i < 30; i++) g.update(H);

  const c1 = nc(M.VW, M.VH).getContext('2d');
  g.smooth = false;
  g.draw(c1);
  ok(c1.imageSmoothingEnabled === false, 'the game smoothed the pixels with DLSS5 off');

  const c2 = nc(M.VW, M.VH).getContext('2d');
  g.smooth = true;
  g.draw(c2);
  ok(c2.imageSmoothingEnabled === true, 'the game kept hard pixels with DLSS5 on');
}

// ---- and the picture really is smoother ------------------------------------
// Same frame, same camera, two ways: straight into 800x500, and into 1600x1000
// with the sprites filtered and then scaled back down -- which is what the
// browser does for you when DLSS5 is on.
function render(supersample) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(3);
  for (let i = 0; i < 90; i++) g.update(H);
  g.player.aim = 0.7;                     // a rotated sprite: the worst case
  const c = nc(M.VW * 2, M.VH * 2);
  const cx = c.getContext('2d');
  cx.setTransform(2, 0, 0, 2, 0, 0);
  cx.imageSmoothingQuality = 'high';
  g.smooth = supersample;
  g.draw(cx);
  if (!supersample) {
    // nearest-neighbour halving, the way the browser hands you an unfiltered
    // downscale of a canvas that was never supersampled in the first place
  }
  // back down to the size you actually look at
  const out = nc(M.VW, M.VH);
  const oc = out.getContext('2d');
  oc.imageSmoothingEnabled = supersample;
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(c, 0, 0, M.VW, M.VH);
  return oc.getImageData(0, 0, M.VW, M.VH).data;
}

function stats(d) {
  const seen = new Set();
  let hard = 0, pairs = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const key = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3);
    seen.add(key);
  }
  for (let y = 0; y < M.VH; y++) {
    for (let x = 1; x < M.VW; x++) {
      const a = (y * M.VW + x - 1) * 4, b = a + 4;
      const dd = Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
      sum += dd;
      if (dd > 90) hard++;
      pairs++;
    }
  }
  return { colours: seen.size, hard: hard / pairs, mean: sum / pairs };
}

const off = stats(render(false));
const on = stats(render(true));

// anti-aliasing is intermediate shades: there must be more of them
ok(on.colours > off.colours * 1.05,
  `DLSS5 did not add any intermediate shades (${off.colours} -> ${on.colours})`);
// and fewer knife-edge transitions between neighbouring pixels
ok(on.hard < off.hard * 0.95,
  `DLSS5 left just as many hard edges (${(off.hard * 100).toFixed(2)}% -> ${(on.hard * 100).toFixed(2)}%)`);
console.log(`  supersampled: ${off.colours} -> ${on.colours} shades, ` +
  `hard edges ${(off.hard * 100).toFixed(2)}% -> ${(on.hard * 100).toFixed(2)}%, ` +
  `mean step ${off.mean.toFixed(1)} -> ${on.mean.toFixed(1)}`);

// ---- the lighting half: a soft bloom over everything that burns ------------
// DLSS5 is not only sharper pixels. It cuts the darkness layer finer and then
// blows the light layer back up over the top of it, so a lamp looks like it is
// giving off light instead of being stencilled on the floor.
function litFrame(dlss) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(3);
  g.setDlss(dlss);
  for (let i = 0; i < 120; i++) g.update(H);
  const c = nc(M.VW, M.VH);
  const cx = c.getContext('2d');
  g.draw(cx);
  const d = cx.getImageData(0, 0, M.VW, M.VH).data;
  let sum = 0, bright = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += v;
    if (v > 60) bright++;
  }
  return { mean: sum / (d.length / 4), bright, scale: g.lighting.scale };
}

const plainLight = litFrame(false);
const bloomLight = litFrame(true);
ok(bloomLight.mean > plainLight.mean,
  `DLSS5 did not make the picture any brighter (${plainLight.mean.toFixed(2)} -> ${bloomLight.mean.toFixed(2)})`);
ok(bloomLight.bright > plainLight.bright * 1.02,
  `DLSS5 did not spread the light (${plainLight.bright} -> ${bloomLight.bright} lit pixels)`);
ok(bloomLight.scale > plainLight.scale,
  'DLSS5 did not cut the darkness any finer');
console.log(`  lighting: mean ${plainLight.mean.toFixed(2)} -> ${bloomLight.mean.toFixed(2)}, ` +
  `lit pixels ${plainLight.bright} -> ${bloomLight.bright}, ` +
  `shadow layer ${plainLight.scale} -> ${bloomLight.scale}`);

// ---- the grade: a graded picture is not just a brighter one ----------------
// DLSS5 also runs a colourist's pass over the lit frame -- warm highlights,
// pushed contrast, film grain, a deeper vignette. So the corners fall darker
// and the centre runs warmer than the ungraded picture.
function graded(dlss) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.startRound(3); g.setDlss(dlss);
  for (let i = 0; i < 90; i++) g.update(H);
  const c = nc(M.VW, M.VH).getContext('2d');
  g.draw(c);
  const d = c.getImageData(0, 0, M.VW, M.VH).data;
  const at = (x, y) => { const i = (y * M.VW + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  // the four corners, averaged
  const corners = [[6, 6], [M.VW - 6, 6], [6, M.VH - 6], [M.VW - 6, M.VH - 6]]
    .map(([x, y]) => at(x, y)).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]).map((v) => v / 4);
  const corner = (corners[0] + corners[1] + corners[2]) / 3;
  // the centre of the frame
  let cl = 0, cn = 0;
  for (let y = M.VH * 0.4; y < M.VH * 0.6; y++) {
    for (let x = M.VW * 0.4; x < M.VW * 0.6; x++) {
      const [r, g2, b] = at(x | 0, y | 0);
      cl += (r + g2 + b) / 3; cn++;
    }
  }
  const centre = cl / cn;
  // warmth in the middle of the frame, R minus B
  let rb = 0, n = 0;
  for (let y = M.VH * 0.35; y < M.VH * 0.65; y++) {
    for (let x = M.VW * 0.35; x < M.VW * 0.65; x++) {
      const [r, , b] = at(x | 0, y | 0);
      rb += r - b; n++;
    }
  }
  return { corner, centre, warmth: rb / n, data: d };
}
const flat = graded(false), film = graded(true);
// the grade lifts the whole frame, so the corners can be brighter in absolute
// terms; what matters is that the edges fall away *relative* to the centre
ok(film.centre - film.corner > flat.centre - flat.corner,
  `DLSS5 did not deepen the falloff (centre-corner `
  + `${(flat.centre - flat.corner).toFixed(1)} -> ${(film.centre - film.corner).toFixed(1)})`);
let gradeDiff = 0, gn = 0;
for (let i = 0; i < flat.data.length; i += 4) {
  gradeDiff += Math.abs(flat.data[i] - film.data[i])
    + Math.abs(flat.data[i + 1] - film.data[i + 1])
    + Math.abs(flat.data[i + 2] - film.data[i + 2]);
  gn++;
}
ok(gradeDiff / gn > 6,
  `the grade is invisible (${(gradeDiff / gn).toFixed(1)} mean channel difference)`);
console.log(`  grade: centre-corner falloff `
  + `${(flat.centre - flat.corner).toFixed(1)} -> ${(film.centre - film.corner).toFixed(1)}, `
  + `warmth ${flat.warmth.toFixed(1)} -> ${film.warmth.toFixed(1)}, `
  + `mean channel diff ${(gradeDiff / gn).toFixed(1)}`);

// and it is a switch: turning it back off takes it all away again
{
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.setDlss(true);
  const upScale = g.lighting.scale;
  g.setDlss(false);
  ok(g.lighting.scale < upScale, 'DLSS5 would not switch back off');
  ok(!g._dlss, 'the game still thinks DLSS5 is on');
}

if (fails.length) {
  console.log('DLSS FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('DLSS PASS  supersampling smooths the frame and leaves the mouse alone');
}
