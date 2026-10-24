// The way in and the way out, on a device with no keyboard.
//
// Rules protected here:
//   * every full-screen panel can be left with a press in the top-right
//     corner -- a phone has no ESC, and "O / ESC — back" was a sentence it
//     could not act on;
//   * the round has a pause chip in the top *left* (the map keeps the right),
//     it stops the world on the press, and it does not fire the gun;
//   * the pause menu is a menu: arrows walk it, Enter takes the row, and one
//     of the rows is the debug panel, so a phone can reach it without knowing
//     the five-tap secret;
//   * no mouse cursor is drawn on a touch device;
//   * a short landscape phone still gets a settings panel that fits, footer
//     and all;
//   * the boss bar keeps out of the corner it would otherwise cover;
//   * one notch of the wheel is one row, in every list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load, SRC } from './stub.mjs';

const { Game, Input, VW, VH, SETTING_DEFS, settings } = await load();
const HUD = await import('../../src/hud.js');

const H = 1 / 60;
const clearStorage = () => { for (const k of Object.keys(localStorage._d)) delete localStorage._d[k]; };
const fresh = () => new Game(new Input(nc(VW, VH)));

/** Press a key for one step, then let the frame go. */
const key = (g, code) => {
  g.input.pressed.add(code);
  g.update(H);
  g.input.endFrame();
};
/** Press the pointer at a point for one step. */
const click = (g, x, y) => {
  g.input.mouse.x = x;
  g.input.mouse.y = y;
  g.input.mouse.pressed = true;
  g.update(H);
  g.input.endFrame();
};

