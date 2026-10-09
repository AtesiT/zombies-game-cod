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

// the keyboard walks the list, the mouse points at it; both must agree
const rowY = (i) => M.VH * 0.46 + i * 27;
const click = (i) => {
  g.input.mouse.x = M.VW / 2;
  g.input.mouse.y = rowY(i);
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
    const hit = M.menuHitTest(scene, M.VW / 2, rowY(i), g);
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

if (fails.length) {
  console.log('FRONTMENU FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('FRONTMENU PASS  three doors, every screen, mouse and keyboard alike');
}
