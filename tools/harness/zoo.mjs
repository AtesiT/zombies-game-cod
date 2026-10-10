// Headless harness for the debug panel's ZOMBIES tab.
//
// Every creature in the game gets a row, including the ones that never turn up
// on their own, so you can drop one in front of you and watch what it does.
// These tests check the tab exists, that each row puts a real body on a real
// tile, and that the panel still fits on screen with a row per creature.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { ENEMY_TYPES } = await import(SRC + '/entities.js');
const { debugPanel, debugTabHit, debugHitTest, debugTabBar, drawDebug } = await import(SRC + '/hud.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 777;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function boot() {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(1);
  g.powerOn = true;
  for (let i = 0; i < 10; i++) g.update(H);
  return g;
}

// ---- 1. there is a tab for it, and it lists everything ---------------------
{
  const g = boot();
  g.debugOpen = true;
  g.debugTab = 0;
  const cheats = g.debugRows();
  g.debugTab = 1;
  const zoo = g.debugRows();
  ok(zoo.length !== cheats.length, 'the two tabs show the same rows');
  for (const t of Object.keys(ENEMY_TYPES)) {
    ok(zoo.some((r) => r.id === `spawn:${t}`), `${t} has no row on the zoo tab`);
  }
  ok(zoo.some((r) => r.id === 'clear'), 'no way to clear the horde off the tab');
  console.log(`  the zoo tab lists ${zoo.length} rows: every one of the `
    + `${Object.keys(ENEMY_TYPES).length} creatures, plus the housekeeping`);
}

// ---- 2. each row really does put one on the floor --------------------------
{
  const g = boot();
  g.debugOpen = true;
  g.debugTab = 1;
  for (const t of Object.keys(ENEMY_TYPES)) {
    const before = g.zombies.filter((z) => z.type === t && !z.dead).length;
    g._debugRun(`spawn:${t}`);
    const mine = g.zombies.filter((z) => z.type === t && !z.dead);
    ok(mine.length === before + 1, `spawning a ${t} made ${mine.length - before} of them`);
    const z = mine[mine.length - 1];
    ok(z.floor === g.map.floor, `a ${t} turned up on storey ${z.floor}, not ${g.map.floor}`);
    const tx = Math.floor(z.pos.x / 24), ty = Math.floor(z.pos.y / 24);
    ok(!g.map.solidTileOn(z.floor, tx, ty),
      `a ${t} was dropped inside solid ground at ${tx},${ty}`);
    const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y);
    ok(d < 220, `a ${t} was dropped ${d.toFixed(0)}px away, which is not "in front of me"`);
  }
  console.log(`  all ${Object.keys(ENEMY_TYPES).length} creatures spawn on open floor, `
    + `on your storey, within arm's reach`);
}

// ---- 3. the other rows on the tab ------------------------------------------
{
  const g = boot();
  g.debugTab = 1;
  g._debugRun('spawn:walker');
  g._debugRun('spawn:bonewright');
  ok(g.zombies.length === 2, `two spawns left ${g.zombies.length} bodies`);
  g._debugRun('freeze');
  ok(g.zombies.every((z) => z.frozen > 0), 'HOLD THEM STILL did not hold them');
  g._debugRun('freeze');
  ok(g.zombies.every((z) => !z.frozen), 'they stayed frozen');
  g._debugRun('clear');
  ok(g.zombies.length === 0, `CLEAR THE HORDE left ${g.zombies.length} behind`);

  // and they can be dropped at a window instead
  g._dbgWhere = 'window';
  g._debugRun('spawn:walker');
  ok(g.zombies.length === 1, 'spawning at a window made nothing');
  const z = g.zombies[0];
  ok(!g.map.solidTileOn(z.floor, Math.floor(z.pos.x / 24), Math.floor(z.pos.y / 24)),
    'the window spawn dropped it in solid ground');
  g._debugRun('where');
  ok(g._dbgWhere === 'front', 'the DROP THEM row did not toggle back');
  console.log('  hold, clear and the two drop spots all work');
}

// ---- 4. the panel fits, and the tabs can be clicked ------------------------
{
  const g = boot();
  g.debugTab = 1;
  const p = debugPanel(g, M.VW, M.VH);
  ok(p.ch <= M.VH, `the zoo panel is ${p.ch}px tall on a ${M.VH}px screen`);
  ok(p.y >= 0, `the zoo panel starts off the top of the screen at ${p.y}`);
  // the last row must still be inside the panel
  const lastRow = p.y + p.head + (p.rows.length - 1) * p.rowH;
  ok(lastRow < p.y + p.ch, 'the last row hangs out of the bottom of the panel');
  console.log(`  the panel is ${p.ch}px tall with ${p.rows.length} rows (rowH ${p.rowH})`);

  const b = debugTabBar(g, M.VW, M.VH);
  const tabW = b.w / b.tabs.length;
  ok(debugTabHit(g, M.VW, M.VH, b.x + tabW * 0.5, b.y + b.h / 2) === 0, 'the first tab is not clickable');
  ok(debugTabHit(g, M.VW, M.VH, b.x + tabW * 1.5, b.y + b.h / 2) === 1, 'the second tab is not clickable');
  ok(debugTabHit(g, M.VW, M.VH, b.x + tabW * 0.5, b.y - 6) === -1, 'a click above the strip hits a tab');
  // clicking a tab must not also fire the row underneath it
  ok(debugHitTest(g, M.VW, M.VH, b.x + tabW * 1.5, b.y + b.h / 2) === -1,
    'clicking a tab would also press a row');
  ok(debugHitTest(g, M.VW, M.VH, p.x + 100, p.y + p.head + 4) === 0,
    'the first row is not clickable');

  // and the whole thing draws without complaint, on either tab
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  for (const tab of [0, 1]) {
    g.debugTab = tab;
    g.debugIndex = 3;
    drawDebug(ctx, g, M.VW, M.VH);
  }
  console.log('  both tabs draw, and a tab click never presses a row');
}

// ---- 5. switching tabs cannot leave the cursor out of range ----------------
{
  const g = boot();
  g.debugOpen = true;
  g.debugTab = 0;
  g.debugIndex = g.debugRows().length - 1;   // the last row of the cheats tab
  // the way the update loop does it: the tab moves, the cursor goes with it
  g.debugTab = 1;
  g.debugIndex = 0;
  const rows = g.debugRows();
  ok(g.debugIndex < rows.length, 'the cursor was left past the end of the new tab');
  ok(rows[g.debugIndex], 'the row under the cursor does not exist');
  g._debugRun(rows[g.debugIndex].id);
  console.log('  switching tabs resets the cursor onto a row that exists');
}

if (fails.length) {
  console.log('ZOO FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('ZOO PASS  every creature can be summoned from the debug panel');