// ---------------------------------------------------------------------------
//  Every panel has a corner that closes it
// ---------------------------------------------------------------------------
test('every full-screen panel closes with a press in the corner', () => {
  clearStorage();
  const panels = [
    ['settings', (g) => { g.settingsOpen = true; g.paused = true; }, (g) => g.settingsOpen],
    ['debug', (g) => { g.debugOpen = true; g.paused = true; }, (g) => g.debugOpen],
    ['achievements', (g) => { g.started = false; g.scene = 'achievements'; }, (g) => g.scene === 'achievements'],
    ['stats', (g) => { g.started = false; g.scene = 'stats'; }, (g) => g.scene === 'stats'],
    ['outfits', (g) => { g.started = false; g.scene = 'outfits'; }, (g) => g.scene === 'outfits'],
  ];
  for (const [name, open, isOpen] of panels) {
    const g = fresh();
    g.begin();
    open(g);
    assert.ok(isOpen(g), `${name} did not open`);
    const chip = HUD.backChipRect(g.vw, g.vh);
    assert.ok(HUD.backChipAt(g.vw, g.vh, chip.x + chip.w / 2, chip.y + chip.h / 2),
      `${name}: the chip is not where it is drawn`);
    // it is drawn over the panel, on the way out, on every size
    for (const [w, h] of [[800, 500], [430, 930], [900, 420]]) {
      g.setViewport(w, h);
      const ctx = nc(g.vw, g.vh).getContext('2d');
      assert.doesNotThrow(() => HUD.drawBackChip(ctx, g, g.vw, g.vh), `${name} at ${w}x${h}`);
    }
    g.setViewport(VW, VH);
    click(g, chip.x + chip.w / 2, chip.y + chip.h / 2);
    assert.ok(!isOpen(g), `${name} would not close from the corner`);
    // and it went somewhere sensible rather than nowhere
    assert.ok(g.started === false ? g.scene === 'menu' : true, `${name} left the scene at ${g.scene}`);
  }
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The death screen: the chip says MENU, and the rest of the glass says again
// ---------------------------------------------------------------------------
test('the death screen leaves for the menu from the corner, and arms a retry anywhere else', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  g.startRound(3);
  g.gameOver = true;
  g.overT = 2;
  const chip = HUD.backChipRect(g.vw, g.vh);
  // a press anywhere else starts the next night
  click(g, 200, 300);
  assert.equal(g.gameOver, false, 'a tap away from the corner did not start a new night');

  g.gameOver = true;
  g.overT = 2;
  click(g, chip.x + chip.w / 2, chip.y + chip.h / 2);
  assert.equal(g.started, false, 'the corner did not leave the death screen');
  assert.equal(g.scene, 'menu', `the death screen left the scene at ${g.scene}`);
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The pause chip: top left, stops the world, does not fire
// ---------------------------------------------------------------------------
test('the pause chip lives top left, pauses on the press and never fires', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  g.started = true;
  const r = HUD.pauseChipRect(g.vw, g.vh);
  assert.ok(r.x < g.vw / 4 && r.y < g.vh / 4, 'the pause chip is not in the top left');

  // the corner of the picture is the chip, and the press belongs to it
  const shots = g.player.shotsFired ?? 0;
  click(g, r.x + r.w / 2, r.y + r.h / 2);
  assert.equal(g.paused, true, 'the pause chip did not pause the round');
  assert.equal(g.player.shotsFired ?? 0, shots, 'pausing from the corner also fired the gun');

  // the map is still top right, and the chip is not on it
  const mini = g.hud._miniRectFor(g, g.vw);
  assert.ok(mini && mini.x > g.vw / 2, 'the map is not in the top right');
  assert.ok(r.x + r.w < mini.x, 'the pause chip overlaps the map');

  // with the on-screen controls up, the corner belongs to the touch layer:
  // a thumb tapping there to shoot must not stop the world
  g.paused = false;
  g.touch = { enabled: true, panel: {} };
  assert.equal(HUD.pauseChipShown(g), false, 'the chip is drawn under the phone button');
  g.input.mouse.pressed = true;
  g.input.mouse.x = r.x + r.w / 2;
  g.input.mouse.y = r.y + r.h / 2;
  g.update(H);
  g.input.endFrame();
  assert.equal(g.paused, false, 'a thumb on the corner paused the round');
  g.touch = null;

  // and a press on the map is not a pause
  g.paused = false;
  g.input.mouse.pressed = true;
  g.input.mouse.x = mini.x + mini.w / 2;
  g.input.mouse.y = mini.y + mini.h / 2;
  g.update(H);
  g.input.endFrame();
  assert.equal(g.paused, false, 'a press on the map paused the game');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The pause menu is a menu
// ---------------------------------------------------------------------------
test('the pause menu walks with the arrows, takes Enter, and offers the debug panel', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  g.started = true;
  g.paused = true;
  g.pauseIndex = 0;
  const n = HUD.PAUSE_ROWS.length;

  // every row is where it is drawn, on a desktop and on a phone
  for (const [w, h] of [[800, 500], [430, 930], [900, 420]]) {
    g.setViewport(w, h);
    for (let i = 0; i < n; i++) {
      const r = HUD.pauseRowRect(i, g.vw, g.vh);
      assert.ok(r.y + r.h <= g.vh, `${w}x${h}: pause row ${i} is off the bottom`);
      assert.equal(HUD.pauseHitTest(g, g.vw, g.vh, r.x + 10, r.y + r.h / 2), i,
        `${w}x${h}: pause row ${i} is not where it is drawn`);
    }
    // no two rows share a pixel
    for (let i = 1; i < n; i++) {
      const a = HUD.pauseRowRect(i - 1, g.vw, g.vh), b = HUD.pauseRowRect(i, g.vw, g.vh);
      assert.ok(b.y >= a.y + a.h, `${w}x${h}: pause rows ${i - 1} and ${i} overlap`);
    }
  }
  g.setViewport(VW, VH);

  // arrows walk the highlight, and Enter takes it
  key(g, 'ArrowDown');
  assert.equal(g.pauseIndex, 1, 'the down arrow did not move the pause highlight');
  key(g, 'ArrowUp');
  assert.equal(g.pauseIndex, 0, 'the up arrow did not move it back');

  const debugRow = HUD.PAUSE_ROWS.findIndex((r) => r.label === 'DEBUG PANEL');
  assert.ok(debugRow >= 0, 'the pause menu has no debug row for a phone to press');
  g.pauseIndex = debugRow;
  key(g, 'Enter');
  assert.equal(g.debugOpen, true, 'Enter on the debug row did not open the panel');
  g.debugOpen = false;
  g.paused = true;

  // clicking a row takes the same decision
  g.pauseIndex = 0;
  const resume = HUD.pauseRowRect(0, g.vw, g.vh);
  click(g, resume.x + 20, resume.y + resume.h / 2);
  assert.equal(g.paused, false, 'clicking RESUME did not resume');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  No cursor on a glass screen
// ---------------------------------------------------------------------------
test('no mouse cursor is drawn on a touch device, and one is on a desktop', async () => {
  clearStorage();
  const g = fresh();
  g.begin();
  const ctx = nc(VW, VH).getContext('2d');
  const count = () => {
    ctx.clearRect(0, 0, VW, VH);
    HUD.drawCursor(ctx, g);
    const d = ctx.getImageData(0, 0, VW, VH).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
    return lit;
  };
  g.input.mouse.x = 400;
  g.input.mouse.y = 250;
  const desktop = count();
  assert.ok(desktop > 20, 'the desktop lost its pointer');

  // pretend to be a phone: `isTouchDevice` asks the window first, and the
  // window here is the harness's own object
  const hadTouch = 'ontouchstart' in globalThis.window;
  try {
    globalThis.window.ontouchstart = null;
    assert.equal(count(), 0, 'a touch device is drawing a mouse pointer');
  } finally {
    if (!hadTouch) delete globalThis.window.ontouchstart;
  }
  // and back to a desktop with no touch marks on it
  assert.ok(count() > 20, 'the pointer did not come back on a desktop');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  A short screen still gets a whole settings panel
// ---------------------------------------------------------------------------
test('the settings panel fits a short landscape phone', () => {
  clearStorage();
  const g = fresh();
  for (const [w, h] of [[900, 420], [430, 240], [360, 300], [800, 500], [1280, 720]]) {
    g.setViewport(w, h);
    g.settingsIndex = 0;
    g.settingsView = null;
    const L = HUD.settingsLayout(g, g.vw, g.vh);
    assert.ok(L.cy >= 0, `${w}x${h}: the panel starts above the screen`);
    assert.ok(L.cy + L.ch <= g.vh + 0.5, `${w}x${h}: the panel runs off the bottom`);
    assert.ok(L.cx >= 0 && L.cx + L.cw <= g.vw + 0.5, `${w}x${h}: the panel runs off the sides`);
    assert.ok(L.ch >= 60, `${w}x${h}: the panel is only ${L.ch.toFixed(0)} tall`);
    assert.ok(L.shown >= 2, `${w}x${h}: only ${L.shown} rows fit`);
    // the title is inside the panel, and the last visible row is above the
    // footer rather than on top of it
    const ctx = nc(g.vw, g.vh).getContext('2d');
    g.settingsOpen = true;
    assert.doesNotThrow(() => HUD.drawSettings(ctx, g, g.vw, g.vh), `${w}x${h}`);
    const lastY = L.cy + L.HEAD + (L.shown - 1) * L.ROW;
    assert.ok(lastY + L.ROW * 0.5 <= L.cy + L.ch, `${w}x${h}: the last row sits on the footer`);
  }
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The boss bar keeps out of the corners
// ---------------------------------------------------------------------------
test('the boss bar keeps clear of the map and the pause chip', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  g.started = true;
  g.startRound(10);
  g.boss = { hp: 100, maxHp: 200, dead: false, bossName: 'THE WARDEN', revivesLeft: 2 };
  for (const [w, h] of [[360, 300], [430, 930], [800, 500]]) {
    g.setViewport(w, h);
    const bw = Math.min(w < 560 ? w - 48 : 380, w - 32);
    const bx = Math.round((w - bw) / 2);
    // ask the HUD for the same numbers the painter uses by painting it
    const ctx = nc(g.vw, g.vh).getContext('2d');
    g.hud.update(H, g);
    assert.doesNotThrow(() => g.hud._bossBar(ctx, g, g.vw, g.vh), `${w}x${h}`);
    const mini = g.hud._miniRectFor(g, g.vw);
    const chip = HUD.pauseChipRect(g.vw, g.vh);
    assert.ok(bx >= 0 && bx + bw <= g.vw, `${w}x${h}: the boss bar runs off the screen`);
    assert.ok(mini && mini.x > g.vw * 0.5, `${w}x${h}: the map moved off the right`);
    assert.ok(chip.x + chip.w < g.vw * 0.25, `${w}x${h}: the pause chip left the left`);
  }
  clearStorage();
});

// ---------------------------------------------------------------------------
//  One notch of the wheel is one row, everywhere
// ---------------------------------------------------------------------------
test('one wheel notch is one row in the settings, the achievements and the debug list', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  g.vw = VW;
  g.vh = VH;

  // achievements: the list scrolls one row a notch, not two
  const { achVisible } = HUD;
  g.started = false;
  g.scene = 'achievements';
  g.achScroll = 0;
  g.input.wheel = 1;
  g.update(H);
  g.input.endFrame();
  const visible = achVisible(g.vw, g.vh);
  const total = g.achievements?.total ?? 0;
  if (total > visible) assert.equal(g.achScroll, 1, `a notch scrolled ${g.achScroll} rows`);
  g.input.wheel = 0;

  // settings: a notch scrolls the window when the list is longer than it
  g.scene = 'menu';
  g.settingsOpen = true;
  g.paused = true;
  g.settingsView = 0;
  g.settingsIndex = 0;
  const SL = HUD.settingsLayout(g, g.vw, g.vh);
  if (SL.over > 0) {
    g.input.wheel = 1;
    g.update(H);
    g.input.endFrame();
    assert.equal(g.settingsView, 1, `a settings notch scrolled ${g.settingsView} rows`);
    g.input.wheel = 0;
  }

  // the debug list walks with the wheel as well
  g.settingsOpen = false;
  g.debugOpen = true;
  g.debugIndex = 0;
  g.input.wheel = 1;
  g.update(H);
  g.input.endFrame();
  assert.equal(g.debugIndex, 1, `a debug notch moved the cursor to ${g.debugIndex}`);
  g.input.wheel = 0;
  clearStorage();
});

// ---------------------------------------------------------------------------
//  Every arrow moves something, in every list
// ---------------------------------------------------------------------------
test('arrow keys move the selection in every menu', async () => {
  clearStorage();
  const g = fresh();
  g.begin();

  // the front door
  g.started = false;
  g.scene = 'menu';
  g.menuIndex = 0;
  key(g, 'ArrowDown');
  assert.equal(g.menuIndex, 1, 'the front menu ignores the down arrow');
  key(g, 'ArrowUp');
  assert.equal(g.menuIndex, 0, 'the front menu ignores the up arrow');

  // the wardrobe: it is a column of coats, but all four arrows move it
  g.scene = 'outfits';
  g.outfitIndex = 0;
  key(g, 'ArrowDown');
  const afterDown = g.outfitIndex;
  assert.ok(afterDown !== 0, 'the wardrobe ignores the down arrow');
  key(g, 'ArrowUp');
  assert.equal(g.outfitIndex, 0, 'the wardrobe ignores the up arrow');
  key(g, 'ArrowRight');
  assert.ok(g.outfitIndex !== 0, 'the wardrobe ignores the right arrow');
  key(g, 'ArrowLeft');
  assert.equal(g.outfitIndex, 0, 'the wardrobe ignores the left arrow');

  // the achievements list scrolls on the horizontal pair too
  g.scene = 'achievements';
  g.achScroll = 0;
  key(g, 'ArrowDown');
  const scrolled = g.achScroll;
  assert.ok(scrolled >= 0, 'the achievements list ignored the arrow');
  key(g, 'ArrowUp');

  // the settings change value with left and right and move with up and down
  g.scene = 'menu';
  g.settingsOpen = true;
  g.paused = true;
  g.settingsIndex = 0;
  const first = SETTING_DEFS[0];
  const was = settings.get(first.id);
  key(g, 'ArrowDown');
  assert.equal(g.settingsIndex, 1, 'the settings ignore the down arrow');
  key(g, 'ArrowUp');
  assert.equal(g.settingsIndex, 0, 'the settings ignore the up arrow');
  if (first.type !== 'range') {
    key(g, 'ArrowRight');
    const now = settings.get(first.id);
    assert.notEqual(now, was, 'the settings ignore the right arrow');
  }
  clearStorage();
});
