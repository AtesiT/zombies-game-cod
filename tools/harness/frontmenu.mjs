// Headless harness for the front menu: SOLO / MULTIPLAYER / SETTINGS, with a
// keyboard and with a mouse, on every screen it shows.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
ok(g.scene === 'menu', `a fresh game boots into "${g.scene}", not the menu`);
ok(g.started === false, 'a fresh game is already running');

// the keyboard walks the list, the mouse points at it; both must agree.
// The controls screen is a list, not a menu: it starts higher and packs tighter.
const rowTop = (scene) => M.VH * (scene === 'controls' ? 0.16 : 0.46);
const rowStep = (scene) => (scene === 'controls' ? 21 : 27);
const rowY = (i, scene = 'menu') => rowTop(scene) + i * rowStep(scene);
const click = (i, scene = 'menu') => {
  g.input.mouse.x = M.VW / 2;
  g.input.mouse.y = rowY(i, scene);
  g.input.mouse.pressed = true;
  g.update(H);
  g.input.endFrame();
};
const press = (code) => { g.input.pressed.add(code); g.update(H); g.input.endFrame(); };

// ---- the drawing and the hit test are the same list -----------------------
for (const scene of ['menu', 'mp', 'rooms', 'waiting']) {
  g.scene = scene;
  const rows = M.menuRows(scene, g);
  ok(rows.length > 0, `the "${scene}" screen has no rows`);
  for (let i = 0; i < rows.length; i++) {
    const hit = M.menuHitTest(scene, M.VW / 2, rowY(i, scene), g);
    if (hit !== i) { fails.push(`row ${i} (${rows[i].id}) on "${scene}" hit-tests as ${hit}`); break; }
  }
  ok(M.menuHitTest(scene, 10, 10, g) === -1, `clicking empty space on "${scene}" selected something`);
  let threw = null;
  try { g.draw(nc(M.VW, M.VH).getContext('2d')); } catch (e) { threw = e.message; }
  ok(threw === null, `drawing the "${scene}" screen threw: ${threw}`);
}
g.scene = 'menu';
g.menuIndex = 0;

// ---- MULTIPLAYER ----------------------------------------------------------
press('ArrowDown');
ok(g.menuIndex === 1, `ArrowDown landed on ${g.menuIndex}, expected 1`);
press('Enter');
ok(g.scene === 'mp', `Enter on MULTIPLAYER went to "${g.scene}"`);
ok(M.menuRows('mp', g).map((r) => r.id).join(',') === 'host,join,name,addr,back',
  'the multiplayer screen lost a row');

// JOIN leads to the room list, and every screen can be walked back out of
const rowId = (scene, id) => M.menuRows(scene, g).findIndex((r) => r.id === id);
click(rowId('mp', 'join'));
ok(g.scene === 'rooms', `JOIN went to "${g.scene}"`);
click(rowId('rooms', 'back'));
ok(g.scene === 'menu', `BACK from the room list went to "${g.scene}"`);
click(rowId('menu', 'mp'));
ok(g.scene === 'mp', `MULTIPLAYER went to "${g.scene}"`);
click(rowId('mp', 'back'));
ok(g.scene === 'menu', `BACK from multiplayer went to "${g.scene}"`);

// ---- CONTROLS: an overlay, not another screen -----------------------------
click(rowId('menu', 'controls'));
ok(g.controlsOpen === true, 'CONTROLS did not open');
ok(g.scene === 'menu', 'CONTROLS left the menu instead of opening over it');
ok((M.CONTROL_ROWS ?? []).length >= 12, 'the controls list explains almost nothing');
ok(M.CONTROL_ROWS.every(([what, keys]) => what && keys), 'a row on the controls list is half empty');
let ctrlThrew = null;
try { g.draw(nc(M.VW, M.VH).getContext('2d')); } catch (e) { ctrlThrew = e.message; }
ok(ctrlThrew === null, `drawing the controls panel threw: ${ctrlThrew}`);
press('Escape');
ok(g.controlsOpen === false, 'the controls panel would not close');
// a click closes it too -- on a phone there is no escape key
click(rowId('menu', 'controls'));
ok(g.controlsOpen === true, 'CONTROLS did not open a second time');
g.input.mouse.pressed = true;
g.update(H);
g.input.endFrame();
ok(g.controlsOpen === false, 'a click did not close the controls panel');

// ---- SETTINGS -------------------------------------------------------------
click(rowId('menu', 'settings'));
ok(g.settingsOpen === true, 'SETTINGS did not open the panel');
press('Escape');
ok(g.settingsOpen === false, 'the settings panel would not close');

// ---- SOLO -----------------------------------------------------------------
click(rowId('menu', 'solo'));
ok(g.started === true, 'SOLO did not start the game');
ok(g.round === 1, `SOLO started on round ${g.round}`);
ok(g.scene === null, 'the menu stayed up after starting');
ok(g.players.length === 1, `solo runs with ${g.players.length} bodies`);
ok(g.net.role === 'off', 'solo left the network switched on');

// and the game is really running, not just marked as started
g.player.hurt = () => false;
for (let i = 0; i < 240; i++) { g.update(H); g.input.endFrame(); }
ok(g.zombies.length > 0, 'four seconds in, nothing has spawned');

// ---- with no relay there is at least an explanation, not an empty room ----
// A page served by `python3 -m http.server` has no WebSocket endpoint, and the
// player deserves to be told that instead of staring at an empty room list.
const g2 = new M.Game(new M.Input(nc(M.VW, M.VH)));
const press2 = (code) => { g2.input.pressed.add(code); g2.update(H); g2.input.endFrame(); };
const click2 = (i) => {
  g2.input.mouse.x = M.VW / 2;
  g2.input.mouse.y = M.VH * 0.46 + i * 27;
  g2.input.mouse.pressed = true;
  g2.update(H);
  g2.input.endFrame();
};
press2('ArrowDown'); press2('Enter');
ok(g2.scene === 'mp', 'MULTIPLAYER did not open on the second game');
ok(typeof g2.netMsg === 'string' && g2.netMsg.includes('node server.mjs'),
  `no relay here, but the screen said: ${JSON.stringify(g2.netMsg)}`);
click2(0);                                   // HOST A GAME, with nowhere to host
ok(g2.started === true, 'hosting with no relay should still start a game');
ok(g2.players.length === 1, 'hosting with no relay invented a second player');
ok(g2.net.role === 'host', 'hosting with no relay did not even open a room locally');

if (fails.length) {
  console.log('FRONTMENU FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('FRONTMENU PASS  three doors, every screen, mouse and keyboard alike');
}
