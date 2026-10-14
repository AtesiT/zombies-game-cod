// Headless harness: the settings panel must be usable with a mouse, not just
// the keyboard. Hovering a row selects it, clicking a toggle flips it,
// clicking a slider drags it, and the wheel walks the list.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { settingsLayout, settingsRowAt, settingsSliderRect } = await import(SRC + '/hud.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 31337;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const inp = new M.Input(nc(M.VW, M.VH));
const g = new M.Game(inp);
g.begin();
g.settingsOpen = true;
for (let i = 0; i < 5; i++) { g.update(H); inp.endFrame(); }

const idx = (id) => M.SETTING_DEFS.findIndex((d) => d.id === id);
const rowCenter = (i) => {
  const L = settingsLayout(g, M.VW, M.VH);
  return { x: L.cx + L.cw / 2, y: L.cy + L.HEAD + (i - L.top) * L.ROW };
};

// ---- 1. hovering a row selects it -----------------------------------------
const dlssI = idx('dlss');
g.settingsIndex = dlssI;          // make sure the row is scrolled into view
g.update(H); inp.endFrame();
let c = rowCenter(dlssI);
inp.mouse.x = c.x; inp.mouse.y = c.y;
g.update(H); inp.endFrame();
ok(g.settingsIndex === dlssI, 'hover did not select the row under the pointer');

// ---- 2. clicking a toggle flips it -----------------------------------------
const was = M.settings.get('dlss');
inp.mouse.pressed = true;
g.update(H); inp.endFrame();
ok(M.settings.get('dlss') === !was, 'clicking a toggle row did not flip it');

// ---- 3. clicking on a range slider drags the value -------------------------
M.settings.set('lighting', 2);
g.settingsIndex = idx('lighting');
g.update(H); inp.endFrame();
const L2 = settingsLayout(g, M.VW, M.VH);
const { bx, bw } = settingsSliderRect(g, M.VW, M.VH);
const ry = L2.cy + L2.HEAD + (idx('lighting') - L2.top) * L2.ROW;
inp.mouse.x = bx + bw * 0.1; inp.mouse.y = ry; inp.mouse.pressed = true;
g.update(H); inp.endFrame();
ok(M.settings.get('lighting') === 0, `slider click at 10% did not land low (got ${M.settings.get('lighting')})`);
inp.mouse.x = bx + bw; inp.mouse.y = ry; inp.mouse.pressed = true;
g.update(H); inp.endFrame();
ok(M.settings.get('lighting') === 2, 'slider click at the right end did not land on max');

// ---- 4. the wheel walks the list -------------------------------------------
const before = g.settingsIndex;
inp.wheel = 2;
g.update(H); inp.endFrame();
ok(g.settingsIndex === Math.min(M.SETTING_DEFS.length - 1, before + 2), 'wheel did not walk the list');
inp.wheel = -99;
g.update(H); inp.endFrame();
ok(g.settingsIndex === 0, 'wheel up did not clamp at the top');

// ---- 5. a click outside the panel does nothing ------------------------------
const dBefore = M.settings.get('blood');
inp.mouse.x = 4; inp.mouse.y = 4; inp.mouse.pressed = true;
g.update(H); inp.endFrame();
ok(M.settings.get('blood') === dBefore, 'an outside click hit a row anyway');

// restore for other tools that share this process's localStorage
M.settings.set('dlss', was);
M.settings.set('lighting', 2);

if (fails.length) { console.error('SETTINGSMOUSE FAIL'); for (const f of fails) console.error(' -', f); process.exit(1); }
console.log('SETTINGSMOUSE PASS  hover picks, click flips, slider drags, wheel walks');
