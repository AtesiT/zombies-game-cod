// The settings panel grew by three rows -- does it still fit on screen, and
// does every row actually get drawn?
import { nc, load } from './stub.mjs';
const M = await load();
const { drawSettings } = await import('/home/user/zombies-game-cod/src/hud.js');
const { SETTING_DEFS } = await import('/home/user/zombies-game-cod/src/settings.js');
let fails = 0;
const ok = (c, l, x = '') => { console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`); if (!c) fails++; };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin(); g.power = true; g.powerOn = true; g.started = true;
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
g.settingsIndex = 0;
drawSettings(cx, g, M.VW, M.VH);
const d = cx.getImageData(0, 0, M.VW, M.VH).data;

// the panel is the brighter box on a near-black wash: find its vertical extent
let top = -1, bot = -1;
for (let y = 0; y < M.VH; y++) {
  let bright = 0;
  for (let x = 0; x < M.VW; x++) { const o = (y * M.VW + x) * 4; if (d[o] + d[o + 1] + d[o + 2] > 60) bright++; }
  if (bright > 200) { if (top < 0) top = y; bot = y; }
}
ok(top >= 0 && bot <= M.VH - 1, `panel fits on screen (${SETTING_DEFS.length} rows)`, `y ${top}..${bot} of ${M.VH}`);
ok(top >= 4 && bot <= M.VH - 5, 'panel keeps a margin top and bottom', `y ${top}..${bot}`);

// count row bands: each row inks the left label column
const bands = new Set();
for (let y = top; y <= bot; y++) {
  let ink = 0;
  for (let x = 195; x < 340; x++) { const o = (y * M.VW + x) * 4; if (d[o] + d[o + 1] + d[o + 2] > 150) ink++; }
  if (ink > 3) bands.add(Math.round((y - top) / 24));
}
ok(bands.size >= SETTING_DEFS.length - 1, `every setting gets a row`, `${bands.size} bands for ${SETTING_DEFS.length} entries`);

// and the selected row is highlighted, so the cursor is visible on the new ones
g.settingsIndex = SETTING_DEFS.length - 2;   // AUTO PERFORMANCE
cx.fillStyle = '#000'; cx.fillRect(0, 0, M.VW, M.VH);
drawSettings(cx, g, M.VW, M.VH);
const d2 = cx.getImageData(0, 0, M.VW, M.VH).data;
let gold = 0;
for (let i = 0; i < d2.length; i += 4) if (d2[i] > 180 && d2[i + 1] > 150 && d2[i + 2] < 160) gold++;
ok(gold > 500, 'the selected row renders its highlight', `${gold} gold px`);

console.log(fails === 0 ? '\nOVERLAY PASS' : `\nOVERLAY FAIL (${fails})`);
process.exit(fails ? 1 : 0);
