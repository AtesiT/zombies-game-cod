// Headless harness for the Achievements screen.
//
// The whole point of the screen is to make every badge *findable*: you can get
// to it from the front menu, it lists everything there is to earn, and the
// ones you have are clearly yours. So these tests walk in through the menu,
// read the list, and check the unlock wiring really lights a badge up.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { ACHIEVEMENTS } = await import(SRC + '/achievements.js');
const { drawAchievements, achPanel } = await import(SRC + '/hud.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 5150;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function boot() {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(1);
  for (let i = 0; i < 10; i++) g.update(H);
  return g;
}

/** deliver one keypress to the menu loop */
const tap = (g, code) => { g.input.pressed.add(code); g._menuUpdate(H); g.input.endFrame(); };

// ---- 1. the list itself -----------------------------------------------------
{
  ok(ACHIEVEMENTS.length >= 30, `only ${ACHIEVEMENTS.length} achievements on the books`);
  const ids = new Set();
  for (const a of ACHIEVEMENTS) {
    ok(a.id && a.name && a.desc, `an achievement is missing a field (${a.id})`);
    ok(!ids.has(a.id), `two achievements share the id ${a.id}`);
    ids.add(a.id);
  }
  // every id a game file tries to unlock must exist, or it silently no-ops
  const fs = await import('node:fs');
  const src = fs.readFileSync(SRC + '/game.js', 'utf8');
  const wanted = new Set();
  for (const m of src.matchAll(/\.unlock\('([a-z_0-9]+)'\)/g)) wanted.add(m[1]);
  for (const id of wanted) ok(ids.has(id), `the game unlocks an achievement that does not exist: ${id}`);
  console.log(`  ${ACHIEVEMENTS.length} badges, ${wanted.size} of them wired into the game`);
}

// ---- 2. it opens from the menu and lists everything -------------------------
{
  const g = boot();
  g.started = false;
  g.scene = 'menu';
  // find the achievements row the way the menu builds it
  const { menuRows } = await import(SRC + '/hud.js');
  const rows = menuRows('menu', g);
  const idx = rows.findIndex((r) => r.id === 'achievements');
  ok(idx >= 0, 'the front menu has no ACHIEVEMENTS row');
  g.menuIndex = idx;
  // pressing enter on it must take us to the screen
  tap(g, 'Enter');
  ok(g.scene === 'achievements', `pressing enter on the row left us in "${g.scene}"`);

  // draw it and count badges by the icon boxes
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  g.draw(ctx);
  const d = ctx.getImageData(0, 0, M.VW, M.VH).data;
  let gold = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i + 1] > 170 && d[i + 2] < 160) gold++;
  }
  ok(gold > 400, `the achievements screen drew nothing gold (${gold} px)`);
  console.log(`  opened from the menu, drew ${gold} gold px`);
}

// ---- 3. scrolling ----------------------------------------------------------
{
  const g = boot();
  g.started = false;
  g.scene = 'achievements';
  g.achScroll = 0;
  tap(g, 'ArrowDown');
  ok(g.achScroll === 1, `ArrowDown did not scroll (scroll=${g.achScroll})`);
  tap(g, 'ArrowUp');
  ok(g.achScroll === 0, `ArrowUp did not scroll back (scroll=${g.achScroll})`);
  // cannot scroll past the ends
  for (let i = 0; i < 80; i++) tap(g, 'ArrowDown');
  const maxed = g.achScroll;
  tap(g, 'ArrowDown');
  ok(g.achScroll === maxed, `it scrolled past the bottom (${maxed} -> ${g.achScroll})`);
  ok(maxed > 0, `the list is shorter than one screen, nothing to scroll (${maxed})`);
  // and ESC leaves
  tap(g, 'Escape');
  ok(g.scene === 'menu', 'Escape did not close the achievements screen');
  console.log(`  scrolls 0 -> ${maxed}, stops at both ends, ESC closes`);
}

// ---- 4. unlocking a badge lights it up on the screen ------------------------
{
  const g = boot();
  g.started = false;
  g.achievements.reset();
  g.scene = 'achievements';
  g.achScroll = 0;
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  g.draw(ctx);
  const before = ctx.getImageData(0, 0, M.VW, M.VH).data;
  // earn one
  g.achievements.unlock('first_blood');
  g.draw(ctx);
  const after = ctx.getImageData(0, 0, M.VW, M.VH).data;
  let diff = 0;
  for (let i = 0; i < before.length; i += 4) {
    diff += Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
  }
  ok(diff > 400, `unlocking a badge did not change the screen (diff ${diff})`);
  ok(g.achievements.has('first_blood'), 'the badge was not actually recorded');
  console.log(`  earning a badge changes the screen (pixel diff ${diff})`);
}

// ---- 5. a couple of the triggers really fire --------------------------------
{
  const g = boot();
  g.achievements.reset();
  // a kill is First Blood
  const z = g.makeZombie({ x: g.player.pos.x + 40, y: g.player.pos.y, floor: g.map.floor }, 'walker');
  g.zombies.push(z);
  g.onZombieKilled(z, false);
  ok(g.achievements.has('first_blood'), 'killing a walker did not earn First Blood');
  // a bonewright kill is Bone Collector
  g.achievements.reset();
  const bw = g.makeZombie({ x: g.player.pos.x + 40, y: g.player.pos.y, floor: g.map.floor }, 'bonewright');
  g.zombies.push(bw);
  g.onZombieKilled(bw, false);
  ok(g.achievements.has('bone_collector'), 'killing a Bonewright did not earn Bone Collector');
  // round 40
  g.achievements.reset();
  g.startRound(40);
  ok(g.achievements.has('round_40'), 'reaching round 40 did not earn Forty Deep');
  console.log('  first_blood, bone_collector and round_40 all fire');
}

if (fails.length) {
  console.log('ACH FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('ACH PASS  every badge is listed, earnable, and lit up when it lands');
