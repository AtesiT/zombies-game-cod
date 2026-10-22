// Headless harness for the debug panel.
//
// It is a testing tool, so the one thing it must never do is break the game
// it is testing: every row has to run without throwing, god mode has to
// actually stop the damage, the panel has to pause the round behind it, and
// it has to be openable from a phone that has no backquote key.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { drawDebug, debugHitTest, debugPanel } = await import(SRC + '/hud.js');
const { PERKS } = await import(SRC + '/perks.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 4242;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

function boot() {
  const inp = new M.Input(nc(M.VW, M.VH));
  const g = new M.Game(inp);
  g.begin();
  g.startRound(3);
  for (let i = 0; i < 90; i++) { g.update(H); inp.endFrame(); }
  return { g, inp };
}
/** Press a key for one step. */
function key(inp, code) { inp.pressed.add(code); inp.keys.add(code); }
function click(inp, x, y) {
  inp.mouse.x = x; inp.mouse.y = y;
  inp.mouse.pressed = true; inp.mouse.down = true;
}

// ---- 1. it opens on the backquote, and pauses the round behind it ----------
{
  const { g, inp } = boot();
  ok(!g.debugOpen, 'the debug panel is open before anybody asked for it');
  key(inp, 'Backquote');
  g.update(H); inp.endFrame();
  ok(g.debugOpen, 'the backquote key did not open the debug panel');
  ok(g.paused, 'the round kept going behind the debug panel');

  // the world is frozen while you are in there
  const t0 = g.time, r0 = g.round;
  const z0 = g.zombies.length;
  for (let i = 0; i < 60; i++) { g.update(H); inp.endFrame(); }
  ok(g.round === r0, 'a round ended while the debug panel was open');
  ok(g.zombies.length === z0, 'the dead kept spawning behind the debug panel');
  ok(g.time > t0, 'the clock stopped too -- nothing would animate');

  // ...and it closes again without eating the press
  key(inp, 'Backquote');
  g.update(H); inp.endFrame();
  ok(!g.debugOpen, 'the backquote key did not close it again');
  ok(!g.paused, 'the round stayed paused after the panel closed');
}

// ---- 2. every row does something, and none of them break the game ----------
{
  const { g: g0 } = boot();
  const rows = g0.debugRows();
  ok(rows.length >= 10, `only ${rows.length} rows in the debug panel`);
  const ids = new Set(rows.map((r) => r.id));
  ok(ids.size === rows.length, 'two rows in the debug panel share an id');
  for (const r of rows) {
    ok(typeof r.label === 'string' && r.label.length > 0, `row ${r.id} has no label`);
    ok(typeof r.value === 'string' && r.value.length > 0, `row ${r.id} shows no value`);
  }

  // what each row is supposed to have done, checked on a clean game each time
  // -- run in sequence they interfere with one another quite legitimately:
  // handing over a Ray Gun changes what "the current gun" means, and jumping
  // storey changes which doors you are looking at.
  const effects = {
    god: (g) => g.debug.god === true,
    ammo: (g) => g.debug.ammo === true,
    paths: (g) => g.debug.paths === true,
    points: (g) => g.player.points >= 5000,
    perks: (g) => g.player.perks.size >= Math.min(6, Object.keys(PERKS).length),
    armour: (g) => g.player.armor > 0,
    pack: (g) => g.player.packed.has(g.player.current),
    ray: (g) => !!g.player.loadout.raygun?.owned,
    power: (g) => g.powerOn === true,
    doors: (g) => g.map.doors.every((d) => d.open)
      && g.map.barricades.every((b) => b.planks === 0),
    floor: (g) => g.map.floor !== 0 && g.player.floor === g.map.floor,
    drop: (g) => g.powerups.length > 0,
    kill: (g) => g.zombies.filter((z) => !z.dead && (z.floor ?? 0) === g.map.floor).length === 0,
    round: (g) => g.roundActive === false,
  };

  for (const r of rows) {
    const { g, inp } = boot();
    let threw = null;
    try { g._debugRun(r.id); } catch (e) { threw = e; }
    ok(!threw, `the row ${r.id} threw: ${threw?.message}`);
    try { g.update(H); inp.endFrame(); } catch (e) { ok(false, `the game broke after ${r.id}: ${e.message}`); }
    ok(Number.isFinite(g.player.hp) && Number.isFinite(g.player.pos.x),
      `the row ${r.id} left the player as ${g.player.hp} hp at ${g.player.pos.x}`);
    const check = effects[r.id];
    ok(check ? check(g) : true, `the row ${r.id} did nothing you can see`);
  }

  // and all of them, one after another, on the same poor game
  const { g, inp } = boot();
  for (const r of rows) {
    try { g._debugRun(r.id); g.update(H); inp.endFrame(); } catch (e) {
      ok(false, `the game broke running everything, at ${r.id}: ${e.message}`);
    }
  }
  ok(Number.isFinite(g.player.hp) && g.player.points >= 0, 'running every row wrecked the game');
  console.log(`  rows: ${rows.length} of them, all of them ran`);
}

// ---- 3. god mode really does stop the damage --------------------------------
{
  const { g } = boot();
  g.player.invuln = 0;
  g.player.hp = 100;
  g.debug.god = true;
  g.player.hurt(40, 0, 0, g);
  ok(g.player.hp === 100, `god mode let ${100 - g.player.hp} damage through`);
  g.debug.god = false;
  g.player.invuln = 0;
  g.player.hurt(40, 0, 0, g);
  ok(g.player.hp < 100, 'without god mode the hit did nothing either');
  console.log(`  god: 100 hp held, then ${(100 - g.player.hp).toFixed(0)} taken`);
}

// ---- 4. infinite ammo really is --------------------------------------------
{
  const { g, inp } = boot();
  g.debug.ammo = true;
  const id = g.player.current;
  const before = g.player.loadout[id].mag;
  for (let i = 0; i < 30; i++) { g.update(H); inp.endFrame(); }
  const s = g.player.loadout[id];
  ok(s.mag >= before, `the magazine drained to ${s.mag} with infinite ammo on`);
  ok(s.reserve > 0, 'the reserve ran dry with infinite ammo on');
  console.log(`  ammo: ${s.mag} in the magazine, ${s.reserve} in reserve`);
}

// ---- 5. the panel draws, and a click lands on a row -------------------------
{
  const { g } = boot();
  g.debugOpen = true;
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  let threw = null;
  try { g.draw(ctx); } catch (e) { threw = e; }
  ok(!threw, `drawing the debug panel threw: ${threw?.message}`);

  const p = debugPanel(g, M.VW, M.VH);
  ok(p.x >= 0 && p.y >= 0 && p.x + p.cw <= M.VW && p.y + p.ch <= M.VH,
    `the panel runs off the screen at ${p.x},${p.y} ${p.cw}x${p.ch}`);
  // The roster outgrew the panel, so it scrolls: put the cursor on a row and
  // the window follows it, and then the row is on screen and hit-testable.
  for (let i = 0; i < p.rows.length; i++) {
    g.debugIndex = i;
    const q = debugPanel(g, M.VW, M.VH);
    ok(i >= q.top && i < q.top + q.shown, `row ${i} is outside the scrolled window`);
    const hit = debugHitTest(g, M.VW, M.VH, q.x + q.cw / 2, q.y + q.head + (i - q.top) * q.rowH + 4);
    ok(hit === i, `row ${i} was hit as ${hit}`);
  }
  ok(debugHitTest(g, M.VW, M.VH, 2, 2) === -1, 'clicking outside the panel picked a row');

  // and clicking a row does that row
  const before = g.player.points;
  const idx = g.debugRows().findIndex((r) => r.id === 'points');
  g.debugIndex = idx;
  click(g.input, p.x + p.cw / 2, p.y + p.head + idx * p.rowH + 4);
  g.update(H); g.input.endFrame();
  ok(g.player.points > before, 'clicking +5000 POINTS did nothing');
  console.log(`  panel: ${p.rows.length} rows, ${p.cw}x${p.ch} at ${p.x},${p.y}`);
}

// ---- 6. a phone has no backquote key: the pause menu, and five taps ---------
// The corner of the picture used to be the hidden door, and it is now the
// pause chip -- so the door moved to the word PAUSED, and the pause menu
// carries a DEBUG PANEL row that anybody can see.
{
  const { g, inp } = boot();
  const { backChipAt, PAUSE_ROWS, pauseTitleAt, pauseHitTest } = await import(SRC + '/hud.js');
  // firing at the top-left corner of a live round must never open it
  for (let i = 0; i < 12; i++) { click(inp, 20, 20); g.update(H); inp.endFrame(); }
  ok(!g.debugOpen, 'clicking the corner during a round opened the debug panel');
  // and that corner is the pause chip: one press stops the world
  ok(g.paused, 'the top-left pause chip did not pause the round');

  ok(PAUSE_ROWS.some((r) => r.label === 'DEBUG PANEL'), 'the pause menu has no debug row');
  const row = PAUSE_ROWS.findIndex((r) => r.label === 'DEBUG PANEL');
  g.paused = true;
  const rr = pauseHitTest(g, M.VW, M.VH, M.VW / 2, M.VH * 0.30) ;  // sanity: title, not a row
  ok(rr === -1, `the title was read as pause row ${rr}`);
  g._pauseChoose(row);
  ok(g.debugOpen, 'the pause menu row did not open the debug panel');
  g.debugOpen = false; g.paused = true;

  // five taps on the PAUSED title still work as the shortcut
  const tap = () => {
    inp.mouse.x = M.VW / 2; inp.mouse.y = M.VH * 0.30; inp.mouse.pressed = true;
    g.update(H); inp.endFrame();
  };
  ok(pauseTitleAt(M.VW, M.VH, M.VW / 2, M.VH * 0.30), 'the PAUSED word is not the tap target');
  for (let i = 0; i < 4; i++) tap();
  ok(!g.debugOpen, 'four taps opened it -- five were wanted');
  tap();
  ok(g.debugOpen, 'five taps on PAUSED did not open the debug panel');
  g.debugOpen = false; g.paused = true;
  tap();
  for (let i = 0; i < 30; i++) { g.update(H); inp.endFrame(); }
  tap();
  ok(!g.debugOpen, 'two taps a second apart opened it');
  // and every panel can be left with the corner chip, with no keyboard
  g.paused = true; g.debugOpen = true;
  const b = { x: M.VW - 20, y: 20 };
  ok(backChipAt(M.VW, M.VH, b.x, b.y), 'the back chip is not where the corner is');
  click(inp, b.x, b.y); g.update(H); inp.endFrame();
  ok(!g.debugOpen, 'the back chip did not close the debug panel');
  console.log('  phone: pause chip, pause-menu debug row, five taps and the back chip');
}

// ---- 7. the walls-and-paths overlay draws -----------------------------------
{
  const { g, inp } = boot();
  g.debug.paths = true;
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  let threw = null;
  try { for (let i = 0; i < 5; i++) { g.update(H); inp.endFrame(); g.draw(ctx); } } catch (e) { threw = e; }
  ok(!threw, `the walls-and-paths overlay threw: ${threw?.message}`);
}

// ---- 8. and none of it leaks into a fresh game ------------------------------
{
  const { g } = boot();
  ok(g.debug.god === false && g.debug.ammo === false && g.debug.paths === false,
    'a new game starts with the debug switches already on');
  ok(!g.debugOpen, 'a new game starts with the debug panel open');
}

if (fails.length) {
  console.log('DEBUGMENU FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('DEBUGMENU PASS  the panel opens, every row runs, and nothing breaks');
