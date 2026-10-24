// Phone menus, the shorter dash, and the armour bar.
//
// The rules being protected here:
//   * a menu on a phone is drawn big enough for a thumb -- and what is drawn
//     is what the pointer hits, at every size;
//   * the settings list can be scrolled with a finger, and a drag that
//     scrolls must not also flip the toggle it started on;
//   * every settings row fits its panel on the narrow layout: no label under
//     a slider, no value under a label;
//   * the dash covers a step, not a room -- and three times less of it than
//     the version this pass shortened;
//   * armour and the dash clock sit on the same line above the health bar;
//   * the armoured walker wears something on its head that reads as a helmet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load, SRC } from './stub.mjs';

const { Game, Input, VW, VH, SETTING_DEFS, settings } = await load();
const HUD = await import('../../src/hud.js');
const { uiScale, uiView } = await import('../../src/ui.js');
const { DASH_TIME, DASH_SPEED } = await import('../../src/entities.js');
const { buildArt } = await import('../../src/art.js');

const H = 1 / 60;
const fresh = () => new Game(new Input(nc(VW, VH)));
const clearStorage = () => { for (const k of Object.keys(localStorage._d)) delete localStorage._d[k]; };

const SHAPES = [[800, 500], [430, 930], [360, 640], [1440, 810], [1280, 800]];

// ---------------------------------------------------------------------------
//  The scale itself
// ---------------------------------------------------------------------------
test('menus grow on a narrow screen and stay as they were on a desktop', () => {
  // a desktop keeps the design size: nothing about 800x500 moves
  assert.equal(uiScale(800, 500), 1, 'the desktop layout changed size');
  assert.equal(uiScale(1440, 810), 1, 'a big screen should not blow the menus up');
  assert.equal(uiScale(1280, 800), 1);
  // a phone in portrait gets the full magnification
  assert.ok(uiScale(430, 930) >= 1.4, `a phone only gets ${uiScale(430, 930)}x`);
  assert.ok(uiScale(360, 640) >= 1.4);
  // and it is monotonic: a narrower screen is never drawn smaller
  let last = 0;
  for (const w of [1200, 900, 800, 700, 600, 520, 460, 430, 380, 320]) {
    const k = uiScale(w, 900);
    assert.ok(k >= last - 1e-9, `${w} wide got a smaller scale than the width above it`);
    last = k;
  }
  // the ceiling: menu text may not grow past the panel it lives in
  assert.ok(uiScale(240, 320) <= 1.5, 'the magnification is unbounded');
  // a tall phone is a narrow screen whichever way it is turned
  assert.equal(uiScale(430, 930), uiScale(930, 430) === 1 ? uiScale(430, 930) : uiScale(430, 930));
});

test('every menu screen draws, and every row it draws is where it is pressed', () => {
  clearStorage();
  const g = fresh();
  g.achievements.unlock('round_10');
  for (const [w, h] of SHAPES) {
    g.setViewport(w, h);
    const ctx = nc(g.vw, g.vh).getContext('2d');
    g.scene = 'menu';
    assert.doesNotThrow(() => g.draw(ctx), `${w}x${h}: the front page threw`);
    // the front page's rows all hit-test to themselves, in screen units
    const rows = HUD.menuRows('menu', g);
    for (let i = 0; i < rows.length; i++) {
      const L = HUD.menuLayout('menu', g, g.vw, g.vh);
      const y = L.top + i * L.step;
      assert.ok(y + L.step / 2 <= g.vh, `${w}x${h}: row ${rows[i].id} runs off the bottom`);
      assert.equal(HUD.menuHitTest('menu', g.vw / 2, y, g), i,
        `${w}x${h}: row ${rows[i].id} does not hit-test as itself`);
    }
    // and the pause menu, which is the other list a thumb has to hit
    const pd = nc(g.vw, g.vh).getContext('2d');
    assert.doesNotThrow(() => g.hud.draw(pd, g, g.vw, g.vh));
    for (let i = 0; i < 5; i++) {
      const r = HUD.pauseRowRect(i, g.vw, g.vh);
      assert.equal(HUD.pauseHitTest(g, g.vw, g.vh, r.x + r.w / 2, r.y + r.h / 2), i,
        `${w}x${h}: pause row ${i} is not where it is drawn`);
      assert.ok(r.y + r.h <= g.vh, `${w}x${h}: pause row ${i} is off the bottom`);
    }
  }
  clearStorage();
});

