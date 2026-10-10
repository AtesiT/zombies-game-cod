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

if (fails.length) {
  console.log('DLSS FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('DLSS PASS  supersampling smooths the frame and leaves the mouse alone');
}