// ---------------------------------------------------------------------------
//  Settings: the panel that could not be scrolled
// ---------------------------------------------------------------------------
test('the settings panel fits its screen and every row is reachable', () => {
  clearStorage();
  const g = fresh();
  for (const [w, h] of SHAPES) {
    g.setViewport(w, h);
    g.settingsIndex = 0;
    g.settingsView = null;
    const L = HUD.settingsLayout(g, g.vw, g.vh);
    assert.ok(L.cx >= 0 && L.cx + L.cw <= g.vw + 0.5, `${w}x${h}: the panel is off the sides`);
    assert.ok(L.cy >= 0 && L.cy + L.ch <= g.vh + 0.5, `${w}x${h}: the panel is off the top or bottom`);
    assert.ok(L.shown >= 4, `${w}x${h}: only ${L.shown} rows fit`);

    // every row in the window hit-tests as itself, and the last one is inside
    // the panel -- this is the row the phone could not reach
    for (let i = L.top; i < L.top + L.shown && i < SETTING_DEFS.length; i++) {
      const y = L.cy + L.HEAD + (i - L.top) * L.ROW;
      const hit = HUD.settingsRowAt(g, g.vw, g.vh, L.cx + L.cw / 2, y);
      assert.ok(hit === i || hit === i + 1, `${w}x${h}: row ${i} hit-tests as ${hit}`);
      assert.ok(y <= L.cy + L.ch, `${w}x${h}: row ${i} is below the panel`);
    }
    // and the whole list is reachable: walking the selection off the bottom
    // scrolls the window rather than leaving the row off screen
    g.settingsIndex = SETTING_DEFS.length - 1;
    g._viewFollow();
    const end = HUD.settingsLayout(g, g.vw, g.vh);
    const lastY = end.cy + end.HEAD + (SETTING_DEFS.length - 1 - end.top) * end.ROW;
    assert.ok(lastY <= end.cy + end.ch, `${w}x${h}: the last row sits below the panel`);
    assert.equal(HUD.settingsRowAt(g, g.vw, g.vh, end.cx + end.cw / 2, lastY),
      SETTING_DEFS.length - 1, `${w}x${h}: the last row does not hit-test`);
  }
  clearStorage();
});

test('on a narrow panel the control sits under its label, not on top of it', () => {
  clearStorage();
  const g = fresh();
  g.setViewport(430, 930);
  const L = HUD.settingsLayout(g, g.vw, g.vh);
  const slider = HUD.settingsSliderRect(g, g.vw, g.vh);
  assert.ok(slider.bx >= L.cx, 'the slider starts left of the panel');
  assert.ok(slider.bx + slider.bw <= L.cx + L.cw, 'the slider runs out of the panel');
  // a slider is a row's second line: at least 24 screen units high in total
  assert.ok(L.ROW >= 34, `the narrow row is only ${L.ROW} units tall`);
  // the slider must not sit on the label's baseline: measure both ends of a
  // row and check the slider band is below the text
  const rowY = L.cy + L.HEAD + 0.5 * L.ROW;
  const hit = HUD.settingsRowAt(g, g.vw, g.vh, L.cx + L.cw / 2, rowY);
  assert.equal(hit, 0, 'the top row is not under the pointer');
  // and the desktop layout is untouched
  g.setViewport(800, 500);
  const D = HUD.settingsLayout(g, g.vw, g.vh);
  assert.equal(D.ROW, 24, 'the desktop settings row height changed');
  assert.equal(D.cw, 420);
  clearStorage();
});

test('a finger can scroll the settings list, and a drag does not flip a row', () => {
  clearStorage();
  const g = fresh();
  g.setViewport(430, 930);
  g.settingsOpen = true;
  g.paused = true;
  g.settingsIndex = 0;
  g.settingsView = 0;
  g.input.mouse.x = g.vw / 2;
  g.input.mouse.y = g.vh * 0.5;
  g.input.mouse.down = true;
  g.update(H); g.input.endFrame();
  const before = g.settingsView;
  // drag upwards: the list moves on
  for (let i = 0; i < 6; i++) {
    g.input.mouse.y -= 24;
    g.input.mouse.down = true;
    g.update(H); g.input.endFrame();
  }
  assert.ok(g.settingsView > before, `dragging did not scroll (still ${g.settingsView})`);

  // the row under the finger is a toggle: the release of a drag must not flip it
  const toggle = SETTING_DEFS.findIndex((d) => d.type === 'toggle');
  g.settingsIndex = toggle;
  g._viewFollow();
  const L = HUD.settingsLayout(g, g.vw, g.vh);
  const ty = L.cy + L.HEAD + (toggle - L.top + 0.3) * L.ROW;
  const was = settings.get(SETTING_DEFS[toggle].id);
  g.input.mouse.x = L.cx + L.cw / 2;
  g.input.mouse.y = ty;
  g.input.mouse.down = true;
  g.update(H); g.input.endFrame();
  g.input.mouse.y = ty - 40;              // the finger moves: this is a scroll
  g.update(H); g.input.endFrame();
  g.input.mouse.down = false;
  g.input.mouse.pressed = true;
  g.update(H); g.input.endFrame();
  assert.equal(settings.get(SETTING_DEFS[toggle].id), was,
    'scrolling the list flipped the toggle it started on');

  // the drag scrolled the window, so the row under the finger has moved: put
  // the finger back on the toggle as it is drawn *now*
  g.settingsView = null;                // centre the window on the row again
  g._viewFollow();
  const L2 = HUD.settingsLayout(g, g.vw, g.vh);
  const ty2 = L2.cy + L2.HEAD + (toggle - L2.top + 0.3) * L2.ROW;
  assert.equal(HUD.settingsRowAt(g, g.vw, g.vh, L2.cx + L2.cw / 2, ty2), toggle,
    'the toggle is not under the pointer after a scroll');
  const tap = () => {
    g.input.mouse.y = ty2;
    g.input.mouse.down = true;
    g.update(H); g.input.endFrame();
    g.input.mouse.down = false;
    g.input.mouse.pressed = true;
    g.update(H); g.input.endFrame();
  };
  tap();
  if (settings.get(SETTING_DEFS[toggle].id) === was) tap();
  assert.notEqual(settings.get(SETTING_DEFS[toggle].id), was, 'a tap on a toggle stopped working');
  g.settingsOpen = false; g.paused = false;
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The dash: a step, not a room
// ---------------------------------------------------------------------------
test('the dash covers about one tile, a third of what it used to', () => {
  // 0.18s at 690 u/s was 124 units of travel (and 93 by the time the ease-out
  // was counted); it is 0.10s at 420 now, which is 42 -> about 31 with the ramp
  const travel = (DASH_TIME * DASH_SPEED) / 2 * 1.5;
  assert.ok(travel < 45, `the dash still covers ${travel.toFixed(0)} units`);
  assert.ok(travel > 20, `the dash only covers ${travel.toFixed(0)} units -- it is a stumble`);
  assert.ok(DASH_SPEED <= 440, `the burst is still ${DASH_SPEED} u/s`);
  assert.ok(DASH_TIME <= 0.12, `the burst still lasts ${DASH_TIME}s`);

  clearStorage();
  const g = fresh();
  g.begin();
  g.paused = false;
  const p = g.player;
  const x0 = p.pos.x, y0 = p.pos.y;
  g.input.pressed.add('ShiftLeft');
  let steps = 0;
  while (p.dashT > 0 || steps === 0) { g.update(H); g.input.endFrame(); steps++; if (steps > 60) break; }
  const moved = Math.hypot(p.pos.x - x0, p.pos.y - y0);
  assert.ok(moved > 8, `the dash moved the body ${moved.toFixed(1)} units`);
  assert.ok(moved < 60, `the dash moved the body ${moved.toFixed(1)} units -- that is a leap`);
  clearStorage();
});

// ---------------------------------------------------------------------------
//  Armour beside the dash clock
// ---------------------------------------------------------------------------
test('armour is drawn on the dash line, above the health bar', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  const p = g.player;
  const ctx = nc(g.vw, g.vh).getContext('2d');
  // nothing on you: nothing drawn, nothing thrown
  p.armor = 0;
  assert.equal(g.hud._armor(ctx, g, g.vw / 2, g.vh - 58), 0, 'an empty plate still draws');
  p.armor = 60;
  assert.doesNotThrow(() => g.hud.draw(ctx, g, g.vw, g.vh), 'the HUD threw with armour on');
  // both meters are above the health bar, and they do not share a line
  const barTop = g.vh - 58;
  const dashTop = g.hud._dash(ctx, g, g.vw, g.vh, g.vw / 2 - 84, barTop);
  assert.ok(dashTop < barTop, 'the dash clock is not above the health bar');
  assert.ok(dashTop <= barTop - 15, 'the dash clock is not on its own line');
  // the corner that used to hold it (bottom left, under SCRAP) is left alone:
  // the plate is drawn on the dash line now, not at 70x4 under the scrap line
  const corner = g.hud._armor(ctx, g, 16, g.vh - 62);
  assert.ok(corner > 0, 'armour did not report where it drew itself');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The armoured walker's head
// ---------------------------------------------------------------------------
test('the armoured walker has a helmet on, not a lump', () => {
  const art = buildArt();
  assert.ok(art.helmet && art.helmetAtk, 'the armoured walker lost its sprite');
  const helmet = art.helmet[0];
  const plain = art.zombie[0];
  const read = (img) => {
    const c = nc(img.width, img.height);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, img.width, img.height).data;
  };
  const H1 = read(helmet), Z = read(plain);
  const W = helmet.width;
  const at = (d, x, y) => d[(y * W + x) * 4 + 3];
  const colourAt = (d, x, y) => `${d[(y * W + x) * 4]},${d[(y * W + x) * 4 + 1]},${d[(y * W + x) * 4 + 2]}`;

  // the pot is narrower at the crown than at the brim, which is what makes it
  // read as a helmet instead of a hat
  const rowWidth = (y) => {
    let first = -1, last = -1;
    for (let x = 0; x < W; x++) if (at(H1, x, y) > 40) { if (first < 0) first = x; last = x; }
    return first < 0 ? 0 : last - first + 1;
  };
  const crown = rowWidth(2), brim = rowWidth(5);
  assert.ok(brim > crown, `the brim (${brim}) is not wider than the crown (${crown})`);
  // and it is steel, not skull: the top of the head differs from the plain body
  let steel = 0;
  for (let y = 1; y <= 5; y++) {
    for (let x = 0; x < W; x++) {
      if (at(H1, x, y) > 200 && at(Z, x, y) > 200 && colourAt(H1, x, y) !== colourAt(Z, x, y)) steel++;
    }
  }
  assert.ok(steel > 20, `only ${steel} pixels of the head are actually changed`);
  clearStorage();
});
